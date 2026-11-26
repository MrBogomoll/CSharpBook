import {loadPackage, supportsExceptionReferences} from '../runner.js';
import {workerMain} from '../runtime/worker.js';

let engine;
let nextPanel = 0;

// The analyzer binds syntax in a separate worker and never executes student code.
// One shared compiler is sufficient for both panes, including on a phone.
function analyzer(version) {
  if (engine?.version === version) return engine;
  engine?.dispose();
  if (version === 11 && !supportsExceptionReferences()) throw new Error('Для подсказок C# 15 обнови Android System WebView или браузер.');
  const url = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')()'], {type:'text/javascript'}));
  let worker;
  try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
  const channel = new MessageChannel(), port = channel.port1, pending = new Map();
  let id = 0, disposed = false, timer, bootTimer;
  let ready, failed;
  const booted = new Promise((resolve, reject) => {ready = resolve; failed = reject;});
  booted.catch(() => {});
  function dispose(reason = 'Редактор закрыл компилятор подсказок.') {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer); clearTimeout(bootTimer);
    worker.terminate(); port.close();
    const error = new Error(reason);
    failed(error);
    for (const task of pending.values()) task.reject(error);
    pending.clear();
    if (engine === current) engine = null;
  }
  const touch = () => { clearTimeout(timer); timer = setTimeout(dispose, 90000); };
  port.onmessage = ({data}) => {
    if (data.type === 'ready') {clearTimeout(bootTimer); ready(); return;}
    if (data.type === 'error' || data.type === 'done') return dispose(data.text);
    const task = pending.get(data.id);
    if (!task) return;
    pending.delete(data.id);
    if (data.type === 'symbols') task.resolve(data.rows);
    else task.reject(new Error(data.text));
  };
  worker.onerror = error => dispose(error.message || 'Браузер остановил подсказки.');
  const current = {version, dispose, async lookup(project, valid) {
    touch();
    await booted;
    if (disposed || !valid()) return [];
    return new Promise((resolve, reject) => {
      const key = ++id;
      pending.set(key, {resolve,reject});
      port.postMessage({...project, id:key});
    });
  }};
  engine = current;
  bootTimer = setTimeout(() => dispose('Истекло время подготовки подсказок.'), 60000);
  loadPackage(version).then(bytes => {
    if (disposed) return;
    const bundle = bytes.slice(0);
    worker.postMessage({bundle, analyze:true}, [bundle, channel.port2]);
  }).catch(error => dispose(error.message));
  touch();
  return current;
}

export function releaseCompletionEngine() { engine?.dispose(); }

const wordEnd = /[@\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}_]*$/u;
const wordTail = /^[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}_]*/u;
function context(state, explicit = false) {
  const {text, head, anchor} = state;
  if (head !== anchor) return null;
  const left = text.slice(0,head);
  const word = wordEnd.exec(left)?.[0] || '';
  if (!word && !explicit && !left.trimEnd().endsWith('.') && !left.endsWith('::')) return null;
  return {from:head-word.length, to:head+wordTail.exec(text.slice(head))[0].length, prefix:word.replace(/^@/,'')};
}

