import {z} from 'zod';
import {type Rpc, RpcError} from './rpc.js';
import {Store, isAlive} from './storage.js';
import {listModels, requireChatGPT} from './capabilities.js';
import {decide, parseQuota} from './policy.js';
import {type Task, validateConfig, validateSelection, errorMessage} from './domain.js';

const turnResult = z.object({turn: z.object({id: z.string(), status: z.string()})});
const completion = z.object({threadId: z.string(), turn: z.object({id: z.string(), status: z.string(), error: z.object({message: z.string()}).nullish()})});
const paramsSchema = z.object({threadId: z.string()}).passthrough();
const active = (task: Task) => ['starting', 'running'].includes(task.status) && task.ownerPid && isAlive(task.ownerPid);

/** Policy middleware only. The native client retains approvals, tools, prompts and streaming UI. */
export class IdePolicyProxy {
  private queue: Promise<unknown> = Promise.resolve();
  private output = new Map<string, string>();
  constructor(private readonly rpc: Rpc, private readonly store: Store, private readonly notice: (message: string) => void = () => {}) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
  }
  async request(method: string, raw: unknown = {}): Promise<unknown> {
    if (method !== 'turn/start') return this.rpc.request(method, raw);
    const params = paramsSchema.parse(raw);
    // Unmanaged native conversations pass through unchanged, without account/config/quota queries.
    const managed = (await this.store.state()).tasks.find(task => task.threadId === params.threadId);
    if (!managed) return this.rpc.request(method, raw);
    return this.serial(async () => {
      const control = (await this.store.state()).tasks.find(task => task.id === managed.id);
      if (!control) throw new Error('The managed task was deleted before dispatch.');
      if (active(control)) throw new Error('This task has an active turn. Wait for it to finish before sending another.');
      if (control.mode === 'off') return this.rpc.request(method, raw);
      const config = await this.store.config();
      if (!config) throw new Error('Governor configuration is missing. Run codex-governor config.');
      await requireChatGPT(this.rpc);
      const models = await listModels(this.rpc);
      if (control.mode !== 'manual') validateConfig(config, models);
      let quota = {};
      try {if (control.mode !== 'manual') quota = parseQuota(await this.rpc.request('account/rateLimits/read'));}
      catch (error) {if (!(error instanceof RpcError) && !(error instanceof z.ZodError)) throw error; this.notice('Quota unavailable; retaining existing Governor holds.');}
      let task!: Task;
      const mode = params.collaborationMode == null ? undefined : z.object({settings: z.object({}).passthrough()}).passthrough().parse(params.collaborationMode);
      await this.store.update(state => {
        const saved = state.tasks.find(candidate => candidate.id === managed.id);
        if (!saved) throw new Error('The managed task was deleted before dispatch.');
        if (saved.controlRevision !== control.controlRevision) throw new Error('Session control changed before dispatch. Review the new mode and send again.');
        if (active(saved)) throw new Error('This task has an active turn. Wait for it to finish before sending another.');
        const decision = decide(saved, config, quota, models);
        if (!decision.next) throw new Error('No managed selection. Set manual mode with both --model and --effort.');
        validateSelection(decision.next, models);
        saved.holds = decision.holds;
        saved.status = 'starting'; saved.ownerPid = process.pid; saved.error = null;
        saved.turnId = null; saved.hasSubmitted = true;
        task = structuredClone(saved);
      });
      const next = decide(task, config, quota, models).next;
      if (!next) throw new Error('No managed selection.');
      const overrides: Record<string, unknown> = {...params, model: next.model, effort: next.effort};
      // Collaboration settings can otherwise take precedence over top-level model/effort.
      if (mode) {
        overrides.collaborationMode = {...mode, settings: {...mode.settings, model: next.model, reasoning_effort: next.effort}};
      }
      try {
        this.output.set(task.threadId, '');
        const result = await this.rpc.request('turn/start', overrides);
        const {turn} = turnResult.parse(result);
        await this.store.update(state => {
          const saved = state.tasks.find(candidate => candidate.id === task.id);
          if (!saved) return;
          saved.current = next; saved.turnId = turn.id; saved.output = '';
          saved.currentMode = task.mode;
          saved.status = turn.status === 'inProgress' ? 'running' : turn.status === 'completed' ? 'completed' : turn.status === 'interrupted' ? 'interrupted' : 'failed';
          if (saved.status !== 'running') saved.ownerPid = null;
        });
        this.notice(`Governor ${task.id} [${task.mode}]: ${next.model} / ${next.effort}; native selector values are overridden. Use mode off for native control.`);
        return result;
      } catch (error) {
        await this.store.update(state => {
          const saved = state.tasks.find(candidate => candidate.id === task.id);
          if (saved?.ownerPid === process.pid) {
            saved.status = error instanceof RpcError ? 'failed' : 'unknown'; saved.ownerPid = null; saved.error = errorMessage(error);
          }
        });
        throw error;
      }
    });
  }
  notification(method: string, raw: unknown): void {
    if (method === 'item/agentMessage/delta') {
      const event = z.object({threadId: z.string(), delta: z.string()}).safeParse(raw);
      if (event.success && this.output.has(event.data.threadId)) this.output.set(event.data.threadId, ((this.output.get(event.data.threadId) ?? '') + event.data.delta).slice(-32_000));
    }
    if (method !== 'turn/completed') return;
    const event = completion.safeParse(raw);
    if (!event.success) return;
    void this.serial(async () => {
      const {threadId, turn} = event.data;
      await this.store.update(state => {
        const saved = state.tasks.find(task => task.threadId === threadId && task.turnId === turn.id);
        if (!saved || saved.ownerPid !== process.pid) return;
        saved.status = turn.status === 'completed' ? 'completed' : turn.status === 'interrupted' ? 'interrupted' : 'failed';
        saved.ownerPid = null; saved.error = turn.error?.message ?? null;
        saved.output = this.output.get(threadId) ?? saved.output;
      });
      this.output.delete(threadId);
    }).catch(error => this.notice(errorMessage(error)));
  }
  async close(): Promise<void> {
    await this.queue;
    await this.store.update(state => {
      for (const task of state.tasks) if (task.ownerPid === process.pid && ['starting', 'running'].includes(task.status)) {
        task.status = 'unknown'; task.ownerPid = null; task.error = 'Native IDE connection closed; reconcile the thread before continuing.';
        task.output = this.output.get(task.threadId) ?? task.output;
      }
    });
    this.output.clear();
  }
}
