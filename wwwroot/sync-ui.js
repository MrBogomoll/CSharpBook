import {SyncEngine, isSyncKey} from './sync-engine.js';
import {available, getStatus, connect, disconnect, getProvider, openExchangeFile, saveExchangeFile} from './sync-bridge.js';

const providers = {google: 'Google Диск', yandex: 'Яндекс Диск'};
const folderNames = {google: 'Папка Google Диска', yandex: 'Папка Яндекс Диска'};

function showValue(value) {
  if (value === null) return 'Удалено';
  if (typeof value === 'string') return value;
  if (typeof value?.source === 'string') {
    return Object.entries({'Program.cs': value.source, ...value.files})
      .map(([name, source]) => name + '\n' + source).join('\n\n');
  }
  if (typeof value?.body === 'string') return [value.quote, value.body].filter(Boolean).join('\n\n');
  return JSON.stringify(value, null, 2);
}

export async function startCloudSync({store, label, refresh, describeKey}) {
  const native = available();
  let engine;
  let settings = null;
  let provider = null;
  let selected = null;
  let configured = {};
  let busy = false;
  let message = '';
  let timer;
  let statusReady = false;
  let conflicts = [];
  let connectionControls = '';
  let conflictsVersion = '';

  function controls() {
    if (!settings?.isConnected) return;
    const actions = settings.querySelector('.sync-actions');
    const signature = JSON.stringify([provider, configured, selected, statusReady]);
    if (signature !== connectionControls) {
      connectionControls = signature;
      actions.replaceChildren();
      const add = (text, command, group = actions) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cs-tool';
        button.textContent = text;
        button.dataset.sync = command;
        group.append(button);
      };
      const usingDocuments = label === 'Android' && configured.documents === true;
      const direct = Object.keys(providers).some(id => configured[id]);
      let intro;
      if (!native) {
        intro = 'Чтобы продолжить на другом устройстве, передай файл прогресса.';
      } else if (!statusReady) {
        intro = '';
        add('Проверить подключение', 'status');
      } else if (provider) {
        if (provider === 'folder') intro = 'Подключена папка обмена. Облачное приложение отвечает за передачу файлов между устройствами.';
        else if (provider === 'documents') intro = 'Подключены файлы ПК и телефона. Учебник обменивается изменениями через эти файлы автоматически.';
        else intro = 'Подключён ' + providers[provider] + '.';
        add('Синхронизировать сейчас', 'sync');
        const target = {folder:'папку', documents:'файлы'}[provider] || providers[provider];
        add('Отключить ' + target, 'disconnect');
      } else if (selected) {
        const platformHint = label !== 'Android'
          ? 'Выбери папку, которую синхронизирует установленное на ПК приложение диска.'
          : usingDocuments ? 'Если диск предлагает только отдельные файлы, выбери «Связать два файла».'
            : 'Если диск не предлагает выбрать папку, воспользуйся передачей файла ниже.';
        intro = 'Выбери на ПК и Android одну и ту же папку ' + (selected === 'google' ? 'на Google Диске' : selected === 'yandex' ? 'на Яндекс Диске' : 'облачного диска') +
          '. Учебник объединит прогресс обоих устройств. ' + platformHint;
        add('Выбрать папку', 'folder');
        if (usingDocuments) add('Связать два файла', 'documents');
        add('Назад', 'back');
      } else {
        intro = direct
          ? 'Подключи один и тот же аккаунт на ПК и телефоне. Учебник будет автоматически синхронизировать прогресс, закладки, заметки и черновики.'
          : 'Выбери диск для обмена через общую папку. Учебник объединит прогресс, закладки, заметки и черновики.';
        for (const [id, name] of Object.entries(providers)) {
          if (configured[id]) add('Подключить ' + name, id);
          else if (!direct) add(folderNames[id], 'folder-' + id);
          else intro += ' Вариант «' + folderNames[id] + '» доступен в разделе «Другие способы синхронизации».';
        }
      }
      settings.querySelector('.sync-description').textContent = intro;
      const more = settings.querySelector('.sync-more');
      const showFolderOptions = native && statusReady && !provider && !selected && direct;
      more.hidden = !showFolderOptions;
      more.firstElementChild.replaceChildren();
      if (showFolderOptions) {
        for (const [id, name] of Object.entries(folderNames)) add(name, 'folder-' + id, more.firstElementChild);
      }
      settings.querySelector('.sync-transfer summary').textContent = showFolderOptions
        ? 'Другие способы синхронизации' : 'Передать файл прогресса вручную';
      settings.querySelector('.sync-documents-help').hidden = !(usingDocuments && selected && !provider);
    }
    for (const button of settings.querySelectorAll('[data-sync]')) button.disabled = busy;
    const status = settings.querySelector('.sync-status');
    if (status.textContent !== message) status.textContent = message;
    const conflictBox = settings.querySelector('.sync-conflicts');
    const version = JSON.stringify(conflicts.map(group => [group.key, ...group.variants.map(item => item.id)]));
    if (version === conflictsVersion) {
      for (const button of conflictBox.querySelectorAll('button')) button.disabled = busy;
      return;
    }
    conflictsVersion = version;
    conflictBox.replaceChildren();
    if (!conflicts.length) return;
    const heading = document.createElement('h3');
    heading.textContent = 'Изменения на двух устройствах';
    const explanation = document.createElement('p');
    explanation.textContent = 'Сравни сохранённые варианты и выбери, какой использовать на обоих устройствах.';
    conflictBox.append(heading, explanation);
    for (const group of conflicts) {
      const details = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = describeKey(group.key);
      details.append(title);
      for (const variant of group.variants) {
        const device = document.createElement('strong');
        device.textContent = variant.label || 'Устройство';
        if (variant.updated) device.textContent += ' · ' + new Date(variant.updated).toLocaleString('ru');
        const preview = document.createElement('pre');
        preview.textContent = showValue(variant.value);
        const use = document.createElement('button');
        use.type = 'button';
        use.disabled = busy;
        use.className = 'cs-tool';
        use.textContent = 'Выбрать этот вариант';
        use.onclick = () => {
          if (busy) return;
          try {
            const keys = engine.resolve(group.key, variant.id);
            refresh(keys);
            conflicts = engine.conflicts();
            message = 'Выбранный вариант сохранён на устройстве.';
            controls();
            schedule(0);
          } catch (error) { fail(error); }
        };
        details.append(device, preview, use);
      }
      conflictBox.append(details);
    }
  }

  function mount(section) {
    if (!section || settings === section) return;
    settings = section;
    settings.hidden = false;
    connectionControls = conflictsVersion = '';
    settings.innerHTML = '<h2>Синхронизация</h2><p class="sync-description"></p><div class="sync-actions"></div>' +
      '<p class="sync-documents-help" hidden>Для связи через два файла сначала подключи папку диска в учебнике на ПК и нажми «Синхронизировать сейчас». На телефоне открой в ней файл ПК csharpbook-v1-….json, затем сохрани файл телефона в той же папке под предложенным именем. Дальше обмен пойдёт автоматически.</p>' +
      '<details class="sync-transfer"><summary>Передать файл прогресса вручную</summary>' +
      '<div class="sync-more" hidden><div class="sync-actions"></div></div>' +
      '<p>Сохрани файл на одном устройстве и открой его на другом. Можно передать файл через Google Диск или Яндекс Диск. При импорте учебник объединит прогресс.</p>' +
      '<div class="sync-actions"><button type="button" class="cs-tool" data-sync="export">Сохранить файл прогресса</button>' +
      '<button type="button" class="cs-tool" data-sync="import">Открыть файл прогресса</button></div></details>' +
      '<p class="sync-status" role="status"></p><div class="sync-conflicts"></div>';
    settings.querySelector('.sync-transfer').open = !native || Boolean(selected);
    settings.onclick = event => {
      const button = event.target.closest('[data-sync]');
      if (button && !busy && !button.disabled) handle(button.dataset.sync);
    };
    controls();
  }

  function fail(error) {
    message = store.unsaved?.size ? store.warning : 'Прогресс сохранён на устройстве. ' + (error?.message || 'Синхронизация недоступна.');
    controls();
  }

  function schedule(delay) {
    clearTimeout(timer);
    if (provider) timer = setTimeout(synchronize, delay);
  }

  async function synchronize() {
    clearTimeout(timer);
    if (busy || !provider) return;
    if (provider !== 'folder' && provider !== 'documents' && !navigator.onLine) {
      message = 'Нет подключения. Прогресс сохранён на устройстве.';
      controls();
      return;
    }
    busy = true;
    message = 'Синхронизируем…';
    controls();
    try {
      engine ||= new SyncEngine(store, label);
      const {changedKeys} = await engine.sync(getProvider(provider));
      refresh(changedKeys);
      conflicts = engine.conflicts();
      const time = new Date().toLocaleTimeString('ru', {hour:'2-digit', minute:'2-digit'});
      const completed = {folder:'Обмен с папкой завершён в ', documents:'Обмен со связанными файлами завершён в '};
      message = (completed[provider] || 'Синхронизировано в ') + time + '.';
      if (engine.hasLocalChanges()) {
        message = 'Новые изменения сохранены на устройстве.';
        schedule(1800);
      }
    } catch (error) {
      if (error.changedKeys?.length) {
        refresh(error.changedKeys);
        conflicts = engine.conflicts();
      }
      fail(error);
    } finally { busy = false; controls(); }
  }

  async function handle(command) {
    if (command === 'sync') return synchronize();
    if (command === 'back' || command === 'folder-google' || command === 'folder-yandex') {
      selected = command === 'back' ? null : command.slice('folder-'.length);
      settings.querySelector('.sync-transfer').open = Boolean(selected);
      message = '';
      controls();
      return;
    }
    busy = true;
    clearTimeout(timer);
    message = ({
      disconnect:'Отключаем диск…', status:'Проверяем подключение…', folder:'Выбери папку обмена…',
      documents:'Открой файл ПК, затем сохрани файл телефона в той же папке.',
      export:'Готовим файл прогресса…', import:'Выбери файл прогресса…'
    })[command] || 'Ожидаем разрешения на доступ к диску…';
    controls();
    try {
      if (command === 'export' || command === 'import') {
        engine ||= new SyncEngine(store, label);
        if (command === 'export') {
          const saved = await saveExchangeFile(await engine.exportSnapshot());
          message = saved === false ? 'Сохранение отменено.' : 'Файл прогресса подготовлен для передачи.';
        } else {
          const snapshot = await openExchangeFile();
          if (snapshot === null) { message = 'Открытие файла отменено.'; return; }
          const {changedKeys} = await engine.importSnapshot(snapshot);
          refresh(changedKeys);
          conflicts = engine.conflicts();
          message = 'Прогресс из файла объединён с прогрессом на устройстве.';
          schedule(1800);
        }
        return;
      }
      if (command === 'disconnect') { await disconnect(); provider = null; }
      else if (command === 'documents') {
        engine ||= new SyncEngine(store, label);
        await store.flush();
        await connect(command, engine.deviceId);
      } else if (command !== 'status') await connect(command);
      statusReady = false;
      const status = await getStatus();
      provider = status.provider;
      configured = status.configured;
      statusReady = true;
      selected = null;
      message = command === 'disconnect' ? 'Синхронизация отключена. Прогресс остался на устройстве.' : '';
      schedule(0);
    } catch (error) {
      if (error.changedKeys?.length) refresh(error.changedKeys);
      fail(error);
    } finally {
      busy = false;
      if ((command === 'export' || command === 'import') && engine?.hasLocalChanges()) schedule(1800);
      controls();
    }
  }

  function saved(event) {
    if (!provider || !isSyncKey(event.detail)) return;
    if (!busy) {
      message = 'Изменения сохранены на устройстве.';
      controls();
      schedule(1800);
    }
  }

  window.addEventListener('book-local-write', saved);
  window.addEventListener('book-storage', saved);
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', () => { if (provider && !busy) synchronize(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(0);
  });
  setInterval(() => { if (document.visibilityState === 'visible' && provider) synchronize(); }, 90000);
  if (native) handle('status');
  return {mount};
}