const hint = 'Tab — следующий вариант · Пробел — вставить · Esc — закрыть';
export function connectCompletions(input, panel, read, replace) {
  const controller = new AbortController();
  const listen = (node, type, callback, capture = false) => node.addEventListener(type,callback,{signal:controller.signal,capture});
  const listId = 'cx-suggestions-' + ++nextPanel;
  let serial = 0, timer, selected = 0, rows = [], spot = null, cache = null;
  let releaseTab = false, ime = false;
  panel.id = listId;
  panel.setAttribute('role','listbox');
  panel.setAttribute('aria-label','Варианты кода C#');
  input.setAttribute('aria-controls',listId);
  input.setAttribute('aria-autocomplete','list');
  const originalShortcuts = input.getAttribute('aria-keyshortcuts');
  input.setAttribute('aria-keyshortcuts',[originalShortcuts,'Control+Space Escape Tab Shift+Tab Space'].filter(Boolean).join(' '));
  function hide() {
    input.removeAttribute('aria-activedescendant');
    panel.replaceChildren(); panel.hidden = true;
    rows = []; selected = 0;
  }
  function close() {
    ++serial; clearTimeout(timer); spot = null; hide();
  }
  function highlight(index, scroll) {
    selected = index;
    const nodes = panel.querySelectorAll('[role=option]');
    nodes.forEach((node, i) => node.setAttribute('aria-selected', String(i === selected)));
    if (nodes[selected]) {
      input.setAttribute('aria-activedescendant', nodes[selected].id);
      if (scroll) {
        const item = nodes[selected], list = item.parentNode;
        if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
        if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
      }
    }
  }
  function draw(all, place) {
    hide();
    const prefix = place.prefix.toLowerCase();
    rows = all.filter(([name]) => name.toLowerCase().startsWith(prefix)).slice(0,60);
    if (!rows.length) return;
    const label = document.createElement('div');
    label.className = 'cx-method-label';
    label.textContent = matchMedia('(pointer: coarse)').matches ? 'Коснись варианта, чтобы вставить. ' + hint : hint;
    const options = document.createElement('div');
    options.className = 'cx-method-list';
    rows.forEach(([name, ,detail],i) => {
      const option = document.createElement('button');
      option.type = 'button'; option.tabIndex = -1; option.className = 'cx-method';
      option.id = listId + '-' + i; option.dataset.method = name; option.dataset.index = i;
      option.setAttribute('role','option');
      const code = document.createElement('code'), help = document.createElement('small');
      code.textContent = name; help.textContent = detail;
      option.append(code,help); options.append(option);
    });
    panel.append(label, options); panel.hidden = false; highlight(0,false);
  }
  function indent() {
    const {head,anchor,text} = read();
    if (head === anchor) replace(head,head,'    ');
    else {
      const start = Math.min(head,anchor), end = Math.max(head,anchor);
      const lineStart = start > 0 ? text.lastIndexOf('\n',start - 1) + 1 : 0;
      const selected = text.slice(lineStart,end);
      const indented = '    ' + selected.replace(/\n(?=[\s\S])/g,'\n    ');
      replace(lineStart,end,indented);
    }
    close();
  }
  function accept(index) {
    const row = rows[index], place = spot;
    if (!row || !place) return;
    const {text} = read();
    let [name, kind, ,needsEscape] = row;
    if (needsEscape || text[place.from] === '@') name = '@' + name;
    const opening = kind === 'method' && /^[ \t]*\(/.exec(text.slice(place.to));
    const caret = place.from + name.length + (kind === 'method' ? (opening ? opening[0].length : 1) : 0);
    replace(place.from, place.to, name + (kind === 'method' && !opening ? '()' : ''), caret);
    close();
  }
  function suggest(explicit = false) {
    close();
    if (ime || document.activeElement !== input) return;
    const state = read(), place = context(state,explicit);
    if (!place) return;
    const {fileName,version,text} = state;
    const code = text.slice(0,place.from) + '__bookCaret__' + text.slice(place.to);
    const files = {...state.files, [fileName]:code};
    const source = files['Program.cs'] || '';
    delete files['Program.cs'];
    const key = JSON.stringify([version,fileName,place.from,source,files]);
    spot = place;
    if (cache?.key === key) { draw(cache.rows,place); return; }
    const scheduled = serial;
    const valid = () => serial === scheduled && document.activeElement === input;
    timer = setTimeout(async () => {
      let matches = [];
      try {
        matches = await analyzer(version).lookup({source, files, fileName, position:place.from}, valid);
        if (valid()) cache = {key,rows:matches};
      } catch (error) {
        if (valid() && explicit) {
          panel.textContent = error.message;
          panel.hidden = false;
        }
      }
      if (!valid()) return;
      if (matches.length) draw(matches,place);
    }, explicit ? 0 : 75);
  }
  function acceptSpace(event) {
    if (!rows.length || !event.cancelable) return;
    const state = read(), current = context(state,true);
    if (!current || current.from !== spot.from || current.to !== spot.to || current.prefix !== spot.prefix) {
      close(); return;
    }
    const [name, kind, ,needsEscape] = rows[selected];
    const fullName = needsEscape || state.text[spot.from] === '@' ? '@' + name : name;
    if (kind !== 'method' && state.head === spot.to && state.text.slice(spot.from,spot.to) === fullName) {
      // A completed word such as "var" already matches. Keep the normal separating space.
      close(); return;
    }
    event.preventDefault(); event.stopImmediatePropagation(); accept(selected);
  }
  function onKey(event) {
    if (event.isComposing || ime) return;
    const {key,ctrlKey,metaKey,altKey,shiftKey} = event;
    if (key === 'Tab' && releaseTab) {releaseTab = false; close(); return;}
    releaseTab = false;
    function take() { event.preventDefault(); event.stopImmediatePropagation(); }
    if (key === 'Escape') {
      // Let the next Tab participate in native focus navigation, even if no list was open.
      take(); close(); releaseTab = true; return;
    }
    if ((ctrlKey || metaKey) && !altKey && key === ' ') {take(); suggest(true); return;}
    if (ctrlKey || metaKey || altKey) return;
    if (key === 'Tab') {
      if (rows.length) {
        take(); highlight((selected + (shiftKey ? -1 : 1) + rows.length) % rows.length,true);
      } else if (!shiftKey) {take(); indent();}
    }
    if (key === ' ' && !shiftKey) acceptSpace(event);
    if (key.startsWith('Arrow') || key === 'Home' || key === 'End') close();
  }
  listen(input,'keydown',onKey,true);
  // Some on-screen keyboards insert a space without sending a space keydown.
  listen(input,'beforeinput',event => {
    if (!ime && !event.isComposing && event.inputType === 'insertText' && event.data === ' ') acceptSpace(event);
  },true);
  listen(input,'blur',() => {close(); releaseTab = false;});
  listen(input,'focus',() => {try {analyzer(read().version);} catch {}});
  listen(input,'compositionstart',() => {ime = true; close();});
  listen(input,'compositionend',() => {ime = false; queueMicrotask(() => suggest());});
  // Keep the caret in the code. A tap still produces a click and a swipe scrolls the list.
  listen(panel,'pointerdown',event => {if (event.target.closest('[role=option]')) event.preventDefault();});
  listen(panel,'click',event => {
    const option = event.target.closest('[role=option]');
    if (!option) return;
    event.preventDefault(); accept(Number(option.dataset.index));
  });
  return {suggest, close, destroy() {
    controller.abort(); close(); cache = null;
    input.removeAttribute('aria-controls'); input.removeAttribute('aria-autocomplete');
    if (originalShortcuts) input.setAttribute('aria-keyshortcuts',originalShortcuts);
    else input.removeAttribute('aria-keyshortcuts');
  }};
}
