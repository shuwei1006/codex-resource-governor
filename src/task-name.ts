import {stripVTControlCharacters} from 'node:util';

/** Produce a short display label locally; the original prompt remains the task input. */
export function taskNameFromPrompt(prompt: string): string {
  // eslint-disable-next-line no-control-regex -- Task labels must not contain terminal controls.
  const clean = stripVTControlCharacters(prompt).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
  if (!clean) throw new Error('Prompt must contain non-whitespace text.');

  const firstSentence = clean.split(/[\r\n。！？!?]|\.(?:\s|$)/u).find(part => part.trim())?.trim() || clean;
  let title = firstSentence
    .replace(/^(?:(?:请|麻烦|帮我|给我|为我)\s*)+/u, '')
    .replace(/^(?:制作|创建|生成|编写|设计|做|写)(?:一个|一张|一份|一篇|一套)?\s*/u, '')
    .replace(/^(?:please\s+|could you\s+|can you\s+)+/iu, '');
  // “关于中秋节的祝福卡片” → “中秋节祝福卡片”. Other possessives remain intact.
  if (title.startsWith('关于')) title = title.slice(2).replace('的', '');
  title = (title.trim() || firstSentence).replace(/\s+/gu, ' ');
  const characters = Array.from(title);
  return characters.length > 32 ? `${characters.slice(0, 31).join('')}…` : title;
}
