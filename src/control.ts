import {type Mode, type Selection, type Task, selectionSchema} from './domain.js';

/** Called inside Store.update: selection and authority change together. */
export function changeControl(task: Task, mode: Mode, selection?: Selection): void {
  if (mode === 'manual' && !selection) throw new Error('Manual mode requires both --model and --effort.');
  if (mode !== 'manual' && selection) throw new Error('--model and --effort are only valid in manual mode.');
  task.manualSelection = mode === 'manual' ? selectionSchema.parse(selection) : null;
  task.mode = mode;
  task.controlRevision++;
}
