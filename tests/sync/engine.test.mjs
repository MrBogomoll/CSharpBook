import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncEngine, isSyncKey} from '../../wwwroot/sync-engine.js';

class Store {
  constructor(entries) { this.values = new Map(entries); }
  get(key, fallback) { return this.values.has(key) ? this.values.get(key) : fallback; }
  set(key, value) { this.values.set(key, structuredClone(value)); }
}

function cloud() {
  const files = new Map();
  return {
    files,
    async readReplicas() { return structuredClone([...files.values()]); },
    async writeReplica(id, body) {
      assert.equal(id, body.deviceId);
      files.set(id, structuredClone(body));
    }
  };
}

function device(label, entries = []) {
  const store = new Store(entries);
  return {store, engine:new SyncEngine(store,label)};
}

test('first pairing merges existing data and sends only portable keys', async () => {
  const drive = cloud();
  const phone = device('Android', [
    ['draft/loops','from phone'], ['read/loops',true], ['theme','dark'],
    ['last-reading','lesson/loops/original'], ['secondary/draft/loops','second pane'],
    ['scratch/1',{source:'class C {}',files:{'D.cs':'class D {}'}}]
  ]);
  const pc = device('ПК', [['saved/loops',true],['read/loops',false],['dock-width',80]]);
  await phone.engine.sync(drive);
  assert.equal(phone.engine.hasLocalChanges(), false);
  await pc.engine.sync(drive);
  await phone.engine.sync(drive);
  assert.equal(pc.store.get('read/loops'), true);
  assert.equal(phone.store.get('saved/loops'), true);
  assert.equal(pc.store.get('secondary/draft/loops'), 'second pane');
  assert.deepEqual(pc.store.get('scratch/1'), phone.store.get('scratch/1'));
  assert.equal(pc.store.get('theme'), undefined);
  assert.equal(phone.store.get('dock-width'), undefined);
  assert.equal(pc.store.get('last-reading'), 'lesson/loops/original');
  for (const snapshot of drive.files.values()) {
    assert.ok(Object.keys(snapshot.records).every(key => isSyncKey(key)));
  }
  assert.equal((await pc.engine.sync(drive)).uploaded, false);
});

test('a fresh install automatically restores cloud progress before writing anything', async () => {
  const drive = cloud();
  const records = [['read/intro',true], ['saved/loops',true], ['solved/loops/1',true], ['draft/loops','from phone']];
  await device('Old phone', records).engine.sync(drive);
  const before = structuredClone(drive.files);
  const fresh = device('New phone');
  const result = await fresh.engine.sync(drive);
  assert.equal(result.hasRemoteRecords, true);
  assert.deepEqual(new Set(result.changedKeys), new Set(records.map(([key]) => key)));
  for (const [key, value] of records) assert.deepEqual(fresh.store.get(key), value);
  assert.deepEqual(drive.files, before);
});

test('manual restore reads only, keeps local edits and distinguishes an empty disk from an up-to-date copy', async () => {
  const drive = cloud();
  const pc = device('PC', [['draft/local','unsent']]);
  const restore = () => pc.engine.sync(drive, {restoreOnly:true});
  assert.deepEqual(await restore(), {changedKeys:[], uploaded:false, hasRemoteRecords:false});
  assert.equal(drive.files.size, 0);
  await device('Phone', [['saved/loops',true], ['draft/shared','phone']]).engine.sync(drive);
  const before = structuredClone(drive.files);
  const result = await restore();
  assert.equal(result.uploaded, false);
  assert.equal(result.hasRemoteRecords, true);
  assert.equal(pc.store.get('saved/loops'), true);
  assert.equal(pc.store.get('draft/shared'), 'phone');
  assert.equal(pc.store.get('draft/local'), 'unsent');
  assert.deepEqual(await restore(), {changedKeys:[], uploaded:false, hasRemoteRecords:true});
  assert.deepEqual(drive.files, before);
  assert.equal(pc.engine.hasLocalChanges(), true);
  await pc.engine.sync(drive);
  assert.equal(drive.files.get(pc.engine.deviceId).records['draft/local'][0].value, 'unsent');
});

