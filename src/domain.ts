import {z} from 'zod';

export const prioritySchema = z.enum(['high', 'normal', 'low']);
export const modeSchema = z.enum(['auto', 'manual', 'off', 'keep']);
export const policySchema = z.enum(['quality', 'balanced', 'saver']);
export const languageSchema = z.enum(['en', 'zh-CN']);
export const selectionSchema = z.object({model: z.string().min(1), effort: z.string().min(1)});
export const configSchema = z.object({
  version: z.literal(1), language: languageSchema.default('en'),
  normal: selectionSchema, economy: selectionSchema, policy: policySchema.default('balanced'),
  openIn: z.enum(['none', 'app', 'vscode', 'both']).optional(),
});
export const modelSchema = z.object({
  id: z.string(), model: z.string().min(1), displayName: z.string(),
  hidden: z.boolean().default(false), isDefault: z.boolean().default(false),
  defaultReasoningEffort: z.string().min(1),
  supportedReasoningEfforts: z.array(z.object({reasoningEffort: z.string().min(1), description: z.string().default('')})).min(1),
});
export const modelListSchema = z.object({data: z.array(modelSchema), nextCursor: z.string().nullish()});
const windowSchema = z.object({usedPercent: z.number().finite(), windowDurationMins: z.number().nullish(), resetsAt: z.number().nullish()});
const snapshotSchema = z.object({limitId: z.string().nullish(), primary: windowSchema.nullish().catch(null), secondary: windowSchema.nullish().catch(null)});
export const rateLimitsSchema = z.object({rateLimits: snapshotSchema, rateLimitsByLimitId: z.record(snapshotSchema).nullish()});
export const windowNames = ['fiveHour', 'weekly'] as const;
export type WindowName = typeof windowNames[number];
export type Stage = 0 | 1 | 2;
export type WindowQuota = {remaining: number; resetsAt: number | null};
export type Quota = Partial<Record<WindowName, WindowQuota>>;
const holdSchema = z.object({stage: z.union([z.literal(0), z.literal(1), z.literal(2)]), resetsAt: z.number().nullable()});
export const holdsSchema = z.object({fiveHour: holdSchema.optional(), weekly: holdSchema.optional()});
export const taskSchema = z.object({
  id: z.string(), threadId: z.string(), name: z.string().min(1).max(120), cwd: z.string(),
  priority: prioritySchema, mode: modeSchema, createdAt: z.string(),
  manualSelection: selectionSchema.nullable().default(null),
  controlRevision: z.number().int().nonnegative().default(0),
  currentMode: modeSchema.nullable().default(null),
  holds: holdsSchema.default({}), current: selectionSchema.nullable().default(null),
  turnId: z.string().nullable().default(null),
  hasSubmitted: z.boolean().default(false),
  status: z.enum(['idle', 'starting', 'running', 'completed', 'failed', 'interrupted', 'unknown']).default('idle'),
  ownerPid: z.number().nullable().default(null), output: z.string().default(''), error: z.string().nullable().default(null),
});
export const stateSchema = z.object({version: z.literal(1), tasks: z.array(taskSchema)});
export type Config = z.infer<typeof configSchema>;
export type Model = z.infer<typeof modelSchema>;
export type Selection = z.infer<typeof selectionSchema>;
export type Task = z.infer<typeof taskSchema>;
export type State = z.infer<typeof stateSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type Mode = z.infer<typeof modeSchema>;
export type Policy = z.infer<typeof policySchema>;
export type Language = z.infer<typeof languageSchema>;
export type Holds = z.infer<typeof holdsSchema>;

export function validateSelection(selection: Selection, models: Model[]): void {
  const model = models.find(m => m.model === selection.model && !m.hidden);
  if (!model) throw new Error(`Model unavailable: ${selection.model}. Run codex-governor config.`);
  if (!model.supportedReasoningEfforts.some(e => e.reasoningEffort === selection.effort)) {
    throw new Error(`Unsupported reasoning: ${selection.model} / ${selection.effort}. Run codex-governor config.`);
  }
}
export function validateConfig(config: Config, models: Model[]): void {
  validateSelection(config.normal, models);
  validateSelection(config.economy, models);
}
export function errorMessage(error: unknown): string {return error instanceof Error ? error.message : String(error);}
