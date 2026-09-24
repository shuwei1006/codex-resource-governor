import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide, effectiveRemaining, explain, lowerReasoning, parseQuota} from '../src/policy.js';
import {validateConfig, type Policy, type Priority} from '../src/domain.js';
import {config, models, task} from './helpers.js';

for (const policy of ['quality', 'balanced', 'saver'] as Policy[]) {
  const reduce = {quality: 10, balanced: 20, saver: 40}[policy];
  const economy = {quality: 5, balanced: 10, saver: 20}[policy];
  for (const priority of ['high', 'normal', 'low'] as Priority[]) {
    for (const [remaining, expected] of [[100, 0], [reduce, 0], [reduce - 1, 1], [economy, 1], [economy - 1, policy === 'quality' && priority === 'normal' ? 1 : 2], [0, policy === 'quality' && priority === 'normal' ? 1 : 2]]) {
      test(`${policy}/${priority} at ${remaining}%`, () => {
        const result = decide({...task(), priority}, {...config, policy}, {weekly: {remaining: remaining!, resetsAt: 200}}, models, 100);
        assert.equal(result.stage, priority === 'high' ? 0 : expected);
      });
    }
  }
}
test('Keep and High always use Normal, even after an Economy hold', () => {
  for (const override of [{mode: 'keep' as const}, {priority: 'high' as const}]) {
    const result = decide({...task(), ...override, holds: {weekly: {stage: 2, resetsAt: 200}}}, config, {weekly: {remaining: 0, resetsAt: 200}}, models, 100);
    assert.equal(result.stage, 0); assert.deepEqual(result.next, config.normal);
  }
});
test('reasoning lowers one supported level and never compounds', () => {
  let t = task();
  for (let i = 0; i < 4; i++) {const result = decide(t, config, {weekly: {remaining: 15, resetsAt: 200}}, models, 100); assert.equal(result.next?.effort, 'medium'); t = {...t, holds: result.holds};}
});
test('only tighten within each quota cycle, release only the reset window', () => {
  const initial = decide(task(), config, {fiveHour: {remaining: 3, resetsAt: 200}, weekly: {remaining: 15, resetsAt: 900}}, models, 100);
  const restored = decide({...task(), holds: initial.holds}, config, {fiveHour: {remaining: 95, resetsAt: 200}, weekly: {remaining: 95, resetsAt: 900}}, models, 150);
  assert.equal(restored.stage, 2);
  const shortReset = decide({...task(), holds: restored.holds}, config, {fiveHour: {remaining: 95, resetsAt: 400}, weekly: {remaining: 95, resetsAt: 900}}, models, 210);
  assert.equal(shortReset.stage, 1);
  const weeklyReset = decide({...task(), holds: shortReset.holds}, config, {weekly: {remaining: 95, resetsAt: 1800}}, models, 910);
  assert.equal(weeklyReset.stage, 0);
});
test('missing quota never creates or clears holds, including missing reset identifiers', () => {
  assert.equal(decide(task(), config, {}, models).stage, 0);
  const held = {...task(), holds: {weekly: {stage: 2 as const, resetsAt: 200}}};
  assert.equal(decide(held, config, {}, models, 300).stage, 2);
  assert.equal(decide(held, config, {weekly: {remaining: 100, resetsAt: null}}, models, 300).stage, 2);
});
test('future timestamp drift before actual reset cannot release a hold', () => {
  assert.equal(decide({...task(), holds: {weekly: {stage: 2, resetsAt: 200}}}, config, {weekly: {remaining: 100, resetsAt: 201}}, models, 150).stage, 2);
});
test('quota maps durations instead of primary/secondary positions and uses tightest global window', () => {
  const quota = parseQuota({rateLimits: {primary: {usedPercent: 84, windowDurationMins: 10080, resetsAt: 300}, secondary: {usedPercent: 37, windowDurationMins: 300, resetsAt: 200}}}, 100);
  assert.equal(quota.weekly?.remaining, 16); assert.equal(quota.fiveHour?.remaining, 63); assert.equal(effectiveRemaining(quota), 16);
});
test('prefer global codex bucket; do not use per-model quotas', () => {
  const raw = {rateLimits: {limitId: 'model-special', primary: {usedPercent: 100, windowDurationMins: 300}}, rateLimitsByLimitId: {codex: {primary: {usedPercent: 10, windowDurationMins: 10080}}}};
  assert.equal(effectiveRemaining(parseQuota(raw)), 90);
  assert.deepEqual(parseQuota({rateLimits: raw.rateLimits}), {});
});
test('invalid percentages, unsupported durations and expired observations are unavailable', () => {
  for (const window of [{usedPercent: -5, windowDurationMins: 300}, {usedPercent: 101, windowDurationMins: 300}, {usedPercent: 100, windowDurationMins: 15}, {usedPercent: 100, windowDurationMins: 300, resetsAt: 1}, {usedPercent: 100}]) assert.deepEqual(parseQuota({rateLimits: {primary: window}}, 100), {});
  assert.equal(effectiveRemaining({}), null);
});
test('model and effort validation uses live catalog; unknown effort never guessed', () => {
  assert.throws(() => validateConfig({...config, normal: {model: 'made-up', effort: 'high'}}, models));
  assert.throws(() => validateConfig({...config, normal: {model: 'model-b', effort: 'high'}}, models));
  assert.deepEqual(lowerReasoning({model: 'model-a', effort: 'future-level'}, models), {model: 'model-a', effort: 'future-level'});
  assert.equal(lowerReasoning({model: 'model-a', effort: 'low'}, models).effort, 'low');
});
test('English and Chinese explanations are deterministic and explain missing quota', () => {
  const decision = decide(task(), config, {}, models);
  assert.match(explain(task(), config, decision, {}), /Quota is unavailable/);
  assert.match(explain(task(), {...config, language: 'zh-CN'}, decision, {}), /额度数据缺失/);
});
test('a malformed window does not discard another valid quota window', () => {
  assert.equal(effectiveRemaining(parseQuota({rateLimits: {primary: {usedPercent: null, windowDurationMins: 300}, secondary: {usedPercent: 90, windowDurationMins: 10080}}})), 10);
});
