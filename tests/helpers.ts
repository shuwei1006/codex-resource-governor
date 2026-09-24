import {type Config, type Model, taskSchema} from '../src/domain.js';
export const models: Model[] = [
  {id: 'model-a', model: 'model-a', displayName: 'Model A', hidden: false, isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: ['low', 'medium', 'high'].map(reasoningEffort => ({reasoningEffort, description: ''}))},
  {id: 'model-b', model: 'model-b', displayName: 'Model B', hidden: false, isDefault: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium'].map(reasoningEffort => ({reasoningEffort, description: ''}))},
];
export const config: Config = {version: 1, language: 'en', policy: 'balanced', normal: {model: 'model-a', effort: 'high'}, economy: {model: 'model-b', effort: 'medium'}};
export function task() {return taskSchema.parse({id: 'test-task', threadId: 'thread-1', name: 'Test task', cwd: '/tmp', priority: 'normal', mode: 'auto', createdAt: new Date().toISOString()});}
