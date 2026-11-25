// Build this local ES module with esbuild 0.28.2: esbuild vendor-entry.mjs --bundle --minify --format=esm --target=es2020 --outfile=codemirror.js
// Installed package versions and license notices are listed in LICENSES.txt.
export {EditorState, StateEffect, StateField} from "@codemirror/state";
export {EditorView, Decoration, lineNumbers, keymap} from "@codemirror/view";
export {history, historyKeymap, defaultKeymap, undo, redo, undoDepth, redoDepth} from "@codemirror/commands";
export {StreamLanguage, HighlightStyle, syntaxHighlighting, syntaxTree} from "@codemirror/language";
export {csharp} from "@codemirror/legacy-modes/mode/clike";
export {tags} from "@lezer/highlight";