test('observed deletion, old replicas and offline restart do not resurrect data', async () => {
  const drive = cloud();
  const note = {id:'one', route:'lesson/intro', anchor:'p-1', body:'text', quote:'q', updated:1};
  const a = device('A', [['note/one',note], ['saved/intro',true]]);
  const b = device('B');
  await a.engine.sync(drive);
  await b.engine.sync(drive);
  b.store.set('note/one',null);
  b.store.set('saved/intro',false);
  // Loss of network and app restart must retain edits and the observed versions.
  await assert.rejects(b.engine.sync({readReplicas:async () => { throw Error('offline'); }}));
  const restarted = new SyncEngine(b.store,'B');
  await restarted.sync(drive);
  await a.engine.sync(drive);
  assert.equal(a.store.get('note/one'), null);
  assert.equal(a.store.get('saved/intro'), false);
  assert.deepEqual(a.engine.conflicts(), []);
  await restarted.sync(drive);
  assert.equal(b.store.get('saved/intro'), false);
});

test('concurrent drafts persist across further editing, explicit resolution and retry', async () => {
  const drive = cloud(), key = 'draft/intro';
  const a = device('A', [[key,'original']]), b = device('B');
  await a.engine.sync(drive);
  await b.engine.sync(drive);
  a.store.set(key,'from A');
  b.store.set(key,'from B');
  // Both read the same cloud generation, before either finishes its upload.
  await Promise.all([a.engine.sync(drive), b.engine.sync(drive)]);
  await a.engine.sync(drive);
  const first = a.engine.conflicts()[0];
  assert.deepEqual(new Set(first.variants.map(v=>v.value)), new Set(['from A','from B']));
  const edited = first.variants[0].value + ' + edits';
  a.store.set(key,edited);
  await a.engine.sync(drive);
  const current = a.engine.conflicts()[0];
  assert.deepEqual(new Set(current.variants.map(v=>v.value)), new Set([edited,first.variants[1].value]));
  await b.engine.sync(drive);
  const chosen = current.variants[0];
  a.engine.resolve(key,chosen.id);
  const restarted = new SyncEngine(a.store,'A');
  assert.deepEqual(restarted.conflicts(), []);
  const broken = {...drive, writeReplica:async () => { throw Error('upload failed'); }};
  await assert.rejects(restarted.sync(broken), /upload failed/);
  assert.equal(restarted.hasLocalChanges(), true);
  await restarted.sync(drive);
  assert.equal(restarted.hasLocalChanges(), false);
  await b.engine.sync(drive);
  assert.equal(b.store.get(key), edited);
  assert.deepEqual(b.engine.conflicts(), []);
});

test('renaming, deleting, and undoing a closed console draft sync under its original key', async () => {
  const key = 'secondary/scratch/1/abc', drive = cloud();
  const old = {source:'Write();', files:{'Text.cs':'class Text {}'}};
  const phone = device('Android', [[key, old]]), pc = device('ПК');
  await phone.engine.sync(drive);
  await pc.engine.sync(drive);
  const named = {...pc.store.get(key), title:'Вывод'};
  pc.store.set(key, named);
  await pc.engine.sync(drive);
  await phone.engine.sync(drive);
  assert.deepEqual(phone.store.get(key), named);
  assert.deepEqual(phone.engine.conflicts(), []);
  const backup = await phone.engine.exportSnapshot();
  phone.store.set(key, null);
  await phone.engine.sync(drive);
  await pc.engine.sync(drive);
  assert.equal(pc.store.get(key), null);
  await pc.engine.importSnapshot(backup);
  assert.equal(pc.store.get(key), null);
  phone.store.set(key, named);
  await phone.engine.sync(drive);
  await pc.engine.sync(drive);
  assert.deepEqual(pc.store.get(key), named);
  assert.deepEqual(pc.engine.conflicts(), []);
});

