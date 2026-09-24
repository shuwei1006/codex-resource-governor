import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, writeFile, chmod, access, realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join, resolve, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {type Task} from './domain.js';
import {Store} from './storage.js';

export const nativeTargetSchema = z.enum(['app', 'vscode', 'both']);
export type NativeTarget = z.infer<typeof nativeTargetSchema>;
const exec = promisify(execFile);

export function findTask(tasks: Task[], id: string): Task {
  const exact = tasks.find(task => task.id === id || task.threadId === id);
  if (exact) return exact;
  const matches = tasks.filter(task => task.id.startsWith(id));
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous task ID: ${id}` : `Managed task not found: ${id}`);
  return matches[0]!;
}

export function nativeLinks(task: Task, target: NativeTarget): string[] {
  // A UUID is required by Codex's native routes; never pass arbitrary stored text to an OS opener.
  const thread = z.string().uuid().parse(task.threadId);
  return target === 'both' ? [`codex://threads/${thread}`, `vscode://openai.chatgpt/local/${thread}`]
    : [target === 'app' ? `codex://threads/${thread}` : `vscode://openai.chatgpt/local/${thread}`];
}

export async function openNative(task: Task, target: NativeTarget, launch = launchUri): Promise<void> {
  if (!task.hasSubmitted) throw new Error('This thread has no submitted turn yet. Run a prompt before opening it in Codex.');
  if (['starting', 'running', 'unknown'].includes(task.status)) throw new Error('Wait for the Governor turn to finish before handing the thread to a native client.');
  const failures: string[] = [];
  for (const uri of nativeLinks(task, target)) {
    try {await launch(uri);} catch {failures.push(uri);}
  }
  if (failures.length) throw new Error(`Could not open ${failures.join(', ')}. Install the corresponding app or use open <id> --print to copy the links.`);
}

async function launchUri(uri: string): Promise<void> {
  if (process.platform === 'darwin') await exec('/usr/bin/open', [uri], {timeout: 15_000});
  else if (process.platform === 'win32') await exec('rundll32.exe', ['url.dll,FileProtocolHandler', uri], {timeout: 15_000});
  else await exec('xdg-open', [uri], {timeout: 15_000});
}

const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

export async function createIdeLauncher(store: Store, binary: string): Promise<string> {
  if (process.platform === 'win32') throw new Error('The IDE launcher currently requires macOS/Linux (or the extension running in WSL).');
  const directory = resolve(store.directory);
  const entry = fileURLToPath(new URL('./codex-proxy.js', import.meta.url));
  if (entry.endsWith('/src/codex-proxy.js')) throw new Error('Build first, then use node dist/cli.js integration vscode.');
  const launcher = join(directory, 'codex-governor-ide');
  const candidates = binary.includes('/') ? [resolve(binary)] : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(path => join(path, binary));
  let executable: string | undefined;
  for (const path of candidates) {try {await access(path, constants.X_OK); executable = await realpath(path); break;} catch { /* Try the next PATH entry. */ }}
  if (!executable) throw new Error(`Codex executable not found: ${binary}. Pass --codex /absolute/path/to/codex.`);
  if (executable === launcher || executable === entry) throw new Error('Choose the real Codex binary, not the Governor proxy.');
  await mkdir(directory, {recursive: true, mode: 0o700});
  // Absolute node/entry paths keep IDE launches independent of the shell's node PATH.
  const codexHome = process.env.CODEX_HOME ? `export CODEX_HOME=${shellQuote(process.env.CODEX_HOME)}\n` : '';
  const script = `#!/bin/sh\nexport CODEX_GOVERNOR_HOME=${shellQuote(directory)}\nexport CODEX_GOVERNOR_CODEX=${shellQuote(executable)}\n${codexHome}exec ${shellQuote(process.execPath)} ${shellQuote(entry)} "$@"\n`;
  await writeFile(launcher, script, {mode: 0o700});
  await chmod(launcher, 0o700);
  return launcher;
}
