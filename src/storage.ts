import {mkdir, open, readFile, rename, rm, stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {configSchema, stateSchema, type Config, type State} from './domain.js';

export function storageDirectory(): string {return process.env.CODEX_GOVERNOR_HOME || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'codex-resource-governor');}
export function isAlive(pid: number): boolean {try {process.kill(pid, 0); return true;} catch (e) {return (e as NodeJS.ErrnoException).code === 'EPERM';}}
async function isStaleLock(path: string): Promise<boolean> {
  try {
    const pid = Number(await readFile(join(path, 'pid'), 'utf8'));
    return Number.isInteger(pid) && pid > 0 && !isAlive(pid);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const info = await stat(path).catch(() => null);
    return !!info && Date.now() - info.mtimeMs > 30_000;
  }
}
export async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync();} finally {await handle.close();}
    await rename(temp, path);
    const dir = await open(dirname(path), 'r');
    try {await dir.sync();} finally {await dir.close();}
  } finally {await rm(temp, {force: true});}
}
async function readValidated<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallback: T): Promise<T> {
  try {return schema.parse(JSON.parse(await readFile(path, 'utf8')));} catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${path}; repair or restore this file. It was not overwritten.`, {cause: error});
  }
}
export class Store {
  constructor(readonly directory = storageDirectory()) {}
  async config(): Promise<Config | null> {return readValidated(join(this.directory, 'config.json'), configSchema.nullable(), null);}
  async state(): Promise<State> {return readValidated(join(this.directory, 'state.json'), stateSchema, {version: 1, tasks: []});}
  async saveConfig(config: Config): Promise<void> {await this.lock(async () => atomicWrite(join(this.directory, 'config.json'), configSchema.parse(config)));}
  async update(change: (state: State) => void): Promise<State> {
    return this.lock(async () => {const state = await this.state(); change(state); await atomicWrite(join(this.directory, 'state.json'), stateSchema.parse(state)); return state;});
  }
  private async lock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    const path = join(this.directory, '.write-lock');
    const deadline = Date.now() + 5000;
    while (true) {
      try {await mkdir(path, {mode: 0o700}); break;} catch (e) {if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;}
      if (await isStaleLock(path)) {
        // Serialize stale-lock reclamation, then recheck ownership. Otherwise two
        // waiters could both delete a lock after one has already been replaced.
        const recovery = `${path}.recovery`;
        let acquired = false;
        try {
          await mkdir(recovery, {mode: 0o700}); acquired = true;
          if (await isStaleLock(path)) await rm(path, {recursive: true, force: true});
        } catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
        finally {if (acquired) await rm(recovery, {recursive: true, force: true});}
      }
      if (Date.now() >= deadline) throw new Error('Governor storage is busy. Try again shortly.');
      await new Promise(r => setTimeout(r, 25));
    }
    try {const file = await open(join(path, 'pid'), 'w', 0o600); try {await file.writeFile(String(process.pid));} finally {await file.close();} return await action();}
    finally {await rm(path, {recursive: true, force: true});}
  }
}