test('concurrent rename and deletion retain both choices for console drafts', async () => {
  const key = 'editor/intro/0', drive = cloud();
  const draft = {source:'edited',files:{},initial:{source:'example',files:{}}};
  const phone = device('Android', [[key, draft]]), pc = device('ПК');
  await phone.engine.sync(drive);
  await pc.engine.sync(drive);
  phone.store.set(key, {...draft, title:'Моя программа'});
  pc.store.set(key, null);
  await phone.engine.sync(drive);
  await pc.engine.sync(drive);
  const variants = pc.engine.conflicts()[0].variants;
  assert.equal(variants.length, 2);
  assert.ok(variants.some(item => item.value === null));
  const keep = variants.find(item => item.value?.title === 'Моя программа');
  pc.engine.resolve(key, keep.id);
  await pc.engine.sync(drive);
  await phone.engine.sync(drive);
  assert.deepEqual(phone.store.get(key), {...draft,title:'Моя программа'});
  assert.deepEqual(phone.engine.conflicts(), []);
});

test('local typing and conflict choices during network requests survive', async () => {
  const drive = cloud(), key = 'draft/intro';
  const a = device('A', [[key,'before']]), b = device('B');
  await a.engine.sync(drive);
  await b.engine.sync(drive);
  a.store.set(key,'written A');
  await a.engine.sync(drive);
  const concurrent = {
    readReplicas:async () => {
      b.store.set(key,'written B');
      return drive.readReplicas();
    },
    writeReplica:async (id,body) => {
      b.store.set('saved/other',true);
      return drive.writeReplica(id,body);
    }
  };
  await b.engine.sync(concurrent);
  assert.deepEqual(new Set(b.engine.conflicts()[0].variants.map(v=>v.value)), new Set(['written A','written B']));
  assert.equal(b.engine.hasLocalChanges(), true);
  await b.engine.sync(drive);
  await a.engine.sync(drive);
  assert.equal(a.store.get('saved/other'), true);
  assert.equal(b.engine.hasLocalChanges(), false);
});

test('invalid remote keys and invalid values are rejected before any remote data is applied', async () => {
  const drive = cloud(), a = device('A', [['read/intro',true]]), b = device('B');
  await a.engine.sync(drive);
  const [file] = await drive.readReplicas();
  const invalid = structuredClone(file);
  invalid.records['theme'] = invalid.records['read/intro'];
  await assert.rejects(b.engine.sync({readReplicas:async () => [file,invalid]}), /повреждён/);
  assert.equal(b.store.get('read/intro'), undefined);
  file.records['read/intro'][0].value = 'invalid';
  await assert.rejects(b.engine.sync({readReplicas:async () => [file]}), /повреждён/);
  assert.equal(b.store.get('read/intro'), undefined);
});

test('native JSON reserialization may reorder all properties without changing a version', async () => {
  const drive = cloud();
  const key = 'editor/while/0', draft = {source:'program',files:{'A.cs':'a','B.cs':'b'}};
  const owner = device('ПК', [[key,draft]]), reader = device('Android');
  await owner.engine.sync(drive);
  function reverseObject(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(reverseObject);
    return Object.fromEntries(Object.entries(value).reverse().map(([k,v]) => [k,reverseObject(v)]));
  }
  const [snapshot] = await drive.readReplicas();
  const reordered = reverseObject(snapshot);
  const afterNative = {readReplicas:async () => [snapshot,reordered]};
  assert.equal((await reader.engine.sync(afterNative)).uploaded, false);
  owner.store.set(key,reverseObject(draft));
  assert.equal(owner.engine.hasLocalChanges(), false);
  assert.equal((await owner.engine.sync(afterNative)).uploaded, false);
});

test('restarts recover a download interrupted between metadata and local progress writes', async () => {
  const drive = cloud(), a = device('A', [['draft/while','hello']]), b = device('B');
  await a.engine.sync(drive);
  const original = b.store.set.bind(b.store);
  b.store.set = (key,value) => {
    if (key === 'draft/while') throw Error('simulated interruption');
    original(key,value);
  };
  await assert.rejects(b.engine.sync(drive), /interruption/);
  assert.equal(b.store.get('draft/while'), undefined);
  b.store.set = original;
  const restarted = new SyncEngine(b.store,'B');
  assert.equal(b.store.get('draft/while'), 'hello');
  assert.equal((await restarted.sync(drive)).uploaded, false);
});

