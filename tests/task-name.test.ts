import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskNameFromPrompt} from '../src/task-name.js';

test('generates a local task name for Chinese and English prompts', () => {
  assert.equal(taskNameFromPrompt('做一个关于中秋节的祝福卡片'), '中秋节祝福卡片');
  assert.equal(taskNameFromPrompt('请帮我做一个关于中秋节的祝福卡片。使用暖色。'), '中秋节祝福卡片');
  assert.equal(taskNameFromPrompt('Please summarize this project. Include the risks.'), 'summarize this project');
  assert.equal(taskNameFromPrompt('修复 src/cli.tsx 的错误\n保留所有现有命令'), '修复 src/cli.tsx 的错误');
});

test('task labels are bounded without splitting Unicode, sanitized, and never blank', () => {
  assert.equal(taskNameFromPrompt('🌕'.repeat(60)), `${'🌕'.repeat(31)}…`);
  assert.equal(taskNameFromPrompt('\x1b[31m中秋祝福\x1b[0m'), '中秋祝福');
  assert.equal(taskNameFromPrompt('请帮我'), '请帮我');
  assert.throws(() => taskNameFromPrompt(' \n\t '), /Prompt/);
  assert.throws(() => taskNameFromPrompt('\x1b[31m'), /Prompt/);
});
