#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
if (process.argv.includes('--version')) {console.log('codex-cli fixture'); process.exit(0);}
if (process.argv.includes('generate-json-schema')) {
  const directory = process.argv[process.argv.indexOf('--out') + 1]; await mkdir(join(directory, 'v2'), {recursive: true});
  for (const [name, fields] of Object.entries({TurnStartParams: ['threadId', 'input', 'model', 'effort'], ThreadStartParams: ['model', 'ephemeral', 'sandbox', 'approvalPolicy']})) await writeFile(join(directory, 'v2', `${name}.json`), JSON.stringify({properties: Object.fromEntries(fields.map(f => [f, {}]))}));
  process.exit(0);
}
const models = ['model-a', 'model-b'].map((model, i) => ({id: model, model, displayName: model, hidden: false, isDefault: i === 0, defaultReasoningEffort: 'high', supportedReasoningEfforts: ['low', 'medium', 'high'].map(reasoningEffort => ({reasoningEffort}))}));
let ready = false; let initialized = false;
let initializeParams; let turnParams; let approvalRequestId;
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const notification = (method, params) => send({method, params});
createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line); const {id, method, params = {}} = message;
  if (method === 'initialized') {ready = true; return;}
  if (!method) {if (id === 777 && approvalRequestId !== undefined) {send({id: approvalRequestId, result: message.result}); approvalRequestId = undefined;} return;}
  const result = value => send({id, result: value});
  const error = (code, message) => send({id, error: {code, message}});
  if (method === 'initialize') {if (initialized) error(-32600, 'Already initialized'); else {initialized = true; initializeParams = params; result({userAgent: 'fixture'});} return;}
  if (!ready) {error(-32600, 'Not initialized'); return;}
  if (method === 'account/read') {result({account: {type: 'chatgpt'}, requiresOpenaiAuth: true}); return;}
  if (method === 'model/list') {result({data: params.cursor ? [models[1]] : [models[0]], nextCursor: params.cursor ? null : 'page2'}); return;}
  if (method === 'account/rateLimits/read') {result({rateLimits: {primary: {usedPercent: 85, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 9999}}}); return;}
  if (method === 'thread/start') {result({thread: {id: randomUUID()}}); return;}
  if (method === 'thread/name/set') {result({}); return;}
  if (method === 'thread/resume') {result({thread: {id: params.threadId, turns: []}}); return;}
  if (method === 'turn/start') {
    turnParams = params;
    if (process.env.CRG_FIXTURE_EXPECT_PROMPT !== undefined && params.input?.[0]?.text !== process.env.CRG_FIXTURE_EXPECT_PROMPT) {error(-32602, 'Original prompt was not forwarded intact'); return;}
    if (params.threadId.startsWith('00000000')) {error(-32000, 'thread not found'); return;}
    if (!models.some(m => m.model === params.model && m.supportedReasoningEfforts.some(e => e.reasoningEffort === params.effort))) {error(-32602, 'Invalid override'); return;}
    const turn = {id: 'fixture-turn', status: 'inProgress'};
    // Events deliberately precede the acknowledgement to exercise notification races.
    notification('item/agentMessage/delta', {threadId: params.threadId, turnId: turn.id, delta: 'Fixture reply: OK'});
    notification('turn/completed', {threadId: params.threadId, turn: {...turn, status: 'completed'}});
    result({turn}); return;
  }
  if (method === 'turn/interrupt') {result({}); return;}
  if (method === 'test/hang') return;
  if (method === 'test/initialize-params') {result(initializeParams); return;}
  if (method === 'test/turn-params') {result(turnParams); return;}
  if (method === 'test/error-data') {send({id, error: {code: -32002, message: 'fixture error', data: {reason: 'fixture'}}}); return;}
  if (method === 'test/request-roundtrip') {approvalRequestId = id; send({id: 777, method: 'item/commandExecution/requestApproval', params: {command: 'echo fixture'}}); return;}
  if (method === 'test/malformed') {process.stdout.write('not JSON\n'); return;}
  if (method === 'test/exit') process.exit(2);
  if (method === 'test/request') {send({id: 777, method: 'item/commandExecution/requestApproval', params: {command: 'echo fixture'}}); result({}); return;}
  if (method === 'test/split') {const frame = JSON.stringify({id, result: {text: '中文'}}); const b = Buffer.from(frame + '\n'); const split = b.indexOf(Buffer.from('中')) + 1; process.stdout.write(b.subarray(0, split)); setTimeout(() => process.stdout.write(b.subarray(split)), 10); return;}
  error(-32601, `Unknown method: ${method}`);
});
