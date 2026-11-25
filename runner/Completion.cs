using System.Text;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using System.Runtime.InteropServices.JavaScript;

public static partial class StudentHost
{
    // Only syntax and symbols are read. The project is never emitted or invoked here.
    [JSExport]
    public static string Complete(string source, string filesJson, string fileName, int position)
    {
        var project = Project(source, filesJson);
        var tree = project.SyntaxTrees.FirstOrDefault(t => t.FilePath == fileName);
        if (tree == null || position < 0 || position >= tree.Length) return "[]";
        var root = tree.GetRoot();
        var token = root.FindToken(position);
        if (!token.IsKind(SyntaxKind.IdentifierToken) || token.SpanStart != position) return "[]";

        var name = token.Parent as SimpleNameSyntax;
        var model = project.GetSemanticModel(tree);
        var rows = new Dictionary<string, (int rank, string kind, string detail)>(StringComparer.Ordinal);
        ExpressionSyntax? receiver = name?.Parent switch {
            MemberAccessExpressionSyntax access when access.Name == name => access.Expression,
            MemberBindingExpressionSyntax => name.FirstAncestorOrSelf<ConditionalAccessExpressionSyntax>()?.Expression,
            QualifiedNameSyntax qualified when qualified.Right == name => qualified.Left,
            AliasQualifiedNameSyntax alias when alias.Name == name => alias.Alias,
            _ => null
        };
        var containerSymbol = receiver == null ? null : model.GetSymbolInfo(receiver).Symbol;
        if (containerSymbol is IAliasSymbol aliasSymbol) containerSymbol = aliasSymbol.Target;
        var staticAccess = containerSymbol is INamespaceOrTypeSymbol;
        INamespaceOrTypeSymbol? container = staticAccess ? (INamespaceOrTypeSymbol?)containerSymbol :
            receiver == null ? null : model.GetTypeInfo(receiver).Type;
        if (name?.Parent is MemberBindingExpressionSyntax && container is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } nullable)
            container = nullable.TypeArguments[0];
        if (receiver != null && (container == null || container is IErrorTypeSymbol)) return "[]";

        bool inStaticMethod = false;
        for (ISymbol? scope = model.GetEnclosingSymbol(position); scope != null && scope is not INamedTypeSymbol; scope = scope.ContainingSymbol) {
            if (scope.IsStatic) { inStaticMethod = true; break; }
        }
        foreach (var symbol in model.LookupSymbols(position, container, includeReducedExtensionMethods: receiver != null && !staticAccess)) {
            if (receiver == null && inStaticMethod && !symbol.IsStatic && symbol.ContainingType != null
                && (symbol is IPropertySymbol or IFieldSymbol or IEventSymbol || symbol is IMethodSymbol { MethodKind: MethodKind.Ordinary })) continue;
            if (!symbol.CanBeReferencedByName || symbol.Name.StartsWith('<')) continue;
            if (symbol is IMethodSymbol method && method.MethodKind is not (MethodKind.Ordinary or MethodKind.LocalFunction or MethodKind.ReducedExtension or MethodKind.DelegateInvoke)) continue;
            if (receiver != null && container is not INamespaceSymbol) {
                var isStaticMember = symbol.IsStatic || symbol is INamedTypeSymbol;
                if (isStaticMember != staticAccess) continue;
            }
            if ((symbol is ILocalSymbol or IRangeVariableSymbol) && symbol.Locations.Any(l => l.SourceTree == tree && l.SourceSpan.Start > position)) continue;
            var item = symbol switch {
                ILocalSymbol local => (0, "variable", "Переменная · " + TypeName(local.Type)),
                IParameterSymbol parameter => (0, "variable", "Параметр · " + TypeName(parameter.Type)),
                IRangeVariableSymbol => (0, "variable", "Переменная запроса"),
                IMethodSymbol m => (1, "method", m.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat)),
                IPropertySymbol p => (2, "property", "Свойство · " + TypeName(p.Type)),
                IFieldSymbol f => (2, "field", (f.IsConst ? "Константа · " : "Поле · ") + TypeName(f.Type)),
                IEventSymbol e => (2, "event", "Событие · " + TypeName(e.Type)),
                INamespaceSymbol => (5, "namespace", "Пространство имён"),
                INamedTypeSymbol t => (4, "type", t.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat)),
                ITypeParameterSymbol => (1, "type", "Параметр типа"),
                IAliasSymbol => (1, "type", "Псевдоним"),
                _ => (9, "", "")
            };
            if (item.Item2 == "") continue;
            if (symbol.ContainingType?.ToDisplayString() == "System.Console") {
                item = symbol.Name switch {
                    "WriteLine" => (-3, "method", "Вывести и перейти на новую строку"),
                    "Write" => (-2, "method", "Вывести и остаться на той же строке"),
                    "ReadLine" => (-1, "method", "Прочитать введённую строку"),
                    _ => item
                };
            }
            rows.TryAdd(symbol.Name, item);
        }

        if (receiver == null) {
            foreach (var kind in SyntaxFacts.GetKeywordKinds().Concat(SyntaxFacts.GetContextualKeywordKinds())) {
                var word = SyntaxFacts.GetText(kind);
                if (word.Length == 0 || word.StartsWith('_') || word == "safe") continue;
#if !NET11_0_OR_GREATER
                if (word is "union" or "closed") continue;
#endif
                rows.TryAdd(word, (3, "keyword", "Ключевое слово C#"));
            }
            // These contextual type names are lexed as identifiers, not keyword tokens.
            rows.TryAdd("var", (1, "keyword", "Тип переменной определяет компилятор"));
            rows.TryAdd("dynamic", (3, "keyword", "Тип определяется во время выполнения"));
            rows.TryAdd("nint", (3, "keyword", "Целое размером с указатель"));
            rows.TryAdd("nuint", (3, "keyword", "Беззнаковое целое размером с указатель"));
            rows.TryAdd("notnull", (3, "keyword", "Ограничение параметра типа"));
        }
        using var bytes = new MemoryStream();
        using (var json = new Utf8JsonWriter(bytes)) {
            json.WriteStartArray();
            foreach (var row in rows.OrderBy(r => r.Value.rank).ThenBy(r => r.Key, StringComparer.OrdinalIgnoreCase)) {
                json.WriteStartArray();
                json.WriteStringValue(row.Key);
                json.WriteStringValue(row.Value.kind);
                json.WriteStringValue(row.Value.detail);
                if (row.Value.kind != "keyword" && SyntaxFacts.GetKeywordKind(row.Key) != SyntaxKind.None) json.WriteBooleanValue(true);
                json.WriteEndArray();
            }
            json.WriteEndArray();
        }
        return Encoding.UTF8.GetString(bytes.ToArray());
    }

    private static string TypeName(ITypeSymbol type) => type.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat);
}
