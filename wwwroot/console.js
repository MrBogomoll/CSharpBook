import {releaseCompletionEngine} from './editor/completion.js';
import {startRun} from './runner.js';
import {createCodeEditor} from './editor/code-editor.js';

const mainFile = 'Program.cs';
const html = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]);
const icon = name => '<i data-lucide="' + name + '" aria-hidden="true"></i>';
const button = (action, title, glyph, style = 'cx-soft', attrs = '') =>
  '<button type="button" class="' + style + '" data-action="' + action + '" ' + attrs + '>' +
  (glyph ? icon(glyph) : '') + '<span>' + html(title) + '</span></button>';
const statuses = {
  idle: ['Готово к запуску','circle'], loading: ['Подготовка','loader-circle'],
  running: ['Выполняется','play'], input: ['Ожидание ввода','keyboard'],
  ok: ['Выполнено','circle-check'], error: ['Ошибка','circle-alert'],
  stopped: ['Остановлено','square'], stale: ['Код изменён','pencil']
};
const hints = {
  CS0246: 'Проверь имя типа и регистр букв. Для типа из библиотеки может понадобиться директива using с именем пространства имён.',
  CS1002: 'Команда в C# заканчивается точкой с запятой. Добавь ; в отмеченном месте.',
  CS0103: 'Сверь имя с объявлением. C# различает большие и маленькие буквы.',
  CS0029: 'Сравни тип переменной с типом присваиваемого значения.',
  CS0165: 'Присвой переменной значение до того, как программа впервые её прочитает.',
  CS1513: 'Найди открывающую фигурную скобку и проверь, где должен закончиться этот блок.',
  CS1026: 'Проверь пары круглых скобок в вызове метода или условии.',
  CS1503: 'Сравни тип и порядок аргументов с параметрами метода.',
  CS1010: 'Проверь закрывающие кавычки на отмеченной строке.'
};
const explanations = {
  CS0246: 'Компилятор не нашёл тип или пространство имён с таким названием.',
  CS1002: 'В этом месте нужна точка с запятой.',
  CS0103: 'C# не нашёл объявление этого имени.',
  CS0029: 'Значение нельзя автоматически преобразовать в нужный тип.',
  CS0165: 'Программа читает переменную, которой ещё не присвоили значение.',
  CS1513: 'Не хватает закрывающей фигурной скобки.',
  CS1026: 'Не хватает закрывающей круглой скобки.',
  CS1503: 'Тип аргумента не подходит для этого параметра метода.',
  CS1010: 'Строка текста закончилась до закрывающих кавычек.',
  CS1001: 'Компилятор ожидает имя переменной, типа или метода.',
  CS1525: 'В выражении встретился неожиданный символ или знак операции.'
};
function editTarget(code) {
  let match = /\bint\s+bonus\s*=\s*(-?\d+)/.exec(code);
  let value = '8', label = 'Подставить бонус 8';
  if (!match) {
    match = /\bstring\s+message\s*=\s*"([^"\\\n]*)"/.exec(code);
    value = 'Добро пожаловать!';
    label = 'Подставить приветствие';
  }
  if (!match) return null;
  const index = match.index + (value === '8' ? match[0].length - match[1].length : match[0].indexOf('"') + 1);
  return {from:index, to:index + match[1].length, value, label, line:code.slice(0,index).split('\n').length};
}
function terminator(code) {
  const commands = [...code.matchAll(/^\s*(?:Console\.(?:WriteLine|Write)\s*\([^\n]*\)|(?:int|string|var|double|decimal|bool)\s+\w+\s*=[^\n;]+)(;)[ \t]*(?:\/\/[^\n]*)?$/gm)];
  if (!commands.length) return -1;
  const last = commands[commands.length - 1];
  return last.index + last[0].search(/;[ \t]*(?:\/\/[^\n]*)?$/);
}

export function mountConsole(container, options = {}) {
  let dispose = mountConsolePage(container,options);
  function cleanup() { dispose?.(); dispose = null; }
  cleanup.updateFiles = draft => dispose?.updateFiles(draft);
  cleanup.setTitle = name => dispose?.setTitle(name);
  cleanup.openExample = example => {
    cleanup();
    dispose = mountConsolePage(container,{onBack:options.onBack, onChange:options.onChange, showHeader:options.showHeader, ...example});
    return cleanup;
  };
  return cleanup;
}

