import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changeControl} from '../src/control.js';
import {decide} from '../src/policy.js';
import {taskSchema} from '../src/domain.js';
import {config, models, task} from './helpers.js';

test('explicit manual selection beats High priority and quota; off returns no selection', () => {
  const value = {...task(), priority: 'high' as const};
  changeControl(value, 'manual', config.economy);
  assert.deepEqual(decide(value, config, {weekly: {remaining: 0, resetsAt: 200}}, models, 100).next, config.economy);
  assert.equal(value.controlRevision, 1);
  changeControl(value, 'off');
  assert.equal(decide(value, config, {}, models).next, null);
  assert.equal(value.manualSelection, null);
  changeControl(value, 'auto');
  assert.deepEqual(decide(value, config, {}, models).next, config.normal);
});

test('mode edits require explicit manual pairs, preserve Current and cycle holds, and parse legacy records', () => {
  const value = task();
  value.current = config.normal;
  value.holds = {weekly: {stage: 2, resetsAt: 200}};
  assert.throws(() => changeControl(value, 'manual'), /both/);
  assert.throws(() => changeControl(value, 'off', config.normal), /only valid/);
  assert.equal(value.mode, 'auto');
  changeControl(value, 'manual', config.economy);
  assert.deepEqual(value.current, config.normal);
  assert.deepEqual(decide(value, config, {}, models).holds, value.holds);
  changeControl(value, 'auto');
  assert.deepEqual(decide(value, config, {}, models).next, config.economy);
  const legacy = {...task(), mode: 'keep', manualSelection: undefined, controlRevision: undefined, currentMode: undefined};
  const parsed = taskSchema.parse(legacy);
  assert.equal(parsed.mode, 'keep'); assert.equal(parsed.controlRevision, 0);
  assert.deepEqual(decide(parsed, config, {}, models).next, config.normal);
});