test('new versions are only uploaded after the local store confirms persistence', async () => {
  const drive = cloud();
  const {engine,store} = device('Android', [['draft/intro','offline edit']]);
  store.flush = async () => { throw Error('storage full'); };
  await assert.rejects(engine.sync(drive), /storage full/);
  assert.equal(drive.files.size, 0);
  store.flush = async () => {};
  await engine.sync(drive);
  assert.equal(drive.files.size, 1);
});

test('offline file exchange converges, retains diverging drafts and can be uploaded later', async () => {
  const key = 'draft/while', a = device('ПК', [[key,'desktop'],['theme','dark']]);
  const b = device('Android', [[key,'mobile'],['solved/lesson/while/original',true]]);
  const outgoing = await a.engine.exportSnapshot();
  assert.equal(a.engine.hasLocalChanges(), true);
  assert.equal(Object.hasOwn(outgoing.records,'theme'), false);
  const {changedKeys} = await b.engine.importSnapshot(JSON.parse(JSON.stringify(outgoing)));
  assert.ok(Array.isArray(changedKeys));
  assert.equal(b.engine.hasLocalChanges(), true);
  const choices = b.engine.conflicts()[0].variants;
  assert.deepEqual(new Set(choices.map(v=>v.value)), new Set(['mobile','desktop']));
  b.engine.resolve(key,choices.find(v=>v.value==='mobile').id);
  const response = await b.engine.exportSnapshot();
  await a.engine.importSnapshot(response);
  assert.equal(a.store.get('solved/lesson/while/original'), true);
  assert.equal(a.store.get(key),'mobile');
  assert.deepEqual(a.engine.conflicts(), []);
  assert.deepEqual((await a.engine.importSnapshot(outgoing)).changedKeys, []);
  assert.equal(a.store.get(key),'mobile');
  const drive = cloud();
  assert.equal((await a.engine.sync(drive)).uploaded,true);
  assert.equal(a.engine.hasLocalChanges(), false);
  assert.equal((await a.engine.importSnapshot(response)).changedKeys.length,0);
  assert.equal(a.engine.hasLocalChanges(), false);
});

test('a rejected file never applies any of its valid entries or clears unsent changes', async () => {
  const a = device('A', [['draft/hello','pending']]), b = device('B', [['read/loop',true]]);
  const bad = await b.engine.exportSnapshot();
  bad.records['theme'] = bad.records['read/loop'];
  await assert.rejects(a.engine.importSnapshot(bad), /повреждён/);
  assert.equal(a.store.get('read/loop'), undefined);
  assert.equal(a.engine.hasLocalChanges(), true);
  const good = await b.engine.exportSnapshot();
  a.store.flush = async () => { throw Error('disk full'); };
  await assert.rejects(a.engine.importSnapshot(good), error => error.changedKeys.includes('read/loop'));
  assert.equal(a.engine.hasLocalChanges(), true);
  await assert.rejects(a.engine.exportSnapshot(), /disk full/);
});

test('linked file mode creates a stable own replica once, even for an empty device', async () => {
  const drive = {...cloud(),ensureOwnReplica:true};
  const pc = device('ПК'), phone = device('Android', [['draft/intro','phone']]);
  const blankId = pc.engine.deviceId;
  assert.equal((await pc.engine.sync(drive)).uploaded,true);
  assert.deepEqual(drive.files.get(blankId).records,{});
  assert.equal((await pc.engine.sync(drive)).uploaded,false);
  await phone.engine.sync(drive);
  assert.equal(drive.files.size,2);
  await pc.engine.sync(drive);
  assert.equal(pc.store.get('draft/intro'),'phone');
  const added = device('Tablet');
  assert.equal((await added.engine.sync(drive)).uploaded,true);
  assert.equal(added.store.get('draft/intro'),'phone');
  assert.equal(drive.files.get(added.engine.deviceId).records['draft/intro'][0].value,'phone');
  assert.equal((await added.engine.sync(drive)).uploaded,false);
  assert.equal(new SyncEngine(pc.store,'ПК').deviceId,blankId);
  const ordinary = cloud();
  assert.equal((await device('New').engine.sync(ordinary)).uploaded,false);
  assert.equal(ordinary.files.size,0);
});
