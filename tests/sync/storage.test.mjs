import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

const script = readFileSync(new URL('../../wwwroot/storage.js', import.meta.url), 'utf8');

function profile() {
  const mirror = new Map(), rows = new Map();
  const limits = {mirror:false, database:false};
  const localStorage = {
    get length() { return mirror.size; },
    key: i => [...mirror.keys()][i],
    getItem: key => mirror.get(key) ?? null,
    setItem(key, value) {
      if (limits.mirror) throw Error('QuotaExceededError');
      mirror.set(key, value);
    },
    removeItem: key => mirror.delete(key)
  };
  const db = {transaction() {
    const tx = {objectStore() { return {
      openCursor() {
        const request = {}, entries = [...rows];
        function advance() {
          const row = entries.shift();
          request.result = row && {key:row[0], value:row[1], continue:advance};
          queueMicrotask(() => request.onsuccess());
        }
        advance();
        return request;
      },
      put(value, key) {
        queueMicrotask(() => {
          if (limits.database) tx.onabort();
          else { rows.set(key, value); tx.oncomplete(); }
        });
      }
    }; }};
    return tx;
  }};
  const indexedDB = {open() {
    const request = {result:db};
    queueMicrotask(() => request.onsuccess());
    return request;
  }};
  const BookStore = runInNewContext('(' + script.trim() + ')', {localStorage, indexedDB, window:new EventTarget(), CustomEvent});
  const open = async () => { const store = new BookStore(); await store.open(); return store; };
  return {open, localStorage, rows, limits};
}

test('0.2.x and 0.3.x read and write the same raw progress values', async () => {
  const {open, localStorage, rows} = profile();
  const store = await open();
  store.set('expanded',[1,3]);
  await store.flush();
  assert.deepEqual(rows.get('expanded').slice(), [1,3]);
  assert.deepEqual(JSON.parse(localStorage.getItem('csharp-book/v1/expanded')).slice(), [1,3]);

  // A learner opens the older executable and changes the same setting.
  rows.set('expanded',[5]);
  localStorage.setItem('csharp-book/v1/expanded','[5]');
  assert.equal(JSON.stringify((await open()).get('expanded')), '[5]');
});

test('a full mirror cannot hide a committed IndexedDB draft', async () => {
  const {open, localStorage, rows, limits} = profile();
  const store = await open();
  store.set('draft/test','previous');
  await store.flush();
  limits.mirror = true;
  store.set('draft/test','current');
  assert.equal(localStorage.getItem('csharp-book/v1/draft/test'), '"previous"');
  await store.flush();
  assert.equal(rows.get('draft/test'),'current');
  assert.equal(localStorage.getItem('csharp-book/v1/draft/test'), null);
  assert.equal((await open()).get('draft/test'),'current');
});

test('failure in both backends keeps the old durable copy and retries the current draft', async () => {
  const {open, localStorage, rows, limits} = profile();
  const store = await open();
  store.set('draft/test','first');
  await store.flush();
  limits.mirror = limits.database = true;
  store.set('draft/test','second');
  await assert.rejects(store.flush(), /Не удалось сохранить/);
  assert.equal(localStorage.getItem('csharp-book/v1/draft/test'), '"first"');
  assert.equal(store.get('draft/test'),'second');
  limits.database = false;
  await store.flush();
  assert.equal(rows.get('draft/test'),'second');
  assert.equal((await open()).get('draft/test'),'second');
});
