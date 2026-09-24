import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chmod, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AppServer, resolveCodexBinary} from '../src/rpc.js';
import {listModels, doctor} from '../src/capabilities.js';
const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
function client(timeout = 1000) {return new AppServer(process.execPath, timeout, [fixture]);}
test('Codex binary resolution honors overrides and discovers the newest VS Code extension', async () => {
  const home = await mkdtemp(join(tmpdir(), 'crg-codex-discovery-'));
  try {
    const older = join(home, '.vscode', 'extensions', 'openai.chatgpt-26.1-darwin-arm64', 'bin', 'macos-aarch64', 'codex');
    const newer = join(home, '.vscode', 'extensions', 'openai.chatgpt-26.2-darwin-arm64', 'bin', 'macos-aarch64', 'codex');
    for (const path of [older, newer]) {await mkdir(join(path, '..'), {recursive: true}); await writeFile(path, ''); await chmod(path, 0o700);}
    assert.equal(resolveCodexBinary({env: {PATH: ''}, home, platform: 'darwin', arch: 'arm64'}), newer);
    assert.equal(resolveCodexBinary({env: {CODEX_GOVERNOR_CODEX: '/chosen/codex', PATH: ''}, home, platform: 'darwin', arch: 'arm64'}), '/chosen/codex');
  } finally {await rm(home, {recursive: true, force: true});}
});
test('stdio handshake, paginated live model catalog, Unicode frame splitting and RPC errors', async () => {
  const rpc = client();
  try {
    await assert.rejects(rpc.request('model/list'), /initialized/);
    await rpc.start();
    assert.equal((await listModels(rpc)).length, 2);
    assert.deepEqual(await rpc.request('test/split'), {text: '中文'});
    await assert.rejects(rpc.request('missing/method'), /Unknown method/);
  } finally {rpc.close();}
});
for (const method of ['test/hang', 'test/malformed', 'test/exit']) test(`transport rejects pending calls on ${method}`, async () => {
  // Keep the failure timeout short, but leave enough room for process startup when
  // all test files are competing for CPU in the full parallel suite.
  const rpc = client(1000); try {await rpc.start(); await assert.rejects(rpc.request(method));} finally {rpc.close();}
});
test('server request ids do not interfere with client RPC responses', async () => {
  const rpc = client(); let called = false;
  rpc.on('serverRequest', request => {called = true; rpc.reply(request.id, {decision: 'decline'});});
  try {await rpc.start(); await rpc.request('test/request'); assert.equal(called, true);} finally {rpc.close();}
});
test('doctor performs capability checks without account credentials (fixture)', async () => {
  const checks = await doctor(fixture, true);
  assert.ok(checks.length >= 8); assert.deepEqual(checks.filter(c => !c.ok), []);
});
