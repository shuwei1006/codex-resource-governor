import {type Config, type Holds, type Model, type Quota, type Selection, type Stage, type Task, rateLimitsSchema, windowNames} from './domain.js';

export const thresholds = {quality: {reduce: 10, economy: 5}, balanced: {reduce: 20, economy: 10}, saver: {reduce: 40, economy: 20}} as const;

/** Select only the global Codex bucket; never treat per-model limits as global quota. */
export function parseQuota(raw: unknown, now = Date.now() / 1000): Quota {
  const data = rateLimitsSchema.parse(raw);
  const snapshot = data.rateLimitsByLimitId?.codex ?? data.rateLimits;
  if (snapshot.limitId && snapshot.limitId !== 'codex') return {};
  const quota: Quota = {};
  for (const window of [snapshot.primary, snapshot.secondary]) {
    if (!window || window.usedPercent < 0 || window.usedPercent > 100) continue;
    if (window.resetsAt != null && window.resetsAt <= now) continue;
    const key = window.windowDurationMins === 300 ? 'fiveHour' : window.windowDurationMins === 10080 ? 'weekly' : null;
    if (!key) continue;
    const value = {remaining: 100 - window.usedPercent, resetsAt: window.resetsAt ?? null};
    if (!quota[key] || value.remaining < quota[key].remaining) quota[key] = value;
  }
  return quota;
}
export function effectiveRemaining(quota: Quota): number | null {
  const values = Object.values(quota).map(w => w.remaining);
  return values.length ? Math.min(...values) : null;
}

// Only order known semantic levels, and only ever select levels returned by model/list.
// An unknown future effort remains unchanged until its ordering can be established.
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export function lowerReasoning(selection: Selection, models: Model[]): Selection {
  const model = models.find(m => m.model === selection.model);
  const index = effortOrder.indexOf(selection.effort);
  if (!model || index < 0) return {...selection};
  const supported = new Set(model.supportedReasoningEfforts.map(e => e.reasoningEffort));
  const effort = effortOrder.slice(0, index).reverse().find(e => supported.has(e));
  return {...selection, effort: effort ?? selection.effort};
}
export type Decision = {stage: Stage; next: Selection | null; holds: Holds; remaining: number | null; reason: 'high' | 'keep' | 'quota' | 'held' | 'missing' | 'normal' | 'manual' | 'off'};
export function decide(task: Pick<Task, 'priority' | 'mode' | 'holds'> & Partial<Pick<Task, 'manualSelection'>>, config: Config, quota: Quota, models: Model[], now = Date.now() / 1000): Decision {
  const holds: Holds = structuredClone(task.holds);
  const remaining = effectiveRemaining(quota);
  if (task.mode === 'off') return {stage: 0, next: null, holds, remaining, reason: 'off'};
  if (task.mode === 'manual') return {stage: 0, next: task.manualSelection ? {...task.manualSelection} : null, holds, remaining, reason: 'manual'};
  const limits = thresholds[config.policy];
  let requested: Stage = 0;
  for (const key of windowNames) {
    const current = quota[key];
    if (!current) continue; // Missing observations cannot reset a hold or create one.
    const previous = holds[key];
    const reset = previous?.resetsAt != null && current.resetsAt != null && current.resetsAt > previous.resetsAt && now >= previous.resetsAt;
    const baseline: Stage = reset ? 0 : previous?.stage ?? 0;
    let stage: Stage = 0;
    if (task.priority !== 'high' && task.mode === 'auto') {
      if (current.remaining < limits.reduce) stage = 1;
      if (current.remaining < limits.economy && (config.policy !== 'quality' || task.priority === 'low')) stage = 2;
    }
    requested = Math.max(requested, stage) as Stage;
    holds[key] = {stage: Math.max(baseline, stage) as Stage, resetsAt: current.resetsAt ?? previous?.resetsAt ?? null};
  }
  const stage = task.priority === 'high' || task.mode === 'keep' ? 0 : Math.max(0, ...Object.values(holds).map(h => h.stage)) as Stage;
  const reason = task.priority === 'high' ? 'high' : task.mode === 'keep' ? 'keep' : remaining === null ? 'missing' : stage > requested ? 'held' : stage ? 'quota' : 'normal';
  return {stage, holds, remaining, reason, next: stage === 2 ? {...config.economy} : stage === 1 ? lowerReasoning(config.normal, models) : {...config.normal}};
}

export function explain(task: Task, config: Config, decision: Decision, quota: Quota): string {
  const zh = config.language === 'zh-CN';
  const limits = thresholds[config.policy];
  const windows = windowNames.filter(k => quota[k]).map(k => `${k === 'fiveHour' ? (zh ? '5 小时' : '5h') : (zh ? '周额度' : 'Weekly')}: ${quota[k]!.remaining}% ${zh ? '剩余' : 'remaining'}.`).join('\n');
  const reasons = {
    manual: zh ? '手动固定模型与思考强度，直到显式切换模式；优先级和额度不覆盖此选择。' : 'Manual selection stays fixed until explicitly changed; priority and quota do not override it.',
    off: zh ? '已退出选模管理。原生客户端决定下一轮配置，Governor 不覆盖；历史 Current 不代表原生最新状态。' : 'Selection governance is off. The native client controls future turns; historical Current may be stale.',
    high: zh ? 'High 优先级始终保持 Normal 配置。' : 'High priority always keeps the Normal configuration.',
    keep: zh ? 'Keep 模式始终保持 Normal 配置。' : 'Keep mode always keeps the Normal configuration.',
    missing: zh ? '额度数据缺失，不新增自动降档；保留已有周期限制。' : 'Quota is unavailable. No new automatic downgrade; existing cycle holds are retained.',
    held: zh ? '同一额度周期内只自动收紧，保持此前的降档。' : 'A previous downgrade is retained within the same quota cycle; automatic upgrades are not allowed.',
    normal: zh ? '有效额度尚未触发降档阈值。' : 'The available quota does not cross a downgrade threshold.',
    quota: zh ? '最紧张的有效额度窗口触发了此策略。' : 'The tightest valid quota window triggers this policy.',
  };
  const rule = zh ? `${config.policy}：低于 ${limits.reduce}% 时 Normal/Low 降一级 reasoning；低于 ${limits.economy}% 时${config.policy === 'quality' ? ' Low' : ' Normal/Low'} 切 Economy。` : `${config.policy}: below ${limits.reduce}%, reduce Normal/Low reasoning by one supported level; below ${limits.economy}%, switch ${config.policy === 'quality' ? 'Low' : 'Normal/Low'} to Economy.`;
  const display = (s: Selection | null) => s ? `${s.model} · ${s.effort}` : '—';
  return [windows || (zh ? '额度不可用。' : 'Quota unavailable.'), `${zh ? '策略' : 'Policy'}: ${config.policy}. ${zh ? '优先级' : 'Priority'}: ${task.priority}. ${zh ? '模式' : 'Mode'}: ${task.mode}.`, task.mode === 'auto' ? rule : '', reasons[decision.reason], `${zh ? '最近提交' : 'Last submitted'} (${task.currentMode ?? 'unknown'}): ${display(task.current)}`, `${zh ? '下一轮' : 'Next turn'}: ${display(decision.next)}`, decision.stage === 1 && decision.next?.effort === config.normal.effort ? (zh ? '该模型无已知更低档位，保持当前 reasoning。' : 'No known lower supported effort exists; reasoning stays unchanged.') : '', zh ? '阈值是本项目默认策略，并非 OpenAI 官方规则。' : 'Thresholds are project defaults, not official OpenAI rules.'].filter(Boolean).join('\n\n');
}
