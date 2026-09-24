import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {Governor} from '../src/governor.js';
import {AppServer, RpcError, type Rpc} from '../src/rpc.js';
import {Store} from '../src/storage.js';
import {config, models} from './helpers.js';

class FakeRpc extends EventEmitter implements Rpc {
  remaining = 80;
  failQuota = false;
  failInterrupt = false;
  resumeMissing = false;
  calls: {method: string; params: Record<string, unknown>}[] = [];
  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({method, params});
    if (method === 'account/read') return {account: {type: 'chatgpt'}};
    if (method === 'account/rateLimits/read') {if (this.failQuota) throw new Error('quota unavailable'); return {rateLimits: {primary: {usedPercent: 100 - this.remaining, windowDurationMins: 10080, resetsAt: 9999999999}}};}
    if (method === 'model/list') return {data: models};
    if (method === 'thread/resume' && this.resumeMissing) throw new RpcError(-32600, 'no rollout found for thread id managed-thread');
    if (method === 'thread/start' || method === 'thread/resume') return {thread: {id: 'managed-thread', turns: []}};
    if (method === 'turn/start') return {turn: {id: `turn-${this.calls.length}`, status: 'inProgress'}};
    if (method === 'turn/interrupt' && this.failInterrupt) throw new Error('interrupt failed');
    return {};
  }
  reply() {}
  reject() {}
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'crg-managed-'));
  const store = new Store(directory); await store.saveConfig(config);
  const rpc = new FakeRpc(); const governor = new Governor(rpc, store); await governor.initialize();
  const cleanup = async () => {await governor.dispose(); await rm(directory, {recursive: true, force: true});};
  return {store, rpc, governor, cleanup};
}
test('running Current remains immutable while Next follows quota, High and Keep changes', async () => {
  const {rpc, governor, cleanup} = await setup();
  try {
    const task = await governor.createTask('Research');
    await governor.startTurn(task.id, 'First prompt');
    assert.deepEqual(governor.task(task.id).current, config.primary);
    rpc.remaining = 5; await governor.refresh();
    assert.deepEqual(governor.task(task.id).current, config.primary);
    assert.deepEqual(governor.decision(governor.task(task.id)).next, config.economy);
    assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
    await assert.rejects(governor.startTurn(task.id, 'Cannot race'), /active turn/);
    await governor.setPriority(task.id, 'high');
    assert.deepEqual(governor.decision(governor.task(task.id)).next, config.primary);
    await governor.setPriority(task.id, 'low'); await governor.setMode(task.id, 'keep');
    assert.deepEqual(governor.decision(governor.task(task.id)).next, config.primary);
  } finally {await cleanup();}
});
test('manual fixes future turns, invalid selection preserves mode, and off blocks Governor dispatch', async () => {
  const {rpc, governor, cleanup} = await setup();
  try {
    const task = await governor.createTask('Control');
    await governor.startTurn(task.id, 'First');
    await governor.setMode(task.id, 'manual', config.economy);
    assert.deepEqual(governor.task(task.id).current, config.primary);
    assert.equal(governor.task(task.id).currentMode, 'auto');
    await assert.rejects(governor.setMode(task.id, 'manual', {model: 'missing', effort: 'high'}), /unavailable/);
    assert.deepEqual(governor.task(task.id).manualSelection, config.economy);
    rpc.emit('notification', 'turn/completed', {threadId: task.threadId, turn: {id: governor.task(task.id).turnId, status: 'completed'}});
    await governor.refresh();
    await governor.startTurn(task.id, 'Second');
    assert.deepEqual(governor.task(task.id).current, config.economy);
    assert.equal(governor.task(task.id).currentMode, 'manual');
    await governor.setMode(task.id, 'off');
    const count = rpc.calls.filter(call => call.method === 'turn/start').length;
    await assert.rejects(governor.startTurn(task.id, 'No dispatch'), /Governance is off/);
    assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, count);
  } finally {await cleanup();}
});
test('next turn carries model and effort overrides, task resume works, missing quota preserves holds', async () => {
  const {rpc, governor, store, cleanup} = await setup();
  try {
    rpc.remaining = 5; await governor.refresh();
    const task = await governor.createTask('Analysis', 'low');
    rpc.failQuota = true; await governor.startTurn(task.id, 'Run analysis');
    const start = rpc.calls.find(c => c.method === 'turn/start');
    assert.equal(start?.params.model, config.economy.model); assert.equal(start?.params.effort, config.economy.effort);
    assert.equal(governor.decision(governor.task(task.id)).stage, 2);
    rpc.emit('notification', 'turn/completed', {threadId: task.threadId, turn: {id: governor.task(task.id).turnId, status: 'completed'}});
    await governor.refresh();
    assert.equal((await store.state()).tasks[0]?.status, 'completed');
    const second = new Governor(rpc, store); await second.initialize();
    try {await second.startTurn(task.id, 'Continue'); assert.ok(rpc.calls.some(c => c.method === 'thread/resume'));}
    finally {await second.dispose();}
  } finally {await cleanup();}
});
test('two Governor sessions cannot submit simultaneous turns for the same task', async () => {
  const {rpc, governor, store, cleanup} = await setup();
  const task = await governor.createTask('One owner');
  const other = new Governor(rpc, store); await other.initialize();
  try {
    const results = await Promise.allSettled([governor.startTurn(task.id, 'first'), other.startTurn(task.id, 'second')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
  } finally {await other.dispose(); await cleanup();}
});
test('another Governor session can interrupt a running task by ID', async () => {
  const {governor, store, cleanup} = await setup();
  const task = await governor.createTask('Cross-terminal interrupt');
  await governor.startTurn(task.id, 'Keep running');
  const rpc = new FakeRpc();
  const other = new Governor(rpc, store); await other.initialize();
  try {
    const turnId = other.task(task.id).turnId;
    await other.interrupt(task.id.slice(0, 8));
    assert.ok(rpc.calls.some(call => call.method === 'thread/resume' && call.params.threadId === task.threadId));
    assert.ok(rpc.calls.some(call => call.method === 'turn/interrupt' && call.params.threadId === task.threadId && call.params.turnId === turnId));
    assert.equal((await store.state()).tasks[0]?.status, 'interrupted');
    assert.equal((await store.state()).tasks[0]?.ownerPid, null);
  } finally {await other.dispose(); await cleanup();}
});
test('deleting a running record interrupts first and retains the record if interruption fails', async () => {
  const {governor, store, rpc: ownerRpc, cleanup} = await setup();
  const task = await governor.createTask('Delete safely');
  await governor.startTurn(task.id, 'Keep running');
  const failingRpc = new FakeRpc(); failingRpc.failInterrupt = true;
  const failing = new Governor(failingRpc, store); await failing.initialize();
  try {
    await assert.rejects(failing.deleteTask(task.id), /interrupt failed/);
    assert.equal((await store.state()).tasks.length, 1);
  } finally {await failing.dispose();}
  const deletingRpc = new FakeRpc();
  const deleting = new Governor(deletingRpc, store); await deleting.initialize();
  try {
    const deleted = await deleting.deleteTask(task.id);
    assert.equal(deleted.id, task.id);
    assert.equal((await store.state()).tasks.length, 0);
    assert.ok(deletingRpc.calls.some(call => call.method === 'turn/interrupt'));
    ownerRpc.emit('notification', 'turn/completed', {threadId: task.threadId, turn: {id: governor.task(task.id).turnId, status: 'interrupted'}});
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await store.state()).tasks.length, 0);
  } finally {await deleting.dispose(); await cleanup();}
});
test('fast completion events arriving before turn/start response are persisted correctly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crg-integration-'));
  const store = new Store(directory); await store.saveConfig(config);
  const rpc = new AppServer(process.execPath, 2000, [fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url))]);
  let governor: Governor | undefined;
  try {
    await rpc.start(); governor = new Governor(rpc, store); await governor.initialize();
    const task = await governor.createTask('Fast'); await governor.startTurn(task.id, 'Hello');
    await governor.refresh();
    assert.equal(governor.task(task.id).status, 'completed'); assert.equal(governor.taskOutput(governor.task(task.id)), 'Fixture reply: OK');
  } finally {await governor?.dispose(); rpc.close(); await rm(directory, {recursive: true, force: true});}
});
test('unpersisted empty threads can be recreated, but possibly submitted turns are never replayed', async () => {
  const {rpc, governor, store, cleanup} = await setup();
  const task = await governor.createTask('Empty');
  const second = new Governor(rpc, store); await second.initialize(); rpc.resumeMissing = true;
  try {
    await second.startTurn(task.id, 'First ever prompt');
    assert.equal(rpc.calls.filter(c => c.method === 'thread/start').length, 2);
    assert.equal((await store.state()).tasks[0]?.id, task.id);
    assert.equal((await store.state()).tasks[0]?.hasSubmitted, true);
    await second.dispose();
    const third = new Governor(rpc, store); await third.initialize();
    try {await assert.rejects(third.startTurn(task.id, 'Do not replay'), /no rollout found/); assert.equal(rpc.calls.filter(c => c.method === 'thread/start').length, 2);}
    finally {await third.dispose();}
  } finally {await second.dispose(); await cleanup();}
});
