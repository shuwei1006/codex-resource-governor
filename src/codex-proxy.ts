#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {z} from 'zod';
import {AppServer, RpcError, resolveCodexBinary} from './rpc.js';
import {Store} from './storage.js';
import {IdePolicyProxy} from './ide-proxy.js';
import {errorMessage} from './domain.js';
import {probeSchema} from './capabilities.js';

const binary = resolveCodexBinary();
const args = process.argv.slice(2);
if (process.env.CODEX_GOVERNOR_PROXY_ACTIVE === '1') {
  process.stderr.write('Governor proxy recursion: CODEX_GOVERNOR_CODEX must point to the real Codex binary.\n');
  process.exitCode = 1;
} else if (!args.includes('app-server') || args.includes('generate-json-schema') || args.includes('generate-ts')) {
  // The extension also invokes version and capability commands on the chosen executable.
  const child = spawn(binary, args, {stdio: 'inherit', shell: false, env: {...process.env, CODEX_GOVERNOR_PROXY_ACTIVE: '1'}});
  child.on('error', error => {process.stderr.write(`${errorMessage(error)}\n`); process.exitCode = 1;});
  child.on('exit', code => {process.exitCode = code ?? 1;});
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {child.kill(signal);});
} else {
  const listenIndex = args.indexOf('--listen');
  if ((listenIndex >= 0 && args[listenIndex + 1] !== 'stdio://') || args.some(arg => arg.startsWith('--listen=') && arg !== '--listen=stdio://')) throw new Error('Governor IDE proxy supports stdio transport only.');
  process.env.CODEX_GOVERNOR_PROXY_ACTIVE = '1';
  const frameSchema = z.object({id: z.union([z.string(), z.number()]).optional(), method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional(), error: z.unknown().optional()});
  const rpc = new AppServer(binary, 60_000, args);
  const policy = new IdePolicyProxy(rpc, new Store(), message => process.stderr.write(`[Governor] ${message}\n`));
  const write = (frame: unknown) => process.stdout.write(`${JSON.stringify(frame)}\n`);
  let initialized: Promise<unknown> | undefined;
  let closing = false;
  const pending = new Set<Promise<void>>();
  const serverRequests = new Set<string | number>();
  rpc.on('notification', (method: string, params: unknown) => {policy.notification(method, params); write({method, params});});
  rpc.on('serverRequest', request => {serverRequests.add(request.id); write(request);});
  async function close(code: number) {
    if (closing) return;
    closing = true;
    process.stdin.pause(); rpc.close();
    await Promise.allSettled([...pending]);
    try {await policy.close();} catch (error) {process.stderr.write(`${errorMessage(error)}\n`); code = 1;}
    process.exitCode = code;
  }
  rpc.on('disconnect', error => {if (!closing) {process.stderr.write(`${errorMessage(error)}\n`); void close(1);}});
  async function receive(raw: unknown): Promise<void> {
    const frame = frameSchema.parse(raw);
    if (frame.method === undefined) {
      if (frame.id === undefined || !serverRequests.delete(frame.id)) throw new Error('Unexpected server-request response.');
      if (frame.error !== undefined) rpc.replyError(frame.id, frame.error); else rpc.reply(frame.id, frame.result);
      return;
    }
    if (frame.method === 'initialized') return; // AppServer sends this after the forwarded handshake.
    if (frame.id === undefined) {
      if (!initialized) throw new Error('Initialize the IDE connection first.');
      await initialized; rpc.notify(frame.method, frame.params); return;
    }
    try {
      let result: unknown;
      if (frame.method === 'initialize') {
        if (initialized) throw new Error('Already initialized.');
        initialized = probeSchema(binary).then(() => rpc.start(frame.params));
        result = await initialized;
      } else {
        if (!initialized) throw new Error('Initialize the IDE connection first.');
        await initialized;
        result = await policy.request(frame.method, frame.params);
      }
      write({id: frame.id, result});
    } catch (error) {
      write({id: frame.id, error: {code: error instanceof RpcError ? error.code : -32000, message: errorMessage(error), ...(error instanceof RpcError && error.data !== undefined ? {data: error.data} : {})}});
    }
  }
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  process.stdin.on('data', (data: Buffer) => {
    if (closing) return;
    buffer += decoder.write(data);
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > 8 * 1024 * 1024) {void close(1); return;}
      let raw: unknown;
      try {raw = JSON.parse(line);} catch {process.stderr.write('Invalid IDE JSONL.\n'); void close(1); return;}
      const work = receive(raw).catch(error => {process.stderr.write(`${errorMessage(error)}\n`); void close(1);});
      pending.add(work); void work.finally(() => pending.delete(work));
    }
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {process.stderr.write('IDE JSONL frame exceeds 8 MiB.\n'); void close(1);}
  });
  process.stdin.on('end', () => {void close(0);});
  process.stdin.on('error', () => {void close(1);});
  process.stdout.on('error', () => {void close(1);});
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {void close(0);});
}
