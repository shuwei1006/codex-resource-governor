#!/usr/bin/env node
import {policyLabel, priorityLabel} from './labels.js';
import React from 'react';
import {Command, Option} from 'commander';
import {render} from 'ink';
import {join} from 'node:path';
import {AppServer, resolveCodexBinary} from './rpc.js';
import {Store} from './storage.js';
import {Governor} from './governor.js';
import {App, ConfigWizard, safeText} from './ui.js';
import {taskNameFromPrompt} from './task-name.js';
import {changeControl} from './control.js';
import {createIdeLauncher, findTask, nativeLinks, nativeTargetSchema, openNative, type NativeTarget} from './native.js';
import {doctor, listModels, probeSchema, requireChatGPT} from './capabilities.js';
import {type Config, type Language, type Model, configSchema, errorMessage, languageSchema, modeSchema, policySchema, prioritySchema, validateConfig} from './domain.js';

const store = new Store();
const configPath = join(store.directory, 'config.json');
const languageOption = () => new Option('--lang <language>', 'Language / 语言').choices(['en', 'zh-CN']);
function requireTTY(): void {if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('An interactive terminal is required. Use config flags, or run "your task description" with piped output.');}
async function wizard(models: Model[], language?: Language): Promise<void> {
  requireTTY();
  const config = await store.config();
  let saved = false;
  const instance = render(<ConfigWizard models={models} initial={config ?? undefined} language={language ?? languageSchema.catch('en').parse(process.env.CODEX_GOVERNOR_LANG)} onCancel={() => instance.unmount()} onSave={async value => {await store.saveConfig(value); saved = true; instance.unmount();}} />);
  await instance.waitUntilExit();
  if (!saved && !config) throw new Error('Configuration cancelled.');
  if (saved) {
    const written = await store.config();
    if (!written) throw new Error(`Configuration was not found after saving: ${configPath}`);
    process.stdout.write(written.language === 'zh-CN' ? `配置已保存：${configPath}\n` : `Configuration saved: ${configPath}\n`);
  }
}
async function withServer<T>(work: (rpc: AppServer) => Promise<T>): Promise<T> {
  const rpc = new AppServer();
  try {await rpc.start(); return await work(rpc);} finally {rpc.close();}
}
async function withGovernor(work: (governor: Governor) => Promise<void>): Promise<void> {
  await withServer(async rpc => {
    await probeSchema(rpc.binary);
    if (!await store.config()) {await requireChatGPT(rpc); await wizard(await listModels(rpc));}
    const governor = new Governor(rpc, store);
    const signal = () => {void governor.dispose().finally(() => {rpc.close(); process.exit(130);});};
    process.once('SIGINT', signal); process.once('SIGTERM', signal);
    try {await governor.initialize(); await work(governor);} finally {process.off('SIGINT', signal); process.off('SIGTERM', signal); await governor.dispose();}
  });
}
async function tui(governor: Governor, initialTask?: string): Promise<void> {
  requireTTY();
  const instance = render(<App governor={governor} initialTask={initialTask} />);
  await instance.waitUntilExit();
}
async function headlessTurn(governor: Governor, id: string, prompt: string): Promise<void> {
  // Non-interactive mode never silently approves an App Server request.
  const rejectRequests = () => {for (const request of [...governor.requests]) {governor.answerRequest(request, false); process.stderr.write(`Interactive request declined: ${request.method}. Use the TUI to approve.\n`);}};
  governor.on('change', rejectRequests);
  try {
    await governor.startTurn(id, prompt);
    await new Promise<void>((resolve, reject) => {
      const changed = () => {
        const task = governor.tasks.find(candidate => candidate.id === id);
        if (!task) {governor.off('change', changed); reject(new Error('Task record was deleted.')); return;}
        if (['starting', 'running'].includes(task.status) && !governor.connectionError) return;
        governor.off('change', changed);
        process.stdout.write(`${governor.taskOutput(task)}\n`);
        if (task.status === 'completed') resolve(); else reject(new Error(task.error ?? task.status));
      };
      governor.on('change', changed); changed();
    });
  } finally {governor.off('change', rejectRequests);}
}
const program = new Command().name('codex-governor').description('Quota-aware model and reasoning governance for Codex tasks').version('0.2.1');
program.action(async () => {requireTTY(); await withGovernor(governor => tui(governor));});
program.command('doctor').description('Check Codex environment and runtime capabilities').option('--live-turn', 'Also run one real read-only turn (uses account quota)').action(async options => {
  const results = await doctor(undefined, Boolean(options.liveTurn), check => process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}\n`));
  if (results.some(r => !r.ok)) process.exitCode = 1;
});
program.command('config').description('Configure Primary / Economy model profiles, Quota Policy, and language')
  .addOption(languageOption()).option('--primary-model <model>', 'Primary profile model').option('--primary-effort <effort>', 'Primary profile Reasoning Effort')
  .option('--economy-model <model>', 'Economy profile model').option('--economy-effort <effort>', 'Economy profile Reasoning Effort')
  .addOption(new Option('--policy <policy>', 'Quota Policy: quality-first = Quality First, balanced = Balanced, save-quota = Save Quota').choices(['quality-first', 'balanced', 'save-quota']))
  .addOption(new Option('--open-in <target>', 'Automatically open completed run tasks in a native Codex client').choices(['none', 'app', 'vscode', 'both']))
  .option('--show', 'Print the saved configuration without connecting to Codex')
  .option('--path', 'Print the configuration file path without connecting to Codex')
  .action(async options => {
    const changes = [options.lang, options.primaryModel, options.primaryEffort, options.economyModel, options.economyEffort, options.policy, options.openIn].some(Boolean);
    if ((options.show || options.path) && changes) throw new Error('Use --show or --path separately from configuration changes.');
    if (options.show && options.path) throw new Error('Choose either --show or --path.');
    if (options.path) {process.stdout.write(`${configPath}\n`); return;}
    if (options.show) {
      const config = await store.config();
      if (!config) throw new Error(`No saved configuration at ${configPath}. Run codex-governor config.`);
      process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
      return;
    }
    await withServer(async rpc => {
      await requireChatGPT(rpc); const models = await listModels(rpc);
      const previous = await store.config();
      if (!options.primaryModel && !options.primaryEffort && !options.economyModel && !options.economyEffort && !options.policy && !options.openIn && !(options.lang && previous)) {await wizard(models, options.lang); return;}
      const config = configSchema.parse({version: 2, language: options.lang ?? previous?.language ?? languageSchema.catch('en').parse(process.env.CODEX_GOVERNOR_LANG), primary: {model: options.primaryModel ?? previous?.primary.model, effort: options.primaryEffort ?? previous?.primary.effort}, economy: {model: options.economyModel ?? previous?.economy.model, effort: options.economyEffort ?? previous?.economy.effort}, policy: options.policy ?? previous?.policy ?? 'balanced', openIn: options.openIn ?? previous?.openIn});
      validateConfig(config, models); await store.saveConfig(config);
      if (!await store.config()) throw new Error(`Configuration was not found after saving: ${configPath}`);
      process.stdout.write(config.language === 'zh-CN' ? `配置已保存：${configPath}\n` : `Configuration saved: ${configPath}\n`);
    });
  });
program.command('run [prompt]').allowExcessArguments(false).description('Describe a task to automatically name, create, and execute it')
  .option('--name <name>', 'Override the automatically generated task name').addOption(new Option('--priority <priority>', 'Task Priority: high = High, medium = Medium, low = Low').choices(['high', 'medium', 'low']).default('medium'))
  .option('--cwd <directory>', 'Task working directory', process.cwd()).option('--prompt <text>', 'Alternative to the positional prompt (legacy syntax)')
  .addOption(new Option('--open <target>', 'Open the native client after successful completion').choices(['none', 'app', 'vscode', 'both']))
  .addHelpText('after', '\nExample:\n  codex-governor run --priority high "写一份关于codex的PPT"')
  .action(async (positionalPrompt: string | undefined, options) => {
    if (positionalPrompt !== undefined && options.prompt !== undefined) throw new Error('Provide either a positional prompt or --prompt, not both.');
    const prompt: string | undefined = positionalPrompt ?? options.prompt;
    const generatedName = prompt !== undefined ? taskNameFromPrompt(prompt) : undefined;
    const name: string | undefined = options.name === undefined ? generatedName : options.name.trim();
    if (!name || name.length > 120) throw new Error('Provide a task prompt: codex-governor run "your task description". An optional --name must contain 1–120 characters.');
    if (prompt === undefined) requireTTY();
    await withGovernor(async governor => {
      const task = await governor.createTask(name, prioritySchema.parse(options.priority), options.cwd);
      process.stderr.write(`Task ${task.id}: ${safeText(task.name)}\n`);
      process.stderr.write(`Codex thread: ${task.threadId}\n`);
      const target = options.open ?? governor.config.openIn ?? 'none';
      const openCompleted = async () => {
        if (target === 'none') return;
        try {await openNative(governor.task(task.id), target as NativeTarget);}
        catch (error) {governor.emit('notice', errorMessage(error)); process.stderr.write(`Task retained. ${errorMessage(error)}\n`);}
      };
      if (prompt !== undefined && (!process.stdin.isTTY || !process.stdout.isTTY)) {await headlessTurn(governor, task.id, prompt); await openCompleted();}
      else {
        // Mount the TUI before dispatching a prompt so approval requests are visible.
        const instance = render(<App governor={governor} initialTask={task.id} />);
        const completed = () => {
          if (governor.tasks.find(candidate => candidate.id === task.id)?.status !== 'completed') return;
          governor.off('change', completed); void openCompleted();
        };
        if (target !== 'none') governor.on('change', completed);
        if (prompt !== undefined) void governor.startTurn(task.id, prompt).catch(error => governor.emit('notice', errorMessage(error)));
        try {await instance.waitUntilExit();} finally {governor.off('change', completed);}
      }
    });
  });
program.command('list').description('List Governor task IDs and their Codex thread IDs').option('--json', 'Print structured task summaries').action(async options => {
  const tasks = (await store.state()).tasks.map(({id, threadId, name, status, cwd, mode, manualSelection, current, currentMode}) => ({id, threadId, name, status, cwd, mode, manualSelection, current, currentMode}));
  if (options.json) process.stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
  else for (const task of tasks) process.stdout.write(`Governor: ${task.id}  ${task.status}  ${task.mode}  ${safeText(task.name)}\n  Codex: ${task.threadId}\n`);
});
program.command('open <id>').description('Open a completed task in Codex App and/or VS Code')
  .addOption(new Option('--target <target>').choices(['app', 'vscode', 'both']).default('both'))
  .option('--print', 'Print deep links without launching an application')
  .action(async (id: string, options) => {
    const task = findTask((await store.state()).tasks, id);
    const target = nativeTargetSchema.parse(options.target);
    if (options.print) {for (const uri of nativeLinks(task, target)) process.stdout.write(`${uri}\n`); return;}
    await openNative(task, target);
    process.stdout.write('Open request sent. Native IDE turns are governed only when the IDE proxy is configured; App turns use App settings.\n');
  });
program.command('integration <target>').description('Generate a native IDE proxy launcher and print its VS Code user setting')
  .option('--codex <path>', 'Real Codex executable (auto-detected by default)', resolveCodexBinary())
  .action(async (target: string, options) => {
    if (target !== 'vscode') throw new Error('Only integration vscode supports per-turn governance. App supports deep-link handoff only.');
    const launcher = await createIdeLauncher(store, options.codex);
    process.stdout.write(`${JSON.stringify({'chatgpt.cliExecutable': launcher}, null, 2)}\n`);
    process.stderr.write('Experimental IDE integration: merge this setting into VS Code User settings, then Reload Window. Remove chatgpt.cliExecutable to undo. Desktop App input is not intercepted.\n');
  });
program.command('priority <id> <priority>').description('Set Task Priority: high = High, medium = Medium, low = Low').action(async (id: string, value: string) => {
  const priority = prioritySchema.parse(value);
  await withGovernor(async governor => {await governor.setPriority(id, priority); process.stdout.write(`${governor.task(id).id}: ${governor.config.language === 'zh-CN' ? '任务优先级' : 'Task Priority'}: ${priorityLabel(priority, governor.config.language)}\n`);});
});
program.command('mode <id> <mode>').description('Set auto | manual | off (keep uses the Primary profile)')
  .option('--model <model>', 'Required explicit model for manual mode')
  .option('--effort <effort>', 'Required explicit reasoning effort for manual mode')
  .action(async (id: string, value: string, options) => {
  const mode = modeSchema.parse(value);
  if (mode === 'manual' && (!options.model || !options.effort)) throw new Error('Manual mode requires both --model and --effort.');
  if (mode !== 'manual' && (options.model !== undefined || options.effort !== undefined)) throw new Error('--model and --effort are only valid in manual mode.');
  if (mode !== 'manual') {
    const task = findTask((await store.state()).tasks, id);
    await store.update(state => {changeControl(findTask(state.tasks, task.id), mode);});
    process.stdout.write(`${task.id}: ${mode} (applies to turns reserved after this change)\n`);
    return;
  }
  await withGovernor(async governor => {await governor.setMode(id, mode, {model: options.model, effort: options.effort}); process.stdout.write(`${governor.task(id).id}: manual ${options.model} / ${options.effort} (until explicitly changed)\n`);});
});
program.command('interrupt <id>').description('Interrupt an active task by ID, including one running in another terminal').action(async (id: string) => {
  await withGovernor(async governor => {
    const task = governor.task(id);
    await governor.interrupt(task.id);
    const latest = governor.task(task.id);
    process.stdout.write(`${latest.status === 'interrupted' ? 'Interrupted' : 'Interrupt requested from the owning terminal'} ${task.id}: ${safeText(task.name)}\n`);
  });
});
program.command('delete <id>').description('Delete a local task record; an active turn is interrupted first').action(async (id: string) => {
  await withGovernor(async governor => {
    const task = await governor.deleteTask(id);
    process.stdout.write(`Deleted ${task.id}: ${safeText(task.name)}\n`);
  });
});
program.command('policy <policy>').description('Set Quota Policy: quality-first = Quality First, balanced = Balanced, save-quota = Save Quota').action(async (value: string) => {
  const policy = policySchema.parse(value);
  await withGovernor(async governor => {await governor.setConfig({...governor.config, policy} as Config); process.stdout.write(`${governor.config.language === 'zh-CN' ? '额度策略' : 'Quota Policy'}: ${policyLabel(policy, governor.config.language)}\n`);});
});
program.command('explain <id>').description('Explain the next-turn decision').action(async (id: string) => {
  await withGovernor(async governor => {process.stdout.write(`${governor.explain(id)}\n`);});
});
try {await program.parseAsync();} catch (error) {process.stderr.write(`Error: ${errorMessage(error)}\n`); process.exitCode = 1;}
