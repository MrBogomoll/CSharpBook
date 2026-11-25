const metadataKey = 'cloud-sync/replica-v1';
const snapshotVersion = 1;
const maxConcurrentVersions = 256;
const maxSnapshotBytes = 8 * 1024 * 1024;
const devicePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const textEncoder = new TextEncoder();

export function isSyncKey(key) {
  return typeof key === 'string' && key.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(key) &&
    /^(?:secondary\/)?(?:(?:read|saved|solved|note|example|answer|draft|editor|scratch|snippet)\/.+|last|last-reading)$/.test(key);
}

function newDevice() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validValue(key, value) {
  const path = key.replace(/^secondary\//, '');
  const kind = path.split('/')[0];
  if (kind === 'read' || kind === 'saved' || kind === 'solved') return typeof value === 'boolean';
  if (kind === 'answer' || kind === 'example') return Number.isSafeInteger(value) && value >= 0;
  if (kind === 'last') return typeof value === 'string' && /^[\w-]+$/.test(value);
  if (kind === 'last-reading') return typeof value === 'string' && /^(chapter\/\d+|lesson\/[\w-]+(?:\/[\w-]+)?)$/.test(value);
  if (kind === 'draft') return typeof value === 'string';
  if (kind === 'note') {
    return value === null || (plain(value) && value.id === path.slice(5) && /^[\w-]+$/.test(value.id) &&
      typeof value.route === 'string' && /^(chapter\/\d+|lesson\/[\w-]+(?:\/[\w-]+)?)$/.test(value.route) &&
      typeof value.body === 'string' && typeof value.quote === 'string' && typeof value.anchor === 'string' &&
      ['start','endOffset','example','updated'].every(name =>
        value[name] === undefined || (Number.isSafeInteger(value[name]) && value[name] >= 0)) &&
      ['file','endAnchor'].every(name => value[name] === undefined || typeof value[name] === 'string'));
  }
  return value === null || (plain(value) && typeof value.source === 'string' &&
    plain(value.files) && Object.entries(value.files).every(([name, text]) =>
      !['__proto__','constructor','prototype'].includes(name) && typeof text === 'string'));
}

function sameValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

function dot(version) {
  return version.actor + ':' + version.clock[version.actor];
}

function isContent(key) {
  return /^(?:secondary\/)?(?:note|draft|editor|scratch|snippet)\//.test(key);
}

function order(key, a, b) {
  // Independent pre-existing marks combine on first pairing. A later, observed
  // removal dominates the mark and never reaches this tie-breaker.
  if (/^(?:secondary\/)?(?:saved|read|solved)\//.test(key) && a.value !== b.value) {
    return a.value ? -1 : 1;
  }
  if (a.updated !== b.updated) return b.updated - a.updated;
  const left = dot(a), right = dot(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function dominates(a, b) {
  return Object.entries(b.clock).every(([actor, count]) => (a.clock[actor] || 0) >= count);
}

function mergeKey(key, versions) {
  const unique = new Map();
  for (const version of versions) {
    const id = dot(version), existing = unique.get(id);
    if (existing && !sameValue(existing, version)) throw Error('В облаке найдены несовместимые версии одной записи.');
    unique.set(id, version);
  }
  const all = [...unique.values()];
  return all.filter(version => !all.some(other => other !== version && dominates(other, version)))
    .sort((a,b) => order(key, a, b));
}

function merge(...documents) {
  const result = {};
  for (const records of documents) {
    for (const [key, variants] of Object.entries(records)) {
      result[key] = mergeKey(key, (result[key] || []).concat(variants));
      if (!result[key].length) throw Error('История изменений в облаке повреждена.');
    }
  }
  return result;
}

function sameRecords(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => sameValue(left[key], right[key]));
}

function checkedSnapshot(snapshot) {
  const invalid = () => { throw Error('Облачный файл учебника повреждён или создан неподдерживаемой версией.'); };
  if (!plain(snapshot) || snapshot.format !== snapshotVersion || !devicePattern.test(snapshot.deviceId) ||
      !plain(snapshot.records)) invalid();
  if (textEncoder.encode(JSON.stringify(snapshot)).length > maxSnapshotBytes) {
    throw Error('Файл синхронизации превышает 8 МБ.');
  }
  for (const [key, variants] of Object.entries(snapshot.records)) {
    if (!isSyncKey(key) || !Array.isArray(variants) || variants.length === 0 || variants.length > maxConcurrentVersions) invalid();
    for (const item of variants) {
      if (!plain(item) || !devicePattern.test(item.device) || !devicePattern.test(item.actor) ||
          typeof item.label !== 'string' || item.label.length > 100 ||
          !Number.isSafeInteger(item.updated) || item.updated < 0 || !plain(item.clock) ||
          !Object.hasOwn(item.clock, item.actor) ||
          !Object.entries(item.clock).every(([actor,n]) => devicePattern.test(actor) && Number.isSafeInteger(n) && n > 0) ||
          !validValue(key, item.value)) invalid();
    }
  }
  return snapshot;
}

export class SyncEngine {
  constructor(store, label) {
    this.store = store;
    this.label = label;
    this.queue = Promise.resolve();
    this.state = store.get(metadataKey, null);
    if (this.state) {
      checkedSnapshot(this.snapshot(this.state.records));
      this.finishApplying();
    } else {
      this.state = {device:newDevice(), records:{}, dirty:false, pending:[]};
      this.capture(true);
      this.persist();
    }
  }

  get deviceId() { return this.state.device; }

  snapshot(records) {
    return {format:snapshotVersion, deviceId:this.state.device, records};
  }

  persist() {
    // BookStore mirrors writes to localStorage and IndexedDB. A fresh top-level
    // object keeps earlier queued IndexedDB writes and event observers isolated.
    this.store.set(metadataKey, {...this.state});
  }

  hasLocalChanges() {
    if (this.state.dirty) return true;
    for (const [key, value] of this.store.values) {
      if (isSyncKey(key) && !sameValue(this.state.records[key]?.[0].value, value)) return true;
    }
    return false;
  }

  writeVersion(key, value, parents, updated) {
    const versions = this.state.records[key] || [];
    const clock = {};
    for (const parent of parents) {
      for (const [actor, count] of Object.entries(parent.clock)) {
        clock[actor] = Math.max(clock[actor] || 0, count);
      }
    }
    // Editing the displayed draft after a conflict must keep the other draft
    // available until the learner explicitly picks one. Fork the writer clock
    // if incrementing it would silently acknowledge one of those alternatives.
    const ownParent = parents.find(item => item.device === this.state.device);
    let actor = ownParent?.actor || this.state.device;
    if (versions.some(item => (item.clock[actor] || 0) > (clock[actor] || 0))) actor = newDevice();
    clock[actor] = (clock[actor] || 0) + 1;
    const version = {actor, clock, device:this.state.device, label:this.label, updated, value};
    this.state.records[key] = mergeKey(key, [...versions, version]);
    this.state.dirty = true;
  }

  capture(initial = false) {
    let changed = false;
    for (const [key, value] of this.store.values) {
      if (!isSyncKey(key)) continue;
      const versions = this.state.records[key] || [];
      if (sameValue(versions[0]?.value, value)) continue;
      if (!validValue(key, value)) throw Error('Учебник не смог прочитать локальную запись «' + key + '».');
      const parents = isContent(key) && versions.length
        ? versions.filter(item => sameValue(item.value, versions[0].value)) : versions;
      const updated = initial ? (Number.isSafeInteger(value?.updated) ? value.updated : 0)
        : versions.reduce((time, item) => Math.max(time, item.updated + 1), Date.now());
      if (!changed) this.state.records = {...this.state.records};
      this.writeVersion(key, value, parents, updated);
      changed = true;
    }
    if (changed) this.persist();
  }

  finishApplying() {
    if (!this.state.pending?.length) return;
    for (const {key, before} of this.state.pending) {
      const desired = this.state.records[key][0].value;
      // A local edit made after the write-ahead record takes precedence.
      if (sameValue(this.store.get(key, undefined), before)) this.store.set(key, desired);
    }
    this.state.pending = [];
    this.persist();
  }

  apply(records, dirty) {
    const pending = [];
    for (const [key, variants] of Object.entries(records)) {
      const before = this.store.get(key, undefined);
      if (!sameValue(before, variants[0].value)) pending.push({key, before});
    }
    if (!pending.length && dirty === this.state.dirty && sameRecords(records, this.state.records)) return [];
    this.state = {...this.state, records, pending, dirty};
    this.persist();
    this.finishApplying();
    return pending.map(item => item.key);
  }

  conflicts() {
    this.capture();
    return Object.entries(this.state.records).filter(([key, versions]) =>
      isContent(key) && versions.some(item => !sameValue(item.value, versions[0].value)))
      .map(([key, versions]) => ({key, variants:versions.map(item => ({
        id:dot(item), device:item.device, label:item.label, value:item.value, updated:item.updated
      }))}));
  }

  resolve(key, id) {
    this.capture();
    const versions = this.state.records[key] || [];
    const chosen = versions.find(item => dot(item) === id);
    if (!chosen) throw Error('Список версий изменился. Открой его ещё раз.');
    this.state.records = {...this.state.records};
    this.writeVersion(key, chosen.value, versions, Date.now());
    const changedKeys = this.apply(this.state.records, true);
    this.persist();
    return changedKeys;
  }

  enqueue(operation) {
    // File imports and cloud exchanges share a single order on this device.
    const run = this.queue.then(operation);
    this.queue = run.catch(() => {});
    return run;
  }

  sync(provider, {restoreOnly = false} = {}) {
    return this.enqueue(() => this.exchange(provider, restoreOnly));
  }

  exportSnapshot() {
    return this.enqueue(async () => {
      this.capture();
      const snapshot = checkedSnapshot(this.snapshot(this.state.records));
      await this.store.flush?.();
      return structuredClone(snapshot);
    });
  }

  importSnapshot(snapshot) {
    return this.enqueue(async () => {
      const incoming = checkedSnapshot(snapshot);
      this.capture();
      const records = merge(this.state.records, incoming.records);
      checkedSnapshot(this.snapshot(records));
      const dirty = this.state.dirty || !sameRecords(records, this.state.records);
      const changedKeys = this.apply(records, dirty);
      await this.flushChanges(changedKeys);
      return {changedKeys};
    });
  }

  async flushChanges(changedKeys) {
    try {
      await this.store.flush?.();
    } catch (error) {
      if (error instanceof Error) error.changedKeys = changedKeys;
      throw error;
    }
  }

  async exchange(provider, restoreOnly) {
    this.capture();
    const downloads = await provider.readReplicas();
    const remote = merge(...downloads.map(item => checkedSnapshot(item).records));
    // Reading the network can take seconds. Include keystrokes and resolutions
    // made during that wait before installing anything on the local machine.
    this.capture();
    const records = merge(remote, this.state.records);
    // A user pairing individual documents must be able to pick our file even
    // when this device is new or the peer already has every progress record.
    const missingOwnFile = provider.ensureOwnReplica && !downloads.some(item => item.deviceId === this.deviceId);
    const needsUpload = !sameRecords(remote, records) || Boolean(missingOwnFile);
    const snapshot = checkedSnapshot(this.snapshot(records));
    const changedKeys = this.apply(records, needsUpload);
    const writtenRecords = this.state.records;
    await this.flushChanges(changedKeys);
    const uploaded = needsUpload && !restoreOnly;
    if (uploaded) {
      try {
        await provider.writeReplica(this.state.device, snapshot);
      } catch (error) {
        if (error instanceof Error) error.changedKeys = changedKeys;
        throw error;
      }
      if (this.state.records === writtenRecords) {
        this.state.dirty = false;
        this.persist();
        await this.flushChanges(changedKeys);
      }
    }
    return {changedKeys, uploaded, hasRemoteRecords:Object.keys(remote).length > 0};
  }
}
