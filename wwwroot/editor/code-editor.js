import {
  EditorState, EditorView, StateEffect, StateField, Decoration, lineNumbers,
  keymap, defaultKeymap, history, historyKeymap, StreamLanguage,
  HighlightStyle, syntaxHighlighting, syntaxTree, csharp, tags
} from './codemirror.js';

const language = StreamLanguage.define({
  ...csharp,
  token(stream, state) {
    const style = csharp.token(stream, state);
    if (style !== 'variable' && style !== 'def') return style;
    const word = stream.current();
    if (/^(field|extension|with|when|not|and|or|scoped|file|union)$/.test(word)) return 'keyword';
    if (word === 'Console') return 'type';
    if (stream.match(/^\s*\(/, false)) return 'variableName.function';
    return style;
  }
});
const colors = HighlightStyle.define([
  {tag: [tags.keyword, tags.bool, tags.null], class: 'cx-key'},
  {tag: tags.typeName, class: 'cx-class'},
  {tag: tags.function(tags.variableName), class: 'cx-fn'},
  {tag: tags.number, class: 'cx-num'},
  {tag: [tags.string, tags.character], class: 'cx-str'},
  {tag: tags.comment, class: 'cx-comment'}
]);
const changeMark = StateEffect.define();
const marks = StateField.define({
  create: () => Decoration.none,
  update(previous, transaction) {
    const effect = transaction.effects.find(item => item.is(changeMark));
    if (!effect) return transaction.docChanged ? Decoration.none : previous;
    const issue = effect.value;
    if (!issue || issue.line < 1 || issue.line > transaction.newDoc.lines) return Decoration.none;
    const line = transaction.newDoc.line(issue.line);
    const kind = issue.error ? 'bad' : 'mark';
    const parts = [Decoration.line({class: 'cx-line ' + kind}).range(line.from)];
    if (issue.error && line.length) {
      const from = Math.min(line.to - 1, line.from + Math.max(0, issue.col - 1));
      parts.push(Decoration.mark({class: 'cx-underline'}).range(from, from + 1));
    }
    return Decoration.set(parts, true);
  },
  provide: field => EditorView.decorations.from(field)
});
const methods = [
  {name: 'WriteLine', detail: 'Вывести и перейти на новую строку'},
  {name: 'Write', detail: 'Вывести и остаться на той же строке'},
  {name: 'ReadLine', detail: 'Прочитать введённую строку'}
];

export function createCodeEditor(host, panel, file, source, onChange, onRun) {
  const documents = new Map();
  let name = file;
  let markKey = '';
  const controller = new AbortController();
  const listen = (element, type, fn) => element.addEventListener(type, fn, {signal: controller.signal});
  function close() { panel.hidden = true; panel.replaceChildren(); }

  function context() {
    const {doc, selection} = view.state;
    const {head, empty} = selection.main;
    if (!empty) return null;
    const line = doc.lineAt(head);
    const left = doc.sliceString(line.from, head);
    const match = /\bConsole\.([\w]*)$/.exec(left);
    if (!match) return null;
    const tag = syntaxTree(view.state).resolveInner(line.from + match.index + 1, 1).name;
    if (/string|comment/i.test(tag)) return null;
    const tail = /^\w*/.exec(doc.sliceString(head, line.to))[0];
    return {from: head - match[1].length, to: head + tail.length, prefix: match[1]};
  }
  function suggest() {
    if (!view.hasFocus) return close();
    const spot = context();
    const matches = spot ? methods.filter(method => method.name.startsWith(spot.prefix)) : [];
    if (!matches.length) return close();
    const label = document.createElement('span');
    label.className = 'cx-method-label';
    label.textContent = 'Методы Console';
    panel.replaceChildren(label);
    for (const {name, detail} of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cx-method';
      button.dataset.method = name;
      const code = document.createElement('code');
      code.textContent = name;
      const hint = document.createElement('small');
      hint.textContent = detail;
      button.append(code, hint);
      panel.append(button);
    }
    panel.hidden = false;
  }
  function buildState(text) {
    return EditorState.create({doc: text, extensions: [
      lineNumbers(), history(), marks, language, syntaxHighlighting(colors),
      keymap.of([{key: 'Mod-Enter', run: () => { close(); onRun(); return true; }},
        {key: 'Escape', run: () => { if (panel.hidden) return false; close(); return true; }},
        ...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({class: 'cx-input', 'aria-label': 'Код C#, ' + name,
        'aria-keyshortcuts': 'Control+Enter Meta+Enter', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false'}),
      EditorView.updateListener.of(update => {
        if (update.docChanged) { markKey = ''; onChange(name, update.state.doc.toString()); }
        if (update.docChanged || update.selectionSet) suggest();
      }),
      EditorState.phrases.of({'line number': 'Номер строки', 'Control character': 'Управляющий символ'})
    ]});
  }
  const view = new EditorView({state: buildState(source), parent: host});
  function select(from, to = from) {
    view.focus();
    view.dispatch({selection: {anchor: from, head: to}, effects: EditorView.scrollIntoView(from, {y:'nearest'})});
  }
  function replace(from, to, text, caret = from + text.length) {
    view.dispatch({changes: {from, to, insert: text}, selection: {anchor: caret}, scrollIntoView: true, userEvent: 'input.complete'});
    view.focus();
  }
  listen(panel, 'pointerdown', event => { if (event.target.closest('button')) event.preventDefault(); });
  listen(panel, 'click', event => {
    const method = event.target.closest('[data-method]')?.dataset.method;
    const spot = context();
    if (!method || !spot) return close();
    const opening = /^[ \t]*\(/.exec(view.state.doc.sliceString(spot.to));
    const caret = spot.from + method.length + (opening ? opening[0].length : 1);
    replace(spot.from, spot.to, method + (opening ? '' : '()'), caret);
    close();
  });
  listen(host, 'focusout', event => { if (!panel.contains(event.relatedTarget)) close(); });
  listen(panel, 'focusout', event => { if (!panel.contains(event.relatedTarget) && !host.contains(event.relatedTarget)) close(); });
  listen(panel, 'keydown', event => { if (event.key === 'Escape') {view.focus(); close();} });

  return {
    close, select, replace,
    switchFile(next, text) {
      if (name === next) return;
      documents.set(name, view.state);
      name = next;
      markKey = '';
      view.setState(documents.get(name) || buildState(text));
      close();
    },
    mark(issue) {
      const key = issue ? [name, issue.line, issue.col, !!issue.error].join('/') : 'none';
      if (key === markKey) return;
      markKey = key;
      view.dispatch({effects: changeMark.of(issue)});
    },
    suggestExample() {
      for (const match of view.state.doc.toString().matchAll(/\bConsole\.(?:Wr)?/g)) {
        const tag = syntaxTree(view.state).resolveInner(match.index + 1, 1).name;
        if (/string|comment/i.test(tag)) continue;
        select(match.index + match[0].length);
        suggest();
        return;
      }
    },
    destroy() { controller.abort(); close(); documents.clear(); view.destroy(); }
  };
}