function mountConsolePage(container, {
  source = '', version = 10, files = {}, topicTitle = '', exampleTitle = '', title = exampleTitle,
  initial = {source, files}, onBack, onChange, showHeader = true
} = {}) {
  function projectFiles({source,files}) {
    const project = new Map([[mainFile, String(source).replace(/\r\n?/g,'\n')]]);
    for (const [name, text] of Object.entries(files || {})) {
      if (name !== mainFile && typeof text === 'string') project.set(name, text.replace(/\r\n?/g,'\n'));
    }
    return project;
  }
  const codeFiles = projectFiles({source,files});
  const original = projectFiles(initial);
  const extraFiles = () => Object.fromEntries([...codeFiles].filter(([name]) => name !== mainFile));
  const page = document.createElement('div');
  page.className = 'cx-console';
  const back = onBack ? button('back','К уроку','arrow-left','cx-back') : '';
  const trail = name => [topicTitle, name].filter(Boolean).join(' · ');
  page.innerHTML = '<div class="cx-product">' +
    (showHeader ? '<header class="cx-bar"><div class="cx-brand"><span class="cx-logo" aria-hidden="true">C#</span>Sharpwise</div>' + back + '</header>' : '') +
    '<div class="cx-content"><div class="cx-head"><div>' + '<div class="cx-crumb"' + (trail(title) ? '' : ' hidden') + '>' + html(trail(title)) + '</div>' +
    '<h1>Консоль</h1></div>' + (showHeader ? '' : back) + '</div>' +
    '<div class="cx-grid"><section class="cx-editor" aria-label="Редактор C#"><div class="cx-filebar"><div class="cx-files"></div>' +
    button('copy','Копировать','copy','cx-copy') + '</div><div class="cx-codeview"></div>' +
    '<div class="cx-completions" aria-label="Подсказки ввода" hidden></div><div class="cx-editor-foot"><div class="cx-controls">' +
    button('run','Запустить','play','cx-run','aria-label="Запустить" title="Запустить"') +
    button('stop','Остановить','square','cx-stop','aria-label="Остановить" title="Остановить" hidden') +
    button('reset-console','Сбросить консоль','rotate-ccw','cx-clear','aria-label="Сбросить консоль" title="Сбросить консоль и вернуть исходный код"') +
    '</div><span class="cx-editor-note">.NET ' + html(version) + '</span></div></section>' +
    '<section class="cx-terminal" aria-label="Результат запуска"><div class="cx-termbar"><span class="cx-termname">' +
    icon('terminal') + 'Результат</span><span class="cx-term-status" role="status"></span>' +
    '</div>' +
    '<div class="cx-result"><p class="cx-idle"></p><pre class="cx-out" aria-label="Вывод программы" hidden></pre>' +
    '<div class="cx-errors"></div></div><form class="cx-stdin" hidden><label>Введи строку<input name="line" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
    '<button class="cx-send" type="submit">Отправить</button></form></section></div><div class="cx-help"></div></div></div>';
  container.replaceChildren(page);
  const $ = selector => page.querySelector(selector);
  const controller = new AbortController();
  const {signal} = controller;
  const icons = () => globalThis.lucide?.createIcons?.({root: page, attrs: {width:16,height:16}});
  let current = mainFile, phase = 'idle', output = '', errors = [], snapshot = null, expanded = false;
  let active = null, serial = 0, busy = false, frame = 0, refreshPending = false;
  let tutorMarkup = '', diagMarkup = '', lastStatus = '';
  const fileMenu = $('.cx-files'), help = $('.cx-help'), result = $('.cx-result');
  const inputForm = $('.cx-stdin'), lineInput = inputForm.elements.line;
  const host = $('.cx-codeview');
  const editor = createCodeEditor(host, $('.cx-completions'), current, codeFiles.get(current), (name,text) => {
    codeFiles.set(name,text);
    expanded = false;
    resetCopyButton();
    onChange?.(codeFiles.get(mainFile), extraFiles());
    scheduleRefresh();
  }, run, () => ({version:Number(version), files:Object.fromEntries(codeFiles)}));
  const fresh = () => snapshot && [...codeFiles].every(([name,text]) => snapshot.get(name) === text);
  function drawFiles() {
    if (codeFiles.size === 1) {
      fileMenu.innerHTML = '<span class="cx-file"><b>C#</b>Program.cs</span>';
      return;
    }
    fileMenu.innerHTML = '<select class="cx-file-select" aria-label="Открытый файл">' +
      [...codeFiles.keys()].map(name => '<option value="' + html(name) + '"' + (current === name ? ' selected' : '') + '>' + html(name) + '</option>').join('') + '</select>';
  }
  function selectFile(name) {
    if (name === current || !codeFiles.has(name)) return;
    current = name;
    editor.switchFile(name,codeFiles.get(name));
    resetCopyButton();
    drawFiles();
    refresh();
  }
  function resetCopyButton() {
    const copy = $('.cx-copy');
    if (copy.dataset.copied) {
      delete copy.dataset.copied;
      copy.innerHTML = icon('copy') + 'Копировать';
      icons();
    }
  }
  function diagnosticFile(error) {
    const path = String(error.file || mainFile).replaceAll('\\','/');
    return [...codeFiles.keys()].find(name => path === name || path.endsWith('/' + name));
  }
  function position(error) {
    const name = diagnosticFile(error);
    if (!name || !Number.isInteger(error.line) || error.line < 1) return null;
    const lines = codeFiles.get(name).split('\n');
    if (error.line > lines.length) return null;
    const col = Math.max(0, Math.min(lines[error.line-1].length, (error.col || 1)-1));
    return {name, index: lines.slice(0,error.line-1).reduce((n,line) => n + line.length + 1, col)};
  }
  function scheduleRefresh() {
    if (refreshPending || signal.aborted) return;
    refreshPending = true;
    queueMicrotask(() => {
      refreshPending = false;
      if (!signal.aborted) refresh();
    });
  }
  function renderOutput() {
    cancelAnimationFrame(frame);
    frame = 0;
    const atBottom = result.scrollTop + result.clientHeight >= result.scrollHeight - 8;
    const out = $('.cx-out');
    if (out.textContent !== output) out.textContent = output;
    out.hidden = output === '';
    if (atBottom) result.scrollTop = result.scrollHeight;
  }
  function refresh() {
    const isFresh = fresh();
    const stale = !busy && snapshot && !isFresh;
    const status = stale ? 'stale' : phase;
    let updateIcons = false;
    if (status !== lastStatus) {
      lastStatus = status;
      const badge = $('.cx-term-status');
      badge.className = 'cx-term-status ' + (status === 'ok' ? 'ok' : status === 'error' ? 'fail' : '');
      badge.innerHTML = icon(statuses[status][1]) + html(statuses[status][0]);
      updateIcons = true;
    }
    const note = $('.cx-idle');
    const messages = {
      idle:'Нажми «Запустить». Здесь появится текст, который программа выведет в консоль.',
      loading:'Подготавливаем компилятор C#…', running:'Программа выполняется…',
      ok:'Программа завершилась без видимого текста.', stopped:'Выполнение остановлено.',
      stale: output ? 'Предыдущий вывод. Запусти изменённую программу ещё раз.' : 'Запусти изменённую программу ещё раз.'
    };
    note.textContent = messages[status] || '';
    note.hidden = !note.textContent || (!!output && !['stale','stopped'].includes(status));
    const runButton = $('.cx-run'), stopButton = $('.cx-stop');
    const focused = document.activeElement;
    runButton.hidden = busy;
    stopButton.hidden = !busy;
    if (busy && focused === runButton) stopButton.focus({preventScroll:true});
    if (!busy && focused === stopButton) runButton.focus({preventScroll:true});
    inputForm.hidden = phase !== 'input' || !busy;
    if (!inputForm.hidden) lineInput.disabled = false;
    const visibleErrors = stale ? [] : errors;
    const diag = visibleErrors.map((error,i) => {
      const location = position(error);
      const text = error.text || 'Не удалось выполнить программу.';
      const translated = !/[А-Яа-яЁё]/.test(text) && explanations[error.code];
      const label = location ? (codeFiles.size > 1 ? location.name + ' · ' : '') +
        'Строка ' + error.line + (error.col ? ' · столбец ' + error.col : '') : '';
      return '<div><span class="cx-tag-error">' + html(error.code || 'Ошибка выполнения') + '</span>' +
        '<p class="cx-error-text">' + html(translated || text) + '</p>' +
        (translated ? '<details class="cx-original"><summary>Сообщение компилятора</summary><p>' + html(text) + '</p></details>' : '') +
        (location && isFresh ? button('locate',label,'crosshair','cx-locate','data-issue="' + i + '"') : '') + '</div>';
    }).join('');
    if (diag !== diagMarkup) { diagMarkup = diag; $('.cx-errors').innerHTML = diag; updateIcons = true; }
    const first = isFresh ? errors[0] : null;
    const localIssue = isFresh && errors.find(error => diagnosticFile(error) === current && position(error));
    const code = codeFiles.get(current);
    const target = editTarget(code);
    editor.mark(localIssue ? {line:localIssue.line,col:localIssue.col || 1,error:true} : target);
    host.style.setProperty('--cx-lines', Math.max(5, Math.min(14,code.split('\n').length)));
    const fixable = first && first.code === 'CS1002' && position(first);
    let content;
    if (first) {
      const advice = first.code === 'CS0246' && /'war'/.test(first.text)
        ? 'Замени war на var. В записи var a = 0; компилятор определит тип int по числу 0.'
        : hints[first.code] || first.hint || (position(first)
        ? 'Открой указанную строку. Проверь написание имён, типы значений и парные скобки, затем запусти код ещё раз.'
        : 'Прочитай сообщение в результате запуска. После исправления причины запусти программу ещё раз.');
      content = '<div class="cx-tutor error">' + icon('triangle-alert') + '<div><h2>Как исправить</h2><p>' +
        (position(first) ? 'Проверь отмеченное место в строке ' + first.line + '.' : 'Посмотри сообщение об ошибке в результате запуска.') +
        '</p><div class="cx-actions">' + button('hint',expanded ? 'Скрыть подсказку' : 'Показать подсказку','lightbulb','cx-soft','aria-expanded="' + expanded + '"') +
        (expanded && fixable ? button('fix','Вставить ;','wand-sparkles') : '') + '</div>' +
        (expanded ? '<p class="cx-hint-text">' + html(advice) + '</p>' : '') + '</div></div>';
    } else {
      const text = target ? (target.value === '8' ? 'В строке ' + target.line + ' переменная bonus хранит прибавку к счёту. Измени её значение и запусти программу.' :
        'В строке ' + target.line + ' замени текст между кавычками и запусти программу.') : 'Измени код и запусти программу, чтобы посмотреть, как изменится результат.';
      content = '<div class="cx-tutor">' + icon('lightbulb') + '<div><h2>Попробуй изменить</h2><p>' + html(text) + '</p><div class="cx-actions">' +
        (target ? button('change',target.label,'pencil') : '') +
        (/\bConsole\./.test(code) ? button('complete','Подсказка ввода','list') : '') +
        (terminator(code) >= 0 ? button('break','Пример с ошибкой','circle-alert','cx-soft',busy ? 'disabled' : '') : '') + '</div></div></div>';
    }
    if (tutorMarkup !== content) { tutorMarkup = content; help.innerHTML = content; updateIcons = true; }
    if (updateIcons) icons();
  }
  function receive(id,event) {
    if (!busy || signal.aborted || id !== serial) return;
    switch (event.type) {
      case 'output':
        output += String(event.text ?? '');
        if (!frame) frame = requestAnimationFrame(() => { renderOutput(); refresh(); });
        return;
      case 'ready': phase = 'running'; break;
      case 'input': phase = 'input'; break;
      case 'error': errors.push(event); phase = 'error'; break;
      case 'done': busy = false; active = null; phase = errors.length ? 'error' : 'ok'; break;
      default: return;
    }
    renderOutput();
    refresh();
    if (phase === 'input' && document.hasFocus() && page.getClientRects().length && (document.activeElement === document.body || page.contains(document.activeElement)) && !host.contains(document.activeElement)) lineInput.focus({preventScroll:true});
  }
  async function run() {
    if (busy || signal.aborted) return;
    const id = ++serial;
    busy = true; phase = 'loading'; errors = []; output = ''; expanded = false;
    snapshot = new Map(codeFiles);
    lineInput.value = '';
    editor.close(); releaseCompletionEngine(); renderOutput(); refresh();
    try {
      const handle = await startRun({source:snapshot.get(mainFile), version, files:extraFiles(), onEvent:event => receive(id,event)});
      if (serial !== id || signal.aborted) { handle?.stop(); return; }
      if (busy) active = handle;
    } catch (error) {
      receive(id,{type:'error',text:error?.message || 'Не удалось запустить компилятор.'});
      receive(id,{type:'done'});
    }
  }
  function stop() {
    if (!busy) return;
    serial++; busy = false; phase = 'stopped';
    const handle = active;
    active = null;
    handle?.stop();
    renderOutput(); refresh();
  }
  page.addEventListener('change',event => {
    if (event.target.matches('.cx-file-select')) selectFile(event.target.value);
  },{signal});
  inputForm.addEventListener('submit',event => {
    event.preventDefault(); event.stopPropagation();
    if (!busy || !active || phase !== 'input') return;
    const line = lineInput.value, id = serial;
    lineInput.value = ''; phase = 'running'; refresh();
    const handle = active;
    const failed = error => {
      if (id !== serial || !busy || signal.aborted) return;
      receive(id,{type:'error',text:error?.message || 'Не удалось передать строку программе.'});
      receive(id,{type:'done'});
      handle.stop();
    };
    try { Promise.resolve(handle.sendInput(line)).catch(failed); }
    catch (error) {failed(error);}
  },{signal});
  page.addEventListener('click',async event => {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    event.stopPropagation();
    const action = trigger.dataset.action;
    if (action !== 'complete') editor.close();
    switch (action) {
      case 'back': onBack?.(); break;
      case 'run': run(); break;
      case 'stop': stop(); break;
      case 'reset-console': {
        stop();
        const changed = codeFiles.size !== original.size || [...original].some(([name,text]) => codeFiles.get(name) !== text);
        output = ''; errors = []; expanded = false; phase = 'idle'; snapshot = null;
        lineInput.value = '';
        replaceProject(original,mainFile);
        if (changed) onChange?.(codeFiles.get(mainFile),extraFiles());
        resetCopyButton(); renderOutput(); refresh(); editor.close();
        break;
      }
      case 'complete': editor.suggestExample(); break;
      case 'copy': {
        const code = codeFiles.get(current);
        trigger.dataset.copied = 'true';
        try { await navigator.clipboard.writeText(code); }
        catch {
          if (signal.aborted) return;
          editor.select(0,code.length);
          let copied = false;
          try {copied = document.execCommand('copy');} catch {}
          if (!copied) {trigger.textContent = 'Код выделен'; break;}
        }
        trigger.textContent = 'Скопировано'; break;
      }
      case 'hint': expanded = !expanded; refresh(); break;
      case 'locate':
      case 'fix': {
        if (!fresh()) break;
        const error = errors[Number(trigger.dataset.issue || 0)];
        const location = error && position(error);
        if (!location) break;
        selectFile(location.name);
        if (action === 'fix' && error.code === 'CS1002') editor.replace(location.index,location.index,';');
        else editor.select(location.index,Math.min(location.index+1,codeFiles.get(current).length));
        break;
      }
      case 'change': {
        const target = editTarget(codeFiles.get(current));
        if (target) editor.replace(target.from,target.to,target.value);
        break;
      }
      case 'break': {
        const pos = terminator(codeFiles.get(current));
        if (pos >= 0 && !busy) { editor.replace(pos,pos+1,''); run(); }
        break;
      }
    }
  },{signal});
  drawFiles(); refresh(); icons();
  function cleanup() {
    if (signal.aborted) return;
    controller.abort(); serial++;
    cancelAnimationFrame(frame);
    const handle = active; active = null; busy = false;
    handle?.stop();
    editor.destroy();
    page.remove();
  }
  function replaceProject(next, nextFile) {
    codeFiles.clear();
    for (const [name, text] of next) {
      codeFiles.set(name, text);
      editor.updateFile(name, text);
    }
    current = next.has(nextFile) ? nextFile : mainFile;
    editor.switchFile(current, next.get(current));
    drawFiles();
  }
  cleanup.setTitle = name => {
    const crumb = $('.cx-crumb');
    crumb.textContent = trail(name);
    crumb.hidden = !crumb.textContent;
  };
  cleanup.updateFiles = draft => {
    replaceProject(projectFiles(draft),current);
    scheduleRefresh();
  };
  return cleanup;
}
