import React from 'react';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {render} from 'ink-testing-library';
import {TaskRow, ConfigWizard, safeText} from '../src/ui.js';
import {config, models, task} from './helpers.js';
import {changeControl} from '../src/control.js';
import {type Mode, type Selection} from '../src/domain.js';

test('task row shows immutable Current separately from Next turn in both languages', () => {
  for (const lang of ['en', 'zh-CN'] as const) {
    const ui = render(<TaskRow task={{...task(), current: config.normal, status: 'running'}} next={config.economy} selected lang={lang} />);
    assert.match(ui.lastFrame()!, lang === 'en' ? /Current: model-a · high/ : /当前: model-a · high/);
    assert.match(ui.lastFrame()!, lang === 'en' ? /Next turn: model-b · medium/ : /下一轮: model-b · medium/);
    ui.unmount(); ui.cleanup();
  }
});
test('onboarding starts with an explicit bilingual language selector', () => {
  const ui = render(<ConfigWizard models={models} onSave={async () => {}} />);
  assert.match(ui.lastFrame()!, /English/); assert.match(ui.lastFrame()!, /简体中文/);
  ui.unmount(); ui.cleanup();
});
test('external content cannot inject terminal control sequences', () => {
  assert.equal(safeText('\x1b[2Jhello\x1b]0;malicious\x07\x00'), 'hello');
});

test('TUI paginates tasks to one screen and keyboard mode controls update the selected task', async () => {
  const {EventEmitter} = await import('node:events');
  const {App} = await import('../src/ui.js');
  const {decide} = await import('../src/policy.js');
  const events = new EventEmitter();
  const governor = Object.assign(events, {
    config, models, quota: {weekly: {remaining: 16, resetsAt: 9999999999}},
    tasks: Array.from({length: 10}, (_, i) => ({...task(), id: `task-${i}`, name: `Task ${i}`})),
    requests: [], connectionError: null, quotaError: null,
    decision(value: ReturnType<typeof task>) {return decide(value, config, this.quota, models);},
    async setMode(id: string, mode: Mode, selection?: Selection) {changeControl(this.tasks.find(t => t.id === id)!, mode, selection); events.emit('change');},
    async deleteTask(id: string) {const index = this.tasks.findIndex(t => t.id === id); const [deleted] = this.tasks.splice(index, 1); events.emit('change'); return deleted;},
  });
  const ui = render(<App governor={governor as unknown as import('../src/governor.js').Governor} />);
  const tick = () => new Promise(resolve => setTimeout(resolve, 40));
  try {
    await tick();
    assert.match(ui.lastFrame()!, /TASKS \(10\)/);
    assert.ok(ui.lastFrame()!.split('\n').length <= 24);
    assert.ok(!ui.lastFrame()!.includes('Task 9'));
    ui.stdin.write('m'); await tick(); assert.match(ui.lastFrame()!, /Mode/);
    ui.stdin.write('\u001b[B'); await tick(); ui.stdin.write('\u001b[B'); await tick(); ui.stdin.write('\u001b[B'); await tick(); ui.stdin.write('\r'); await tick();
    assert.equal(governor.tasks[0]?.mode, 'keep');
    assert.match(ui.lastFrame()!, /keep/);
    ui.stdin.write('m'); await tick(); ui.stdin.write('\u001b[B'); await tick(); ui.stdin.write('\r'); await tick();
    assert.match(ui.lastFrame()!, /Fixed model/);
    ui.stdin.write('\r'); await tick();
    assert.match(ui.lastFrame()!, /Fixed effort/);
    assert.equal(governor.tasks[0]?.mode, 'keep');
    ui.stdin.write('\r'); await tick();
    assert.equal(governor.tasks[0]?.mode, 'manual');
    assert.deepEqual(governor.tasks[0]?.manualSelection, {model: 'model-a', effort: 'low'});
    ui.stdin.write('d'); await tick(); assert.match(ui.lastFrame()!, /Delete local task record/);
    ui.stdin.write('\u001b[B'); await tick(); ui.stdin.write('\r'); await tick();
    assert.equal(governor.tasks.length, 9);
    assert.doesNotMatch(ui.lastFrame()!, /Task 0/);
  } finally {ui.unmount(); ui.cleanup();}
});
