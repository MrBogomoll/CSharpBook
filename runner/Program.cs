using System.Globalization;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

public static partial class StudentHost
{
    private static readonly Lazy<MetadataReference[]> References = new(ReadReferencePack);
    private const string Globals = "global using System; global using System.Collections.Generic; global using System.IO; global using System.Linq; global using System.Net.Http; global using System.Threading; global using System.Threading.Tasks;";

    public static void Main() { }

    [JSImport("output", "book")]
    internal static partial void Output(string value, bool stderr);

    [JSImport("input", "book")]
    internal static partial string? Input();

    [JSImport("diagnostic", "book")]
    internal static partial void Diagnostic(string text, string code, string file, int line, int col, bool warning);

    private static MetadataReference[] ReadReferencePack()
    {
        using var resource = typeof(StudentHost).Assembly.GetManifestResourceStream("StudentRunner.refs.zip")!;
        using var pack = new ZipArchive(resource);
        return pack.Entries.Select(entry => {
            using var stream = entry.Open();
            using var image = new MemoryStream((int)entry.Length);
            stream.CopyTo(image);
            image.Position = 0;
            return (MetadataReference)MetadataReference.CreateFromStream(image, filePath:entry.Name);
        }).ToArray();
    }

    [JSExport]
    public static async Task Run(string source, string filesJson)
    {
#if NET11_0_OR_GREATER
        var language = LanguageVersion.CSharp15;
#else
        var language = LanguageVersion.CSharp14;
#endif
        var options = new CSharpParseOptions(language);
        var trees = new List<SyntaxTree> {
            CSharpSyntaxTree.ParseText(Globals, options, "ImplicitUsings.g.cs", Encoding.UTF8),
            CSharpSyntaxTree.ParseText(source, options, "Program.cs", Encoding.UTF8)
        };
        using var files = JsonDocument.Parse(filesJson);
        foreach (var file in files.RootElement.EnumerateObject())
            if (!file.Name.Equals("Program.cs", StringComparison.OrdinalIgnoreCase))
                trees.Add(CSharpSyntaxTree.ParseText(file.Value.GetString()!, options, file.Name, Encoding.UTF8));
        var compilation = CSharpCompilation.Create("StudentProgram", trees, References.Value,
            new CSharpCompilationOptions(OutputKind.ConsoleApplication, optimizationLevel:OptimizationLevel.Debug, concurrentBuild:false));
        using var pe = new MemoryStream();
        var result = compilation.Emit(pe);
        foreach (var item in result.Diagnostics.Where(item => item.Severity is DiagnosticSeverity.Error or DiagnosticSeverity.Warning).Take(40)) {
            var span = item.Location.GetLineSpan();
            Diagnostic(item.GetMessage(CultureInfo.InvariantCulture), item.Id, span.Path ?? "", span.IsValid ? span.StartLinePosition.Line + 1 : 0, span.IsValid ? span.StartLinePosition.Character + 1 : 0, item.Severity == DiagnosticSeverity.Warning);
        }
        if (!result.Success) return;
        Console.SetOut(new BrowserWriter(false));
        Console.SetError(new BrowserWriter(true));
        Console.SetIn(new BrowserReader());
        try {
            var assembly = Assembly.Load(pe.ToArray());
            var entry = assembly.EntryPoint!;
            // Roslyn generates a synchronously waiting bridge for an async Main.
            // The authored async entry point must be awaited on the browser event loop.
            if (entry.Name == "<Main>" && entry.DeclaringType is {} declaringType) {
                var authored = declaringType.GetMethods(BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Static)
                    .FirstOrDefault(method => (method.Name == "Main" || method.Name == "<Main>$") && typeof(Task).IsAssignableFrom(method.ReturnType));
                if (authored != null) entry = authored;
            }
            var returned = entry.Invoke(null, entry.GetParameters().Length == 0 ? null : new object[] { Array.Empty<string>() });
            if (returned is Task task) await task;
        } catch (Exception error) {
            if (error is TargetInvocationException { InnerException: {} inner }) error = inner;
            var frame = new System.Diagnostics.StackTrace(error,true).GetFrames()?.FirstOrDefault(frame => !string.IsNullOrEmpty(frame.GetFileName()) && frame.GetMethod()?.DeclaringType?.Assembly.GetName().Name == "StudentProgram");
            Diagnostic(error.GetType().Name + ": " + error.Message, "", frame?.GetFileName() ?? "", frame?.GetFileLineNumber() ?? 0, frame?.GetFileColumnNumber() ?? 0, false);
        }
    }

    private sealed class BrowserWriter(bool stderr) : TextWriter {
        public override Encoding Encoding => Encoding.UTF8;
        public override void Write(char value) => Output(value.ToString(),stderr);
        public override void Write(string? value) { if (value != null) Output(value,stderr); }
        public override void Write(char[] buffer,int index,int count) => Output(new string(buffer,index,count),stderr);
        public override void WriteLine(string? value) => Output((value ?? "") + "\n",stderr);
    }

    private sealed class BrowserReader : TextReader {
        private string buffer = "";
        private int position;
        public override string? ReadLine() {
            if (position >= buffer.Length) return Input();
            var remaining = buffer[position..].TrimEnd('\n');
            position = buffer.Length;
            return remaining;
        }
        public override int Peek() {
            if (position < buffer.Length) return buffer[position];
            var next = Input();
            if (next == null) return -1;
            buffer = next + "\n";
            position = 0;
            return buffer[0];
        }
        public override int Read() { var next = Peek(); if (next >= 0) position++; return next; }
    }
}
