import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {accessSync, constants, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter, join} from 'node:path';
import {z} from 'zod';
import {errorMessage} from './domain.js';

export class RpcError extends Error {constructor(readonly code: number, message: string, readonly data?: unknown) {super(message); this.name = 'RpcError';}}
export type ServerRequest = {id: number | string; method: string; params: unknown};
export interface Rpc extends Pick<EventEmitter, 'on' | 'off'> {
  request(method: string, params?: unknown): Promise<unknown>;
  reply(id: number | string, result: unknown): void;
  reject(id: number | string, message: string): void;
}
const envelopeSchema = z.object({id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional(), error: z.object({code: z.number(), message: z.string(), data: z.unknown().optional()}).optional()});
function executable(path: string): boolean {try {accessSync(path, constants.X_OK); return true;} catch {return false;}}
export function resolveCodexBinary(options: {env?: NodeJS.ProcessEnv; home?: string; platform?: NodeJS.Platform; arch?: string} = {}): string {
  const env = options.env ?? process.env;
  if (env.CODEX_GOVERNOR_CODEX) return env.CODEX_GOVERNOR_CODEX;
  const platform = options.platform ?? process.platform;
  const command = platform === 'win32' ? 'codex.exe' : 'codex';
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, command);
    if (executable(candidate)) return candidate;
  }
  if (platform === 'darwin') {
    const home = options.home ?? homedir();
    const architecture = (options.arch ?? process.arch) === 'arm64' ? 'macos-aarch64' : 'macos-x86_64';
    for (const root of [join(home, '.vscode', 'extensions'), join(home, '.vscode-insiders', 'extensions')]) {
      let extensions: string[] = [];
      try {extensions = readdirSync(root).filter(name => name.startsWith('openai.chatgpt-')).sort().reverse();} catch {/* Extension directory is optional. */}
      for (const extension of extensions) {
        const candidate = join(root, extension, 'bin', architecture, 'codex');
        if (executable(candidate)) return candidate;
      }
    }
    const appCandidate = '/Applications/ChatGPT.app/Contents/Resources/codex';
    if (executable(appCandidate)) return appCandidate;
  }
  return command;
}
export class AppServer extends EventEmitter implements Rpc {
  private process?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private ready = false;
  private closed = false;
  private buffer = '';
  private stderrTail = '';
  private pending = new Map<number, {resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout}>();
  constructor(readonly binary = resolveCodexBinary(), readonly timeoutMs = 20_000, private readonly launchArgs?: string[]) {super();}
  async start(initializeParams: unknown = {clientInfo: {name: 'codex_resource_governor', title: 'Codex Resource Governor', version: '0.2.0'}}): Promise<unknown> {
    if (this.process) throw new Error('App Server already started.');
    const child = spawn(this.binary, this.launchArgs ?? ['app-server', '-c', 'analytics.enabled=false', '-c', 'otel.exporter="none"', '-c', 'otel.trace_exporter="none"'], {stdio: ['pipe', 'pipe', 'pipe'], shell: false});
    this.process = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => this.receive(data));
    child.stderr.on('data', (data: Buffer) => {this.stderrTail = (this.stderrTail + data.toString()).slice(-4096);});
    child.stdin.on('error', (error) => this.fail(error));
    child.on('error', (error) => this.fail(new Error(`Cannot start Codex: ${error.message}`)));
    child.on('exit', (code, signal) => this.fail(new Error(`Codex App Server exited (${code ?? signal}). ${this.stderrTail.trim()}`)));
    try {
      const result = await this.sendRequest('initialize', initializeParams);
      this.write({method: 'initialized'});
      this.ready = true;
      return result;
    } catch (error) {this.close(); throw error;}
  }
  async request(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.ready) throw new Error('App Server is not initialized.');
    return this.sendRequest(method, params);
  }
  private sendRequest(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('App Server connection closed.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out; the outcome may be unknown. Reconnect before retrying.`));
        this.close(); // A timed-out mutation must never be blindly retried on the same connection.
      }, this.timeoutMs);
      this.pending.set(id, {resolve, reject, timer});
      try {this.write({id, method, params});} catch (error) {clearTimeout(timer); this.pending.delete(id); reject(error);}
    });
  }
  reply(id: number | string, result: unknown): void {this.write({id, result});}
  replyError(id: number | string, error: unknown): void {this.write({id, error});}
  notify(method: string, params?: unknown): void {this.write({method, params});}
  reject(id: number | string, message: string): void {this.write({id, error: {code: -32601, message}});}
  private write(message: unknown): void {
    if (!this.process || this.closed || this.process.stdin.destroyed) throw new Error('App Server connection closed.');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }
  private receive(data: string): void {
    this.buffer += data;
    if (this.buffer.length > 8 * 1024 * 1024) {this.fail(new Error('App Server JSONL frame exceeds 8 MiB.')); this.close(); return;}
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      let message: z.infer<typeof envelopeSchema>;
      try {message = envelopeSchema.parse(JSON.parse(line));} catch (error) {this.fail(new Error(`Invalid App Server JSONL: ${errorMessage(error)}`)); this.close(); return;}
      if (message.method) {
        if (message.id !== undefined) {
          const request = {id: message.id, method: message.method, params: message.params};
          if (this.listenerCount('serverRequest')) this.emit('serverRequest', request);
          else this.reject(message.id, 'No interactive request handler is attached.');
        } else this.emit('notification', message.method, message.params);
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(new RpcError(message.error.code, message.error.message, message.error.data));
        else pending.resolve(message.result);
      }
    }
  }
  private fail(error: Error): void {
    for (const pending of this.pending.values()) {clearTimeout(pending.timer); pending.reject(error);}
    this.pending.clear();
    this.ready = false;
    if (!this.closed) this.emit('disconnect', error);
  }
  close(): void {
    if (this.closed) return;
    this.fail(new Error('App Server connection closed.'));
    this.closed = true;
    const child = this.process;
    if (child && child.exitCode === null) {
      child.stdin.end(); child.kill('SIGTERM');
      const timer = setTimeout(() => {if (child.exitCode === null) child.kill('SIGKILL');}, 1500);
      timer.unref(); child.once('exit', () => clearTimeout(timer));
    }
  }
}
