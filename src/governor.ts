import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {z} from 'zod';
import {type Config, type Model, type Quota, type Task, type Priority, type Mode, errorMessage, taskSchema, validateConfig, validateSelection} from './domain.js';
import {RpcError, type Rpc, type ServerRequest} from './rpc.js';
import {Store, isAlive} from './storage.js';
import {listModels, requireChatGPT} from './capabilities.js';
import {decide, explain, parseQuota, type Decision} from './policy.js';
import {changeControl} from './control.js';
import {type Selection} from './domain.js';

const threadResponse = z.object({thread: z.object({id: z.string(), turns: z.array(z.object({id: z.string(), status: z.string()})).optional()})});
const turnResponse = z.object({turn: z.object({id: z.string(), status: z.string()})});
const eventSchema = z.object({threadId: z.string(), turnId: z.string().optional(), delta: z.string().optional(), requestId: z.union([z.string(), z.number()]).optional(), item: z.object({type: z.string(), text: z.string().optional()}).passthrough().optional(), turn: z.object({id: z.string(), status: z.string(), error: z.object({message: z.string()}).nullish()}).optional()});
export class Governor extends EventEmitter {
  models: Model[] = [];
  quota: Quota = {};
  config!: Config;
  tasks: Task[] = [];
  quotaError: string | null = null;
  connectionError: string | null = null;
  requests: ServerRequest[] = [];
  private output = new Map<string, string>();
  private items = new Map<string, unknown>();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private connectedThreads = new Set<string>();
  private closing = false;
  private disposePromise?: Promise<void>;
  constructor(readonly rpc: Rpc, readonly store: Store) {
    super();
    rpc.on('notification', this.notification);
    rpc.on('serverRequest', this.serverRequest);
    rpc.on('disconnect', this.disconnect);
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  async initialize(): Promise<void> {
    await requireChatGPT(this.rpc);
    this.models = await listModels(this.rpc);
    const config = await this.store.config();
    if (!config) throw new Error('Run codex-governor config first.');
    validateConfig(config, this.models); this.config = config;
    await this.refresh();
    this.timer = setInterval(() => {void this.refresh().catch(e => this.emit('notice', errorMessage(e)));}, 30_000);
    this.timer.unref();
  }
  async refresh(): Promise<void> {return this.serial(() => this.refreshInternal());}
  private async refreshInternal(): Promise<void> {
    const config = await this.store.config();
    if (config) {validateConfig(config, this.models); this.config = config;}
    try {this.quota = parseQuota(await this.rpc.request('account/rateLimits/read')); this.quotaError = null;}
    catch (error) {this.quota = {}; this.quotaError = errorMessage(error);}
    await this.persistDecisions();
  }
  private async persistDecisions(): Promise<void> {
    const state = await this.store.update(state => {
      for (const task of state.tasks) task.holds = decide(task, this.config, this.quota, this.models).holds;
    });
    this.tasks = state.tasks; this.emit('change');
  }
  task(id: string): Task {
    const exact = this.tasks.find(t => t.id === id || t.threadId === id);
    if (exact) return exact;
    const matches = this.tasks.filter(t => t.id.startsWith(id));
    if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous task ID: ${id}` : `Managed task not found: ${id}`);
    return matches[0]!;
  }
  decision(task: Task): Decision {return decide(task, this.config, this.quota, this.models);}
  explain(id: string): string {const task = this.task(id); return explain(task, this.config, this.decision(task), this.quota);}
  taskOutput(task: Task): string {return this.output.get(task.id) ?? task.output;}
  async createTask(name: string, priority: Priority = 'medium', cwd = process.cwd()): Promise<Task> {
    return this.serial(async () => {
      name = z.string().trim().min(1).max(120).parse(name);
      const response = threadResponse.parse(await this.rpc.request('thread/start', {model: this.config.primary.model, cwd: resolve(cwd), sandbox: 'workspace-write', approvalPolicy: 'on-request'}));
      const task = taskSchema.parse({id: randomUUID(), threadId: response.thread.id, name, priority, mode: 'auto', cwd: resolve(cwd), createdAt: new Date().toISOString()});
      task.holds = this.decision(task).holds;
      this.tasks = (await this.store.update(s => s.tasks.push(task))).tasks;
      try {await this.rpc.request('thread/name/set', {threadId: task.threadId, name});}
      catch (error) {this.emit('notice', `Task created; Codex title sync unavailable: ${errorMessage(error)}`);}
      this.connectedThreads.add(task.threadId); this.emit('change'); return task;
    });
  }
  async setPriority(id: string, priority: Priority): Promise<void> {await this.changeTask(id, t => {t.priority = priority;});}
  async setMode(id: string, mode: Mode, selection?: Selection): Promise<void> {
    if (mode === 'manual' && selection) {this.models = await listModels(this.rpc); validateSelection(selection, this.models);}
    await this.changeTask(id, t => {changeControl(t, mode, selection);});
  }
  private async changeTask(id: string, change: (task: Task) => void): Promise<void> {
    return this.serial(async () => {
      const taskId = this.task(id).id;
      this.tasks = (await this.store.update(state => {
        const task = state.tasks.find(t => t.id === taskId);
        if (!task) throw new Error(`Managed task was deleted: ${taskId}`);
        change(task);
        task.holds = this.decision(task).holds;
      })).tasks; this.emit('change');
    });
  }
  async setConfig(config: Config): Promise<void> {
    return this.serial(async () => {validateConfig(config, this.models); await this.store.saveConfig(config); this.config = config; await this.persistDecisions();});
  }
  async startTurn(id: string, prompt: string): Promise<void> {
    return this.serial(async () => {
      if (this.connectionError) throw new Error(this.connectionError);
      prompt = z.string().trim().min(1).parse(prompt);
      await this.refreshInternal(); // Fresh quota/config immediately before every turn.
      this.models = await listModels(this.rpc);
      validateConfig(this.config, this.models);
      const taskId = this.task(id).id;
      // Reserve atomically across processes before resuming or sending any model input.
      this.tasks = (await this.store.update(state => {
        const task = state.tasks.find(t => t.id === taskId);
        if (!task) throw new Error(`Managed task was deleted: ${taskId}`);
        if (task.mode === 'off') throw new Error('Governance is off. Continue in a native Codex client, or explicitly choose auto/manual mode.');
        if (task.ownerPid && isAlive(task.ownerPid) && ['starting', 'running'].includes(task.status)) throw new Error('This task already has an active turn.');
        task.status = 'starting'; task.ownerPid = process.pid; task.error = null;
        task.turnId = null;
      })).tasks;
      let task = this.task(taskId);
      let submitted = false;
      try {
        if (!this.connectedThreads.has(task.threadId)) {
          try {
            const resumed = threadResponse.parse(await this.rpc.request('thread/resume', {threadId: task.threadId, cwd: task.cwd, sandbox: 'workspace-write', approvalPolicy: 'on-request'}));
            if (resumed.thread.turns?.some(t => t.status === 'inProgress')) throw new Error('Codex reports an active turn. Wait for completion before sending another.');
          } catch (error) {
            // Codex may not persist an empty thread. Recreate only a provably unused
            // managed thread; never replay a possibly accepted user prompt.
            if (!(error instanceof RpcError) || !/no rollout found for thread id/i.test(error.message) || task.hasSubmitted || task.current || task.turnId) throw error;
            const created = threadResponse.parse(await this.rpc.request('thread/start', {model: this.config.primary.model, cwd: task.cwd, sandbox: 'workspace-write', approvalPolicy: 'on-request'}));
            this.tasks = (await this.store.update(state => {state.tasks.find(t => t.id === taskId)!.threadId = created.thread.id;})).tasks;
            task = this.task(taskId);
          }
          this.connectedThreads.add(task.threadId);
        }
        const decision = this.decision(task);
        if (!decision.next) throw new Error('No managed model selection. Set manual --model/--effort or switch to auto.');
        validateSelection(decision.next, this.models);
        this.tasks = (await this.store.update(state => {state.tasks.find(t => t.id === taskId)!.hasSubmitted = true;})).tasks;
        submitted = true;
        const result = turnResponse.parse(await this.rpc.request('turn/start', {threadId: task.threadId, model: decision.next.model, effort: decision.next.effort, input: [{type: 'text', text: prompt}]}));
        this.output.set(task.id, '');
        this.tasks = (await this.store.update(state => {
          const saved = state.tasks.find(t => t.id === taskId)!;
          saved.current = decision.next; saved.holds = decision.holds; saved.turnId = result.turn.id;
          saved.currentMode = task.mode;
          saved.status = result.turn.status === 'inProgress' ? 'running' : result.turn.status === 'completed' ? 'completed' : 'failed';
          saved.output = ''; saved.error = null;
          if (saved.status !== 'running') saved.ownerPid = null;
        })).tasks;
      } catch (error) {
        this.tasks = (await this.store.update(state => {
          const saved = state.tasks.find(t => t.id === taskId)!;
          saved.status = submitted ? 'unknown' : 'failed'; saved.ownerPid = null; saved.error = errorMessage(error);
        })).tasks;
        throw error;
      } finally {this.emit('change');}
    });
  }
  async interrupt(id: string): Promise<void> {
    const taskId = this.task(id).id;
    return this.serial(async () => {
      const state = await this.store.state();
      this.tasks = state.tasks;
      const task = state.tasks.find(candidate => candidate.id === taskId);
      if (!task) throw new Error(`Managed task was deleted: ${taskId}`);
      if (!task.turnId || !['starting', 'running', 'unknown'].includes(task.status)) throw new Error('This task has no interruptible turn.');
      if (!this.connectedThreads.has(task.threadId)) {
        await this.rpc.request('thread/resume', {threadId: task.threadId, cwd: task.cwd, sandbox: 'workspace-write', approvalPolicy: 'on-request'});
        this.connectedThreads.add(task.threadId);
      }
      const turnId = task.turnId;
      await this.rpc.request('turn/interrupt', {threadId: task.threadId, turnId});
      this.tasks = (await this.store.update(savedState => {
        const saved = savedState.tasks.find(candidate => candidate.id === taskId);
        if (saved && saved.turnId === turnId && ['starting', 'running', 'unknown'].includes(saved.status)) {
          saved.status = 'interrupted'; saved.ownerPid = null; saved.error = null;
        }
      })).tasks;
      this.requests = this.requests.filter(request => !requestForThread(request, task.threadId));
      this.emit('change');
    });
  }
  async deleteTask(id: string): Promise<Task> {
    const taskId = this.task(id).id;
    const latest = (await this.store.state()).tasks.find(task => task.id === taskId);
    if (!latest) throw new Error(`Managed task was deleted: ${taskId}`);
    if (['starting', 'running', 'unknown'].includes(latest.status)) await this.interrupt(taskId);
    return this.serial(async () => {
      let deleted: Task | undefined;
      this.tasks = (await this.store.update(state => {
        const index = state.tasks.findIndex(task => task.id === taskId);
        if (index < 0) throw new Error(`Managed task was deleted: ${taskId}`);
        const task = state.tasks[index]!;
        if (['starting', 'running', 'unknown'].includes(task.status)) throw new Error('The task became active again; interrupt it before deleting the record.');
        deleted = structuredClone(task);
        state.tasks.splice(index, 1);
      })).tasks;
      this.output.delete(taskId);
      this.connectedThreads.delete(deleted!.threadId);
      this.requests = this.requests.filter(request => !requestForThread(request, deleted!.threadId));
      this.emit('change');
      return deleted!;
    });
  }
  private notification = (method: string, raw: unknown): void => {
    if (this.closing) return;
    if (method === 'account/rateLimits/updated') {
      void this.serial(async () => {try {this.quota = parseQuota(raw); this.quotaError = null;} catch (error) {this.quota = {}; this.quotaError = errorMessage(error);} await this.persistDecisions();}).catch(e => this.emit('notice', errorMessage(e)));
      return;
    }
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    // Serialize notifications behind turn/start acknowledgements, including very fast completions.
    void this.serial(async () => {
      const task = this.tasks.find(t => t.threadId === event.threadId);
      if (!task) return;
      if (event.turnId && task.turnId && event.turnId !== task.turnId) return;
      if ((method === 'item/started' || method === 'item/completed') && event.item && typeof event.item.id === 'string') {
        this.items.set(`${task.threadId}:${event.item.id}`, event.item);
        if (this.items.size > 100) this.items.delete(this.items.keys().next().value!);
        this.emit('change');
        return;
      }
      if (method === 'item/agentMessage/delta' && event.delta) {
        this.output.set(task.id, (this.taskOutput(task) + event.delta).slice(-32_000)); this.emit('change'); return;
      }
      if (method === 'serverRequest/resolved') {this.requests = this.requests.filter(r => r.id !== event.requestId); this.emit('change'); return;}
      if (method !== 'turn/completed' || !event.turn || (task.turnId && task.turnId !== event.turn.id)) return;
      const turn = event.turn;
      this.tasks = (await this.store.update(state => {
        const saved = state.tasks.find(t => t.id === task.id);
        if (!saved || saved.turnId !== turn.id) return;
        saved.status = turn.status === 'completed' ? 'completed' : turn.status === 'interrupted' ? 'interrupted' : 'failed';
        saved.error = turn.error?.message ?? null; saved.ownerPid = null; saved.output = this.taskOutput(task);
      })).tasks;
      this.requests = this.requests.filter(r => !requestForThread(r, task.threadId));
      this.emit('change');
    }).catch(e => this.emit('notice', errorMessage(e)));
  };
  private serverRequest = (request: ServerRequest): void => {
    if (!this.tasks.some(task => requestForThread(request, task.threadId))) {
      this.rpc.reject(request.id, 'Request is not associated with a Governor-managed task.');
      return;
    }
    if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput'].includes(request.method)) {
      this.requests.push(request); this.emit('change');
    } else {
      this.rpc.reject(request.id, `Governor v0.1 does not support ${request.method}. Request not approved.`);
      this.emit('notice', `Unsupported interactive request: ${request.method}. Request was rejected.`);
    }
  };
  answerRequest(request: ServerRequest, answer: boolean | Record<string, {answers: string[]}>): void {
    if (request.method === 'item/tool/requestUserInput') this.rpc.reply(request.id, {answers: typeof answer === 'boolean' ? {} : answer});
    else this.rpc.reply(request.id, {decision: answer === true ? 'accept' : 'decline'});
    this.requests = this.requests.filter(r => r.id !== request.id); this.emit('change');
  }
  requestDetails(request: ServerRequest): unknown {
    const params = z.object({threadId: z.string(), itemId: z.string().optional()}).passthrough().safeParse(request.params);
    if (!params.success) return request.params;
    return {...params.data, itemDetails: this.items.get(`${params.data.threadId}:${params.data.itemId}`)};
  }
  private disconnect = (error: Error): void => {
    if (this.closing) return;
    this.connectionError = error.message; this.emit('change');
    void this.serial(async () => {
      this.tasks = (await this.store.update(state => {for (const task of state.tasks) if (task.ownerPid === process.pid && ['starting', 'running'].includes(task.status)) {task.status = 'unknown'; task.ownerPid = null; task.error = error.message;}})).tasks;
      this.emit('change');
    }).catch(e => this.emit('notice', errorMessage(e)));
  };
  dispose(): Promise<void> {
    this.disposePromise ??= this.disposeInternal();
    return this.disposePromise;
  }
  private async disposeInternal(): Promise<void> {
    this.closing = true; clearInterval(this.timer);
    for (const request of [...this.requests]) {try {this.answerRequest(request, false);} catch { /* Disconnected. */ }}
    await this.queue;
    await Promise.allSettled(this.tasks.filter(t => t.ownerPid === process.pid && t.status === 'running' && t.turnId).map(t => this.rpc.request('turn/interrupt', {threadId: t.threadId, turnId: t.turnId})));
    this.tasks = (await this.store.update(state => {for (const task of state.tasks) if (task.ownerPid === process.pid) {task.status = 'unknown'; task.ownerPid = null; task.error = 'Session closed; thread will be reconciled on resume.'; task.output = this.taskOutput(task);}})).tasks;
    this.rpc.off('notification', this.notification); this.rpc.off('serverRequest', this.serverRequest); this.rpc.off('disconnect', this.disconnect);
  }
}
function requestForThread(request: ServerRequest, id: string): boolean {return z.object({threadId: z.literal(id)}).safeParse(request.params).success;}
