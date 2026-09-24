import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {IdePolicyProxy} from '../src/ide-proxy.js';
import {AppServer, RpcError, type Rpc} from '../src/rpc.js';
import {Store} from '../src/storage.js';
import {config, models, task} from './helpers.js';
import {changeControl} from '../src/control.js';

class FakeRpc extends EventEmitter implements Rpc {
  calls: {method: string; params: unknown}[] = [];
  remaining = 5;
  failTurn = false;
  async request(method: string, params: unknown = {}): Promise<unknown> {
    this.calls.push({method, params});
    if (method === 'account/read') return {account: {type: 'chatgpt'}};
    if (method === 'model/list') return {data: models};
    if (method === 'account/rateLimits/read') return {rateLimits: {primary: {usedPercent: 100 - this.remaining, windowDurationMins: 10080, resetsAt: 9999999999}}};
    if (method === 'turn/start') {
      if (this.failTurn) throw new RpcError(-32001, 'Rejected');
      return {turn: {id: `turn-${this.calls.length}`, status: 'inProgress'}};
    }
    return {echo: params};
  }
  reply() {}
  reject() {}
}

test('IDE turns apply current quota/priority while retaining native input, approvals and collaboration settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'governor-ide-policy-'));
  const store = new Store(directory);
  const rpc = new FakeRpc(); const proxy = new IdePolicyProxy(rpc, store);
  try {
    await store.saveConfig(config); await store.update(state => state.tasks.push(task()));
    const original = {threadId: task().threadId, input: [{type: 'text', text: '继续修改'}, {type: 'localImage', path: '/tmp/card.png'}], model: 'native-choice', effort: 'high', approvalPolicy: 'on-request', sandboxPolicy: {type: 'workspaceWrite'}, collaborationMode: {mode: 'plan', settings: {model: 'native-choice', reasoning_effort: 'high', developer_instructions: 'Preserve me'}}};
    const result = await proxy.request('turn/start', original) as {turn: {id: string}};
    const params = rpc.calls.find(call => call.method === 'turn/start')!.params as typeof original;
    assert.equal(params.model, config.economy.model);
    assert.equal(params.effort, config.economy.effort);
    assert.deepEqual(params.input, original.input);
    assert.deepEqual(params.sandboxPolicy, original.sandboxPolicy);
    assert.equal(params.approvalPolicy, original.approvalPolicy);
    assert.deepEqual(params.collaborationMode, {...original.collaborationMode, settings: {...original.collaborationMode.settings, model: config.economy.model, reasoning_effort: config.economy.effort}});
    assert.equal(original.model, 'native-choice');
    await assert.rejects(proxy.request('turn/start', original), /active turn/);
    proxy.notification('item/agentMessage/delta', {threadId: task().threadId, delta: 'Native output'});
    proxy.notification('turn/completed', {threadId: task().threadId, turn: {id: result.turn.id, status: 'completed'}});
    await proxy.close();
    assert.equal((await store.state()).tasks[0]?.output, 'Native output');
    await store.update(state => {state.tasks[0]!.priority = 'high';});
    await proxy.request('turn/start', original);
    const last = rpc.calls.filter(call => call.method === 'turn/start').at(-1)!.params as typeof original;
    assert.equal(last.model, config.normal.model); assert.equal(last.effort, config.normal.effort);
  } finally {await proxy.close(); await rm(directory, {recursive: true, force: true});}
});

test('unmanaged conversations pass through and invalid managed settings never dispatch a turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'governor-ide-errors-'));
  const store = new Store(directory); const rpc = new FakeRpc(); const proxy = new IdePolicyProxy(rpc, store);
  try {
    const params = {threadId: 'unmanaged', input: [{type: 'text', text: 'hello'}], model: 'native-model'};
    await proxy.request('turn/start', params);
    assert.deepEqual(rpc.calls, [{method: 'turn/start', params}]);
    rpc.calls.length = 0;
    await store.update(state => state.tasks.push(task()));
    await assert.rejects(proxy.request('turn/start', {threadId: task().threadId}), /configuration is missing/);
    assert.equal(rpc.calls.length, 0);
    await store.saveConfig(config);
    await assert.rejects(proxy.request('turn/start', {threadId: task().threadId, collaborationMode: {settings: null}}));
    assert.equal((await store.state()).tasks[0]?.status, 'idle');
    rpc.failTurn = true;
    await assert.rejects(proxy.request('turn/start', {threadId: task().threadId}), /Rejected/);
    assert.equal((await store.state()).tasks[0]?.status, 'failed');
    assert.equal((await store.state()).tasks[0]?.ownerPid, null);
  } finally {await proxy.close(); await rm(directory, {recursive: true, force: true});}
});
test('off forwards exact native settings without config; manual overrides native settings without reading quota', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'governor-ide-modes-'));
  const store = new Store(directory); const rpc = new FakeRpc(); const proxy = new IdePolicyProxy(rpc, store);
  try {
    await store.update(state => {const value = task(); changeControl(value, 'off'); state.tasks.push(value);});
    const params = {threadId: task().threadId, model: 'native-model', effort: 'high', collaborationMode: {mode: 'plan', settings: {model: 'native-plan-model', reasoning_effort: 'low'}}};
    await proxy.request('turn/start', params);
    assert.deepEqual(rpc.calls, [{method: 'turn/start', params}]);
    assert.equal((await store.state()).tasks[0]?.current, null);
    await store.saveConfig(config);
    await store.update(state => {changeControl(state.tasks[0]!, 'manual', {model: 'model-a', effort: 'low'}); state.tasks[0]!.priority = 'high';});
    rpc.calls.length = 0;
    await proxy.request('turn/start', params);
    assert.ok(!rpc.calls.some(call => call.method === 'account/rateLimits/read'));
    assert.equal((await store.state()).tasks[0]?.currentMode, 'manual');
    assert.deepEqual((await store.state()).tasks[0]?.current, {model: 'model-a', effort: 'low'});
  } finally {await proxy.close(); await rm(directory, {recursive: true, force: true});}
});

