import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/storage.js';
import {config} from './helpers.js';
const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.tsx', import.meta.url));

test('public CLI config → run → priority → mode → policy → explain works with isolated state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crg-cli-'));
  const env = {...process.env, CODEX_GOVERNOR_HOME: directory, CODEX_GOVERNOR_CODEX: fixture};
  const run = (...args: string[]) => exec(process.execPath, ['--import', 'tsx', cli, ...args], {env, timeout: 15_000});
  try {
    const help = await run('--help');
    for (const name of ['doctor', 'config', 'run', 'list', 'open', 'integration', 'priority', 'mode', 'interrupt', 'delete', 'policy', 'explain']) assert.ok(help.stdout.includes(name));
    await run('config', '--normal-model', 'model-a', '--normal-effort', 'high', '--economy-model', 'model-b', '--economy-effort', 'medium', '--lang', 'zh-CN');
    assert.equal((await new Store(directory).config())?.language, 'zh-CN');
    const path = await exec(process.execPath, ['--import', 'tsx', cli, 'config', '--path'], {env: {...env, CODEX_GOVERNOR_CODEX: '/nonexistent/codex'}, timeout: 5000});
    assert.equal(path.stdout.trim(), join(directory, 'config.json'));
    const shown = await exec(process.execPath, ['--import', 'tsx', cli, 'config', '--show'], {env: {...env, CODEX_GOVERNOR_CODEX: '/nonexistent/codex'}, timeout: 5000});
    assert.equal(JSON.parse(shown.stdout).language, 'zh-CN');
    const result = await run('run', '--name', '测试任务', '--priority', 'normal', '--prompt', 'Hello');
    assert.match(result.stdout, /Fixture reply: OK/);
    const task = (await new Store(directory).state()).tasks[0]!;
    assert.equal(task.status, 'completed'); assert.deepEqual(task.current, {model: 'model-a', effort: 'medium'});
    const listing = JSON.parse((await run('list', '--json')).stdout);
    assert.equal(listing[0].threadId, task.threadId);
    const links = await run('open', task.id.slice(0, 8), '--target', 'both', '--print');
    assert.equal(links.stdout, `codex://threads/${task.threadId}\nvscode://openai.chatgpt/local/${task.threadId}\n`);
    await run('config', '--open-in', 'both');
    assert.equal((await new Store(directory).config())?.openIn, 'both');
    await run('config', '--open-in', 'none');
    await run('priority', task.id.slice(0, 8), 'high');
    await run('mode', task.id, 'keep');
    await assert.rejects(run('mode', task.id, 'manual', '--model', 'model-a'));
    await run('mode', task.id, 'manual', '--model', 'model-b', '--effort', 'low');
    assert.deepEqual((await new Store(directory).state()).tasks[0]?.manualSelection, {model: 'model-b', effort: 'low'});
    const offline = {...env, CODEX_GOVERNOR_CODEX: '/nonexistent/codex'};
    await exec(process.execPath, ['--import', 'tsx', cli, 'mode', task.id, 'off'], {env: offline, timeout: 5000});
    assert.equal((await new Store(directory).state()).tasks[0]?.mode, 'off');
    await run('mode', task.id, 'auto');
    await run('policy', 'saver');
    const explanation = await run('explain', task.id);
    assert.match(explanation.stdout, /High 优先级始终保持 Normal/);
    assert.equal((await new Store(directory).config())?.policy, 'saver');
    await new Store(directory).update(state => {
      const saved = state.tasks.find(candidate => candidate.id === task.id)!;
      saved.status = 'running'; saved.turnId = 'fixture-running-turn'; saved.ownerPid = 999_999;
    });
    const interrupted = await run('interrupt', task.id.slice(0, 8));
    assert.match(interrupted.stdout, new RegExp(`Interrupted ${task.id}`));
    assert.equal((await new Store(directory).state()).tasks[0]?.status, 'interrupted');
    const deleted = await run('delete', task.id.slice(0, 8));
    assert.match(deleted.stdout, new RegExp(`Deleted ${task.id}`));
    assert.equal((await new Store(directory).state()).tasks.length, 0);
    await assert.rejects(run('priority', task.id, 'urgent'));
    await assert.rejects(run('config', '--normal-model', 'invented-model'));
    assert.equal((await new Store(directory).config())?.normal.model, 'model-a');
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('positional run names and executes the complete prompt with policy-selected overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crg-prompt-'));
  const store = new Store(directory);
  const env = {...process.env, CODEX_GOVERNOR_HOME: directory, CODEX_GOVERNOR_CODEX: fixture};
  try {
    await store.saveConfig(config);
    const cases = [
      {prompt: '做一个关于中秋节的祝福卡片', args: ['--priority', 'high'], name: '中秋节祝福卡片', effort: 'high'},
      {prompt: '请帮我做一个关于中秋节的祝福卡片。\n使用暖色，不要省略祝福语。', args: [], name: '中秋节祝福卡片', effort: 'medium'},
      {prompt: 'Summarize this project', args: ['--name', '自定义任务', '--priority', 'low'], name: '自定义任务', effort: 'medium'},
    ];
    for (const [index, example] of cases.entries()) {
      const result = await exec(process.execPath, ['--import', 'tsx', cli, 'run', ...example.args, example.prompt], {env: {...env, CRG_FIXTURE_EXPECT_PROMPT: example.prompt}, timeout: 15_000});
      assert.match(result.stdout, /Fixture reply: OK/);
      assert.ok(result.stderr.includes(example.name));
      const state = await store.state();
      assert.equal(state.tasks.length, index + 1);
      assert.equal(state.tasks[index]?.name, example.name);
      assert.equal(state.tasks[index]?.status, 'completed');
      assert.equal(state.tasks[index]?.hasSubmitted, true);
      assert.deepEqual(state.tasks[index]?.current, {model: 'model-a', effort: example.effort});
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('invalid run inputs fail before connecting to Codex or creating a task', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crg-invalid-prompt-'));
  try {
    for (const args of [[], [' '], ['--name', 'Title', '--prompt', ' '], ['one', '--prompt', 'two'], ['prompt', '--name', ' '], ['prompt', '--name', 'a'.repeat(121)], ['one', 'two']]) {
      await assert.rejects(exec(process.execPath, ['--import', 'tsx', cli, 'run', ...args], {env: {...process.env, CODEX_GOVERNOR_HOME: directory, CODEX_GOVERNOR_CODEX: '/nonexistent/codex'}, timeout: 5000}), (error: unknown) => {
        const failure = error as {stderr: string};
        assert.doesNotMatch(failure.stderr, /Cannot start Codex/);
        return true;
      });
      assert.deepEqual((await new Store(directory).state()).tasks, []);
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});
