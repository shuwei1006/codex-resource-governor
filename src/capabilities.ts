import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
import {AppServer, RpcError, resolveCodexBinary, type Rpc} from './rpc.js';
import {type Model, errorMessage, modelListSchema} from './domain.js';
import {parseQuota} from './policy.js';

const exec = promisify(execFile);
export async function listModels(rpc: Rpc): Promise<Model[]> {
  const models: Model[] = [];
  let cursor: string | null | undefined;
  const seen = new Set<string>();
  do {
    const page = modelListSchema.parse(await rpc.request('model/list', {limit: 100, ...(cursor ? {cursor} : {})}));
    models.push(...page.data.filter(m => !m.hidden));
    cursor = page.nextCursor;
    if (cursor) {if (seen.has(cursor)) throw new Error('model/list returned a repeated pagination cursor.'); seen.add(cursor);}
  } while (cursor);
  if (!models.length) throw new Error('model/list returned no usable models.');
  return [...new Map(models.map(m => [m.model, m])).values()];
}
export async function requireChatGPT(rpc: Rpc): Promise<void> {
  const account = z.object({account: z.object({type: z.string()}).nullish()}).parse(await rpc.request('account/read', {}));
  if (account.account?.type !== 'chatgpt') throw new Error('ChatGPT login required. Run codex login, then codex-governor doctor. API-key quota is not supported.');
}
export async function probeSchema(binary: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-governor-schema-'));
  try {
    await exec(binary, ['app-server', 'generate-json-schema', '--out', directory], {timeout: 30_000, maxBuffer: 4 * 1024 * 1024});
    const shape = z.object({properties: z.record(z.unknown())});
    const turn = shape.parse(JSON.parse(await readFile(join(directory, 'v2', 'TurnStartParams.json'), 'utf8')));
    for (const field of ['threadId', 'input', 'model', 'effort']) if (!(field in turn.properties)) throw new Error(`turn/start capability missing: ${field}`);
    const thread = shape.parse(JSON.parse(await readFile(join(directory, 'v2', 'ThreadStartParams.json'), 'utf8')));
    for (const field of ['model', 'ephemeral', 'sandbox', 'approvalPolicy']) if (!(field in thread.properties)) throw new Error(`thread/start capability missing: ${field}`);
  } finally {await rm(directory, {recursive: true, force: true});}
}
export type DoctorCheck = {name: string; ok: boolean; detail: string};
export async function doctor(binary = resolveCodexBinary(), liveTurn = false, report: (check: DoctorCheck) => void = () => {}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  async function check(name: string, action: () => Promise<string>): Promise<boolean> {
    try {const result = {name, ok: true, detail: await action()}; checks.push(result); report(result); return true;}
    catch (error) {const result = {name, ok: false, detail: errorMessage(error)}; checks.push(result); report(result); return false;}
  }
  await check('Node >=20', async () => {if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required.'); return process.version;});
  const found = await check('codex binary / version', async () => (await exec(binary, ['--version'], {timeout: 10_000})).stdout.trim());
  if (!found) return checks;
  await check('turn/start model + effort schema', async () => {await probeSchema(binary); return 'Installed schema declares both overrides; no version gate.';});
  const rpc = new AppServer(binary);
  try {
    if (!await check('app-server / initialize', async () => {await rpc.start(); return 'stdio JSONL handshake completed.';})) return checks;
    await check('account/read / ChatGPT login', async () => {await requireChatGPT(rpc); return 'ChatGPT session available (identity redacted).';});
    await check('account/rateLimits/read', async () => {const quota = parseQuota(await rpc.request('account/rateLimits/read')); return Object.keys(quota).length ? 'Valid quota windows available.' : 'RPC available; recognized quota windows unavailable (not treated as zero).';});
    let models: Model[] = [];
    await check('model/list', async () => {models = await listModels(rpc); return `${models.length} usable models discovered.`;});
    const model = models.find(m => m.isDefault) ?? models[0];
    if (!model) return checks;
    let threadId = '';
    await check('thread/start', async () => {
      const result = z.object({thread: z.object({id: z.string()})}).parse(await rpc.request('thread/start', {model: model.model, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never', cwd: process.cwd()}));
      threadId = result.thread.id; return 'Ephemeral read-only thread created; no inference.';
    });
    await check('turn/start dispatch', async () => {
      try {await rpc.request('turn/start', {threadId: '00000000-0000-0000-0000-000000000000', model: model.model, effort: model.defaultReasoningEffort, input: []});}
      catch (error) {
        if (error instanceof RpcError && error.code !== -32601 && /thread.*(not found|unknown|does not exist)|no.*thread/i.test(error.message)) return 'Method accepts override payload; unknown-thread probe rejected before inference. Use --live-turn for a real turn.';
        throw error;
      }
      throw new Error('Unexpected success for a nonexistent thread.');
    });
    if (liveTurn && threadId) await check('turn/start live inference', async () => {
      let cleanup = () => {};
      const completed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {rpc.off('notification', listener); reject(new Error('Live probe did not complete in 60 seconds.'));}, 60_000);
        const listener = (method: string, params: unknown) => {
          if (method !== 'turn/completed') return;
          const event = z.object({threadId: z.string(), turn: z.object({status: z.string(), error: z.object({message: z.string()}).nullish()})}).safeParse(params);
          if (!event.success || event.data.threadId !== threadId) return;
          clearTimeout(timer); rpc.off('notification', listener);
          if (event.data.turn.status === 'completed') resolve(); else reject(new Error(event.data.turn.error?.message ?? event.data.turn.status));
        };
        rpc.on('notification', listener);
        cleanup = () => {clearTimeout(timer); rpc.off('notification', listener);};
      });
      // Attach rejection immediately, even if starting the turn itself fails.
      void completed.catch(() => {});
      try {
        await rpc.request('turn/start', {threadId, model: model.model, effort: model.defaultReasoningEffort, input: [{type: 'text', text: 'Reply with OK only. Do not use any tools.'}]});
        await completed; return 'A real turn with model/effort overrides completed (uses account quota).';
      } finally {cleanup();}
    });
  } finally {rpc.close();}
  return checks;
}