test('control edits during proxy preflight stop stale dispatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'governor-ide-race-'));
  const store = new Store(directory); const rpc = new FakeRpc(); const proxy = new IdePolicyProxy(rpc, store);
  const original = rpc.request.bind(rpc);
  try {
    await store.saveConfig(config); await store.update(state => state.tasks.push(task()));
    rpc.request = async (method, params) => {
      if (method === 'model/list') await store.update(state => {changeControl(state.tasks[0]!, 'off');});
      return original(method, params);
    };
    await assert.rejects(proxy.request('turn/start', {threadId: task().threadId}), /control changed/);
    assert.ok(!rpc.calls.some(call => call.method === 'turn/start'));
    assert.equal((await store.state()).tasks[0]?.status, 'idle');
  } finally {await proxy.close(); await rm(directory, {recursive: true, force: true});}
});

test('real proxy process preserves handshake, notifications, server requests, error data and fast completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'governor-ide-wire-'));
  const store = new Store(directory);
  const previousHome = process.env.CODEX_GOVERNOR_HOME;
  const previousCodex = process.env.CODEX_GOVERNOR_CODEX;
  process.env.CODEX_GOVERNOR_HOME = directory;
  process.env.CODEX_GOVERNOR_CODEX = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
  const rpc = new AppServer(process.execPath, 10_000, ['--import', 'tsx', fileURLToPath(new URL('../src/codex-proxy.ts', import.meta.url)), 'app-server']);
  try {
    await store.saveConfig(config); await store.update(state => state.tasks.push(task()));
    let receivedRequest = false; let completed = false;
    rpc.on('serverRequest', request => {receivedRequest = true; rpc.reply(request.id, {decision: 'decline'});});
    rpc.on('notification', method => {if (method === 'turn/completed') completed = true;});
    const initialize = {clientInfo: {name: 'codex_vscode', version: 'test'}, capabilities: {experimentalApi: true}};
    await rpc.start(initialize);
    assert.deepEqual(await rpc.request('test/initialize-params'), initialize);
    assert.deepEqual(await rpc.request('test/request-roundtrip'), {decision: 'decline'});
    assert.ok(receivedRequest);
    await assert.rejects(rpc.request('test/error-data'), error => error instanceof RpcError && error.code === -32002 && (error.data as {reason: string}).reason === 'fixture');
    await rpc.request('turn/start', {threadId: task().threadId, input: [{type: 'text', text: 'Keep the entire prompt'}], model: 'native-model', effort: 'high'});
    assert.ok(completed);
    const forwarded = await rpc.request('test/turn-params') as {model: string; effort: string};
    assert.equal(forwarded.model, config.normal.model); assert.equal(forwarded.effort, 'medium');
    for (let attempt = 0; attempt < 100 && (await store.state()).tasks[0]?.status !== 'completed'; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await store.state()).tasks[0]?.status, 'completed');
    assert.equal((await store.state()).tasks[0]?.output, 'Fixture reply: OK');
  } finally {
    rpc.close();
    if (previousHome === undefined) delete process.env.CODEX_GOVERNOR_HOME; else process.env.CODEX_GOVERNOR_HOME = previousHome;
    if (previousCodex === undefined) delete process.env.CODEX_GOVERNOR_CODEX; else process.env.CODEX_GOVERNOR_CODEX = previousCodex;
    // Allow child shutdown to finish its last atomic state write before removing the fixture directory.
    await new Promise(resolve => setTimeout(resolve, 300));
    await rm(directory, {recursive: true, force: true});
  }
});
