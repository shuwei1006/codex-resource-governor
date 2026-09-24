import {type Language, type Policy, type Priority, type Selection} from './domain.js';

// Shared display names for the public CLI and persisted schema.
export function priorityLabel(priority: Priority, language: Language): string {
  return (language === 'zh-CN' ? {high: '高', medium: '中', low: '低'} : {high: 'High', medium: 'Medium', low: 'Low'})[priority];
}
export function policyLabel(policy: Policy, language: Language): string {
  return (language === 'zh-CN' ? {'quality-first': '质量优先', balanced: '均衡', 'save-quota': '节省优先'} : {'quality-first': 'Quality First', balanced: 'Balanced', 'save-quota': 'Save Quota'})[policy];
}
export function profileLabel(profile: 'primary' | 'economy', language: Language): string {
  return (language === 'zh-CN' ? {primary: '主力配置', economy: '节省配置'} : {primary: 'Primary', economy: 'Economy'})[profile];
}
export function selectionLabel(value: Selection | null, language: Language): string {
  return value ? `${value.model} · ${language === 'zh-CN' ? '思考强度' : 'Reasoning Effort'}: ${value.effort}` : '—';
}
