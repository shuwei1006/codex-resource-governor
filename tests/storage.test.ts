import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/storage.js';
import {config, task} from './helpers.js';

test('atomic state updates serialize across independent Store instances and preserve private permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crg-test-'));
  try {
    const store = new Store(directory); await store.saveConfig(config);
    await Promise.all(Array.from({length: 12}, (_, i) => new Store(directory).update(s => s.tasks.push({...task(), id: String(i)}))));
    assert.equal((await store.state()).tasks.length, 12);
    assert.deepEqual(await store.config(), config);
    assert.equal((await stat(join(directory, 'state.json'))).mode & 0o777, 0o600);
  } finally {await rm(directory, {recursive: true, force: true});}
});
test('corrupt data fails explicitly and remains untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crg-test-'));
  try {
    const store = new Store(directory);
    assert.equal(await store.config(), null);
    await writeFile(join(directory, 'state.json'), '{broken');
    await assert.rejects(store.update(s => {s.tasks = [];}), /not overwritten/);
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), '{broken');
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('concurrent stale-lock recovery does not remove a replacement lock', async () => {
  const {mkdir} = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'crg-stale-'));
  try {
    await mkdir(join(directory, '.write-lock'));
    // A PID outside supported platform PID ranges cannot be a live process.
    await writeFile(join(directory, '.write-lock', 'pid'), '2147483647');
    await Promise.all(Array.from({length: 8}, (_, i) => new Store(directory).update(s => s.tasks.push({...task(), id: `recovered-${i}`}))));
    assert.equal((await new Store(directory).state()).tasks.length, 8);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('version 1 files and mixed legacy fields are rejected without overwriting data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crg-legacy-schema-'));
  try {
    const store = new Store(directory);
    const {primary, ...rest} = config;
    const legacyConfig = JSON.stringify({...rest, version: 1, normal: primary});
    const legacyState = JSON.stringify({version: 1, tasks: [{...task(), priority: 'normal'}]});
    await writeFile(join(directory, 'config.json'), legacyConfig);
    await writeFile(join(directory, 'state.json'), legacyState);
    await assert.rejects(store.config(), /schema version 2.*Legacy files are not supported/);
    await assert.rejects(store.update(state => {state.tasks = [];}), /not overwritten/);
    assert.equal(await readFile(join(directory, 'config.json'), 'utf8'), legacyConfig);
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), legacyState);
    await assert.rejects(store.saveConfig({...config, normal: primary} as typeof config));
    assert.equal(await readFile(join(directory, 'config.json'), 'utf8'), legacyConfig);
    for (const policy of ['quality', 'saver']) {
      await writeFile(join(directory, 'config.json'), JSON.stringify({...config, policy}));
      await assert.rejects(store.config(), /not overwritten/);
    }
    await writeFile(join(directory, 'state.json'), JSON.stringify({version: 2, tasks: [{...task(), priority: 'normal'}]}));
    await assert.rejects(store.state(), /not overwritten/);
  } finally {await rm(directory, {recursive: true, force: true});}
});
