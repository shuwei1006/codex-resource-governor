import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {nativeLinks, openNative, findTask} from '../src/native.js';
import {task} from './helpers.js';

test('native routes use the Codex UUID, never the Governor task ID', () => {
  const value = {...task(), threadId: randomUUID()};
  assert.deepEqual(nativeLinks(value, 'both'), [`codex://threads/${value.threadId}`, `vscode://openai.chatgpt/local/${value.threadId}`]);
  assert.throws(() => nativeLinks({...value, threadId: '../../new?prompt=unexpected'}, 'app'));
  assert.equal(findTask([value], value.id.slice(0, 4)), value);
  assert.equal(findTask([value], value.threadId), value);
  assert.throws(() => findTask([value, {...value, id: 'test-another'}], 'test'), /Ambiguous/);
});

test('native handoff blocks active/empty threads and attempts both targets on a partial launch failure', async () => {
  const value = {...task(), threadId: randomUUID(), hasSubmitted: true, status: 'completed' as const};
  const opened: string[] = [];
  const launch = async (uri: string) => {opened.push(uri);};
  for (const status of ['starting', 'running', 'unknown'] as const) await assert.rejects(openNative({...value, status}, 'app', launch), /finish/);
  await assert.rejects(openNative({...value, hasSubmitted: false}, 'app', launch), /no submitted turn/);
  assert.equal(opened.length, 0);
  await openNative(value, 'both', launch);
  assert.deepEqual(opened, nativeLinks(value, 'both'));
  opened.length = 0;
  await assert.rejects(openNative(value, 'both', async uri => {opened.push(uri); if (uri.startsWith('codex:')) throw new Error('not installed');}), /Could not open codex:/);
  assert.equal(opened.length, 2);
});
