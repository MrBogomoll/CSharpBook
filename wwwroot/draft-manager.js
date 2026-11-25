'use strict';

function createDraftManager(trigger, api) {
  const dialog = document.createElement('dialog');
  dialog.className = 'draft-manager';
  dialog.setAttribute('aria-labelledby', 'draft-manager-title');
  dialog.innerHTML = '<header><h2 id="draft-manager-title">Черновики программ</h2>' +
    '<button type="button" data-op="close" aria-label="Закрыть" title="Закрыть" autofocus>' + icon('x') + '</button></header>' +
    '<div class="draft-browser"><div class="draft-entries"></div>' +
    '<div class="draft-notice"><span role="status"></span>' +
    '<button type="button" data-op="undo" aria-label="Отменить удаление" hidden>Отменить</button></div></div>' +
    '<form hidden><label>Название программы<input name="title" required autocomplete="off"></label>' +
    '<p role="alert"></p><div class="draft-form-actions"><button type="button" data-op="cancel">Отмена</button>' +
    '<button type="submit">Сохранить</button></div></form>';
  document.body.append(dialog);
  const heading = dialog.querySelector('h2');
  const browser = dialog.querySelector('.draft-browser');
  const entries = dialog.querySelector('.draft-entries');
  const status = dialog.querySelector('[role="status"]');
  const undoButton = dialog.querySelector('[data-op="undo"]');
  const form = dialog.querySelector('form');
  const input = form.elements.title;
  const errorText = form.querySelector('[role="alert"]');
  const recentDeletes = [];
  let editing = null;

  function iconButton(op, glyph, label) {
    return '<button type="button" data-op="' + op + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + icon(glyph) + '</button>';
  }
  function row(item, current) {
    const name = esc(item.name);
    const quoted = '«' + item.name + '»';
    const itemName = current
      ? '<strong class="draft-name">' + name + '</strong>'
      : '<button type="button" data-op="open" class="draft-name" aria-label="Открыть «' + name + '»"><span>' + name +
        (item.pane ? '<small>' + esc(item.pane) + '</small>' : '') + '</span></button>';
    return '<div class="draft-row" data-key="' + esc(item.key) + '">' + itemName +
      iconButton('rename', 'pencil', 'Переименовать ' + quoted) +
      (current ? '' : iconButton('remove', 'trash-2', 'Удалить ' + quoted)) + '</div>';
  }
  function focusAction(op, key) {
    const buttons = entries.querySelectorAll('[data-op="' + op + '"]');
    const button = Array.from(buttons).find(item => item.closest('[data-key]')?.dataset.key === key);
    (button || dialog.querySelector('[data-op="close"]')).focus({preventScroll:true});
  }
  function refresh() {
    if (!dialog.open || editing) return;
    const focus = document.activeElement;
    const op = entries.contains(focus) ? focus.dataset.op : null;
    const key = focus?.closest('[data-key]')?.dataset.key;
    const {active, drafts} = api.list();
    entries.innerHTML = (active ? '<section><h3>Текущая программа</h3>' + row(active, true) +
      '<button type="button" class="draft-move" data-op="save">' + icon('folder-input') + 'В черновики</button></section>' : '') +
      '<section><h3>Сохранённые программы</h3>' +
      (drafts.length ? drafts.map(item => row(item, false)).join('') : '<p>В папке пока пусто.</p>') + '</section>';
    window.lucide?.createIcons({root:dialog, attrs:{width:18,height:18}});
    if (op) focusAction(op, key);
    undoButton.hidden = !recentDeletes.length;
    undoButton.title = recentDeletes.length ? 'Вернуть «' + recentDeletes.at(-1).name + '»' : '';
  }
  function finishRename() {
    const key = editing;
    editing = null;
    form.hidden = true;
    browser.hidden = false;
    heading.textContent = 'Черновики программ';
    refresh();
    focusAction('rename', key);
  }
  trigger.addEventListener('click', () => {
    dialog.showModal();
    refresh();
  });
  dialog.addEventListener('close', () => {
    editing = null;
    form.hidden = true;
    browser.hidden = false;
    heading.textContent = 'Черновики программ';
  });
  dialog.addEventListener('cancel', event => {
    if (editing) { event.preventDefault(); finishRename(); }
  });
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-op]')?.dataset.op;
    const key = event.target.closest('[data-key]')?.dataset.key;
    if (action === 'close') dialog.close();
    else if (action === 'open') { dialog.close(); api.open(key); }
    else if (action === 'save') {
      const name = api.list().active?.name;
      api.save();
      status.textContent = '«' + name + '» в черновиках.';
      refresh();
    } else if (action === 'rename') {
      const {active, drafts} = api.list();
      const item = [active, ...drafts].find(item => item?.key === key);
      if (!item) return;
      editing = key;
      heading.textContent = 'Переименовать программу';
      errorText.textContent = '';
      input.value = item.name;
      browser.hidden = true;
      form.hidden = false;
      input.focus();
      input.select();
    } else if (action === 'cancel') finishRename();
    else if (action === 'remove') {
      const item = api.list().drafts.find(item => item.key === key);
      if (!item) return;
      const undo = api.remove(key);
      if (!undo) return;
      recentDeletes.push({key, name:item.name, undo});
      status.textContent = '«' + item.name + '» удалена.';
      refresh();
      undoButton.focus({preventScroll:true});
    } else if (action === 'undo') {
      const item = recentDeletes.pop();
      if (!item) return;
      const error = item.undo();
      const restored = !error && api.list().drafts.find(draft => draft.key === item.key);
      status.textContent = error || (restored ? '«' + restored.name + '» восстановлена.' : 'Черновик восстановлен.');
      refresh();
      if (undoButton.hidden) focusAction('open', item.key);
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const error = api.rename(editing, input.value.trim());
    if (error) { errorText.textContent = error; input.focus(); return; }
    status.textContent = '';
    finishRename();
  });
  return {refresh};
}
