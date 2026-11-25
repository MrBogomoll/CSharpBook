import {connectCompletions} from './completion.js';
import {
  EditorState, EditorView, StateEffect, StateField, Decoration, lineNumbers,
  keymap, defaultKeymap, history, historyKeymap, undo, redo, undoDepth, redoDepth, StreamLanguage,
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

export function createCodeEditor(host, panel, file, source, onChange, onRun, project, onHistory) {
  const documents = new Map();
  let name = file;
  let markKey = '';
  let receiving = false;
  let completions;
  function close() {completions?.close();}
  function reportHistory(state) {onHistory(undoDepth(state) > 0, redoDepth(state) > 0);}
  function buildState(text,selection) {
    return EditorState.create({doc: text, selection, extensions: [
      lineNumbers(), history(), marks, language, syntaxHighlighting(colors),
      keymap.of([{key: 'Mod-Enter', run: () => { close(); onRun(); return true; }},
        ...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({class: 'cx-input', 'aria-label': 'Код C#, ' + name,
        'aria-keyshortcuts': 'Control+Enter Meta+Enter', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false'}),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          markKey = '';
          reportHistory(update.state);
          if (!receiving) onChange(name, update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) completions?.suggest();
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
  completions = connectCompletions(view.contentDOM,panel,() => ({
    ...project(), text:view.state.doc.toString(), head:view.state.selection.main.head,
    anchor:view.state.selection.main.anchor, fileName:name
  }),replace);

  return {
    close, select, replace,
    undo: () => undo(view),
    redo: () => redo(view),
    revealCaret() {
      if (view.hasFocus) view.dispatch({effects:EditorView.scrollIntoView(view.state.selection.main.head, {y:'nearest'})});
    },
    updateFile(fileName, text, external) {
      const state = fileName === name ? view.state : documents.get(fileName);
      if (!state || state.doc.toString() === text) return;
      const {anchor, head} = state.selection.main;
      const selection = {anchor:Math.min(anchor,text.length), head:Math.min(head,text.length)};
      if (external) {
        if (fileName !== name) documents.delete(fileName);
        else {
          markKey = '';
          close();
          view.setState(buildState(text,selection));
          reportHistory(view.state);
        }
        return;
      }
      const reset = state.update({changes:{from:0,to:state.doc.length,insert:text}, selection, userEvent:'input.reset'});
      if (fileName !== name) {documents.set(fileName,reset.state); return;}
      receiving = true;
      try {
        view.dispatch(reset);
      } finally { receiving = false; }
    },
    discardRemovedFiles(files) {
      for (const fileName of documents.keys()) if (!files.has(fileName)) documents.delete(fileName);
    },
    switchFile(next, text) {
      if (name === next) return;
      documents.set(name, view.state);
      name = next;
      markKey = '';
      view.setState(documents.get(name) || buildState(text));
      reportHistory(view.state);
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
        completions.suggest(true);
        return;
      }
    },
    destroy() { completions.destroy(); documents.clear(); view.destroy(); }
  };
}
