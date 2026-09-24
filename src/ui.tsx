import {policyLabel, priorityLabel, profileLabel, selectionLabel} from './labels.js';
import React, {useEffect, useState} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import TextInput from 'ink-text-input';
import {stripVTControlCharacters} from 'node:util';
import {z} from 'zod';
import {type Config, type Language, type Model, type Task, errorMessage} from './domain.js';
import {type Governor} from './governor.js';
import {type ServerRequest} from './rpc.js';
import {openNative, type NativeTarget} from './native.js';

export function safeText(value: string): string {
  // Render external text literally: strip terminal controls, including OSC hyperlinks.
  // eslint-disable-next-line no-control-regex -- Deliberately remove unsafe terminal controls.
  return stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}
const tr = (lang: Language, en: string, zh: string) => lang === 'zh-CN' ? zh : en;

function Choices({title, values, initial = 0, onSelect}: {title: string; values: {label: string; value: string}[]; initial?: number; onSelect: (value: string) => void}) {
  const [index, setIndex] = useState(Math.max(0, initial));
  const {stdout} = useStdout();
  const count = Math.max(2, (stdout.rows || 24) - 10);
  const start = Math.max(0, index - count + 1);
  useInput((_input, key) => {
    if (key.upArrow) setIndex(i => (i - 1 + values.length) % values.length);
    if (key.downArrow) setIndex(i => (i + 1) % values.length);
    if (key.return && values[index]) onSelect(values[index]!.value);
  });
  return <Box flexDirection="column"><Text bold>{title}</Text>{values.slice(start, start + count).map((item, offset) => <Text key={item.value} color={start + offset === index ? 'cyan' : undefined}>{start + offset === index ? '› ' : '  '}{safeText(item.label)}</Text>)}<Text dimColor>↑ ↓  Enter</Text></Box>;
}

export function ConfigWizard({models, initial, language = 'en', onSave, onCancel}: {models: Model[]; initial?: Config; language?: Language; onSave: (config: Config) => Promise<void>; onCancel?: () => void}) {
  const fallback = models.find(m => m.isDefault) ?? models[0]!;
  const [draft, setDraft] = useState<Config>(initial ?? {version: 2, language, primary: {model: fallback.model, effort: fallback.defaultReasoningEffort}, economy: {model: fallback.model, effort: fallback.defaultReasoningEffort}, policy: 'balanced'});
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lang = draft.language;
  useInput((_input, key) => {if (key.escape && !busy) {if (step > 0) setStep(step - 1); else onCancel?.();}});
  const stages = [tr(lang, 'Language', '语言'), tr(lang, 'Model Profile: Primary — Model', '执行配置：主力配置 — 模型'), tr(lang, 'Primary — Reasoning Effort', '主力配置 — 思考强度'), tr(lang, 'Model Profile: Economy — Model (choose your preferred economical model)', '执行配置：节省配置 — 模型（由你选择）'), tr(lang, 'Economy — Reasoning Effort', '节省配置 — 思考强度'), tr(lang, 'Quota Policy', '额度策略')];
  const values = step === 0 ? [{label: 'English', value: 'en'}, {label: '简体中文', value: 'zh-CN'}] : step === 1 || step === 3 ? models.map(m => ({label: `${m.displayName} (${m.model})`, value: m.model})) : step === 5 ? (['quality-first', 'balanced', 'save-quota'] as const).map(value => ({value, label: policyLabel(value, lang)})) : (models.find(m => m.model === (step === 2 ? draft.primary.model : draft.economy.model)) ?? fallback).supportedReasoningEfforts.map(e => ({label: e.reasoningEffort, value: e.reasoningEffort}));
  const current = [lang, draft.primary.model, draft.primary.effort, draft.economy.model, draft.economy.effort, draft.policy][step];
  async function choose(value: string) {
    const next = structuredClone(draft);
    if (step === 0) next.language = value as Language;
    if (step === 1 || step === 3) {const model = models.find(m => m.model === value)!; next[step === 1 ? 'primary' : 'economy'] = {model: model.model, effort: model.defaultReasoningEffort};}
    if (step === 2 || step === 4) next[step === 2 ? 'primary' : 'economy'].effort = value;
    if (step === 5) next.policy = value as Config['policy'];
    setDraft(next); setError('');
    if (step < 5) {setStep(step + 1); return;}
    setBusy(true);
    try {await onSave(next);} catch (e) {setError(errorMessage(e));} finally {setBusy(false);}
  }
  return <Box flexDirection="column" padding={1}><Text bold color="cyan">CODEX RESOURCE GOVERNOR</Text><Text>{tr(lang, 'Configuration', '配置')} · {step + 1}/6</Text><Text> </Text>{busy ? <Text>{tr(lang, 'Saving…', '保存中…')}</Text> : <Choices key={step} title={stages[step]!} values={values} initial={values.findIndex(v => v.value === current)} onSelect={value => {void choose(value);}} />}<Text color="red">{safeText(error)}</Text><Text dimColor>{tr(lang, 'Esc back / cancel', 'Esc 返回 / 取消')}</Text></Box>;
}

export function TaskRow({task, next, selected, lang}: {task: Task; next: {model: string; effort: string} | null; selected: boolean; lang: Language}) {
  return <Box flexDirection="column"><Text color={selected ? 'cyan' : undefined} wrap="truncate">{selected ? '›' : ' '} {safeText(task.name)}  {tr(lang, 'Task Priority', '任务优先级')}: {priorityLabel(task.priority, lang)} · {task.mode} · {task.status} · {task.id.slice(0, 8)}</Text><Text wrap="truncate">  {tr(lang, 'Current', '当前')}: {safeText(selectionLabel(task.current, lang))} ({task.currentMode ?? 'unknown'})</Text><Text wrap="truncate">  {tr(lang, 'Next turn', '下一轮')}: {task.mode === 'off' ? tr(lang, 'Native client controls; history may be stale', '原生客户端决定；历史配置可能已过期') : safeText(selectionLabel(next, lang))}</Text></Box>;
}
function TextEntry({title, onSubmit, onCancel}: {title: string; onSubmit: (value: string) => void; onCancel: () => void}) {
  const [value, setValue] = useState('');
  useInput((_input, key) => {if (key.escape) onCancel();});
  return <Box flexDirection="column"><Text bold>{title}</Text><Box><Text color="cyan">› </Text><TextInput value={value} onChange={setValue} onSubmit={value => {if (value.trim()) onSubmit(value);}} /></Box><Text dimColor>Enter · Esc</Text></Box>;
}

function RequestView({request, governor}: {request: ServerRequest; governor: Governor}) {
  const [offset, setOffset] = useState(0);
  const lang = governor.config.language;
  const {stdout} = useStdout();
  const height = Math.max(2, (stdout.rows || 24) - 9);
  const width = Math.max(20, (stdout.columns || 80) - 6);
  const text = safeText(JSON.stringify(governor.requestDetails(request), null, 2));
  const lines = text.split('\n').flatMap(line => Array.from({length: Math.max(1, Math.ceil(line.length / width))}, (_, i) => line.slice(i * width, (i + 1) * width)));
  const questions = z.object({questions: z.array(z.object({id: z.string(), question: z.string(), options: z.array(z.object({label: z.string()})).nullish()}))}).safeParse(request.params);
  const [answers, setAnswers] = useState<Record<string, {answers: string[]}>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const isQuestion = request.method === 'item/tool/requestUserInput';
  useInput((input, key) => {
    if (isQuestion && questions.success && questions.data.questions[questionIndex]) return;
    if (key.downArrow || key.pageDown) setOffset(o => Math.min(Math.max(0, lines.length - height), o + (key.pageDown ? height : 1)));
    if (key.upArrow || key.pageUp) setOffset(o => Math.max(0, o - (key.pageUp ? height : 1)));
    if (input.toLowerCase() === 'a') governor.answerRequest(request, true);
    if (input.toLowerCase() === 'd' || key.escape) governor.answerRequest(request, false);
  });
  if (isQuestion && questions.success && questions.data.questions[questionIndex]) {
    const question = questions.data.questions[questionIndex]!;
    return <TextEntry key={question.id} title={safeText(`${question.question}\n${question.options?.map(o => o.label).join(' / ') ?? ''}`)} onCancel={() => governor.answerRequest(request, false)} onSubmit={value => {
      const next = {...answers, [question.id]: {answers: [value]}};
      if (questionIndex + 1 === questions.data.questions.length) governor.answerRequest(request, next);
      else {setAnswers(next); setQuestionIndex(questionIndex + 1);}
    }} />;
  }
  return <Box flexDirection="column"><Text bold color="yellow">{tr(lang, 'Codex requests approval', 'Codex 请求审批')}</Text><Text>{request.method}</Text><Text>{lines.slice(offset, offset + height).join('\n')}</Text><Text dimColor>{offset + 1}–{Math.min(lines.length, offset + height)} / {lines.length} · ↑ ↓ PgUp PgDn</Text><Text>{tr(lang, 'A Allow once   D Deny   Esc Deny', 'A 允许一次   D 拒绝   Esc 拒绝')}</Text></Box>;
}

export function App({governor, initialTask}: {governor: Governor; initialTask?: string}) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const [, redraw] = useState(0);
  const [index, setIndex] = useState(Math.max(0, governor.tasks.findIndex(t => t.id === initialTask)));
  const [screen, setScreen] = useState<'list' | 'detail' | 'explain' | 'config' | 'new' | 'prompt' | 'priority' | 'mode' | 'manual-model' | 'manual-effort' | 'delete' | 'open'>(initialTask ? 'detail' : 'list');
  const [manualModel, setManualModel] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [scroll, setScroll] = useState(0);
  useEffect(() => {
    const changed = () => redraw(n => n + 1); const notify = (message: string) => setNotice(message);
    governor.on('change', changed); governor.on('notice', notify);
    const resized = () => redraw(n => n + 1); stdout.on('resize', resized);
    return () => {governor.off('change', changed); governor.off('notice', notify); stdout.off('resize', resized);};
  }, [governor, stdout]);
  const lang = governor.config.language;
  const task = governor.tasks[Math.min(index, Math.max(0, governor.tasks.length - 1))];
  const request = governor.requests[0];
  async function action(work: () => Promise<void>) {setBusy(true); setNotice(''); try {await work();} catch (e) {setNotice(errorMessage(e));} finally {setBusy(false);}}
  const modal = ['config', 'new', 'prompt', 'priority', 'mode', 'manual-model', 'manual-effort', 'delete', 'open'].includes(screen);
  useInput((input, key) => {
    if (request || busy || modal) return;
    const char = input.toLowerCase();
    if (char === 'q') {exit(); return;}
    if (key.escape) {setScreen('list'); setScroll(0); return;}
    if (screen === 'list' && key.upArrow) setIndex(i => Math.max(0, i - 1));
    if (screen === 'list' && key.downArrow) setIndex(i => Math.min(governor.tasks.length - 1, i + 1));
    if (screen !== 'list' && key.upArrow) setScroll(i => Math.max(0, i - 1));
    if (screen !== 'list' && key.downArrow) setScroll(i => i + 1);
    if (char === 'c') setScreen('config');
    if (char === 'n') setScreen('new');
    if (char === 'r') void action(() => governor.refresh());
    if (!task) return;
    if (char === 'p') setScreen('priority');
    if (char === 'm') setScreen('mode');
    if (char === 'e') {setScroll(0); setScreen('explain');}
    if (char === 'i') void action(() => governor.interrupt(task.id));
    if (char === 'd') setScreen('delete');
    if (char === 'o') setScreen('open');
    if (key.return) {setScroll(0); setScreen(screen === 'list' ? 'detail' : 'prompt');}
  });
  useInput((_input, key) => {if (!request && !busy && key.escape && ['priority', 'mode', 'manual-model', 'manual-effort', 'delete', 'open'].includes(screen)) setScreen('list');});
  if (request) return <Box padding={1}><RequestView key={request.id} request={request} governor={governor} /></Box>;
  if (screen === 'config') return <ConfigWizard models={governor.models} initial={governor.config} onCancel={() => setScreen('list')} onSave={async config => {await governor.setConfig(config); setScreen('list');}} />;
  if (screen === 'new') return <Box flexDirection="column" padding={1}><TextEntry title={tr(lang, 'New task name (Task Priority: Medium; current directory)', '新任务名称（任务优先级：中，使用当前目录）')} onCancel={() => setScreen('list')} onSubmit={name => {if (busy) return; void action(async () => {const created = await governor.createTask(name); setIndex(governor.tasks.findIndex(t => t.id === created.id)); setScreen('detail');});}} /><Text color="red">{safeText(notice)}</Text>{busy && <Text>{tr(lang, 'Creating…', '创建中…')}</Text>}</Box>;
  if (screen === 'prompt' && task) return <Box flexDirection="column" padding={1}><TextEntry title={tr(lang, `Prompt for ${safeText(task.name)}`, `任务输入：${safeText(task.name)}`)} onCancel={() => setScreen('detail')} onSubmit={prompt => {if (busy) return; void action(async () => {await governor.startTurn(task.id, prompt); setScreen('detail');});}} /><Text color="red">{safeText(notice)}</Text>{busy && <Text>{tr(lang, 'Starting…', '启动中…')}</Text>}</Box>;
  if (screen === 'priority' && task) return <Choices title={tr(lang, 'Task Priority', '任务优先级')} values={(['high', 'medium', 'low'] as const).map(value => ({value, label: priorityLabel(value, lang)}))} onSelect={value => {void action(async () => {await governor.setPriority(task.id, value as Task['priority']); setScreen('list');});}} />;
  if (screen === 'mode' && task) return <Box flexDirection="column"><Choices title={tr(lang, 'Mode (future turns)', '模式（后续轮次生效）')} values={[{value: 'auto', label: tr(lang, 'Auto — Governor selects', 'Auto 自动选模')}, {value: 'manual', label: tr(lang, 'Manual — explicit model + effort', 'Manual 手动固定模型和思考强度')}, {value: 'off', label: tr(lang, 'Off — native client controls', 'Off 原生客户端控制')}, {value: 'keep', label: tr(lang, 'Keep — legacy Primary profile', 'Keep 兼容模式：使用主力配置')}]} onSelect={value => {if (busy) return; if (value === 'manual') {setScreen('manual-model'); return;} void action(async () => {await governor.setMode(task.id, value as Task['mode']); setScreen('list');});}} /><Text color="red">{safeText(notice)}</Text></Box>;
  if (screen === 'manual-model' && task) return <Choices key="manual-model" title={tr(lang, 'Fixed model', '固定模型')} values={governor.models.map(model => ({value: model.model, label: model.displayName}))} onSelect={value => {setManualModel(value); setScreen('manual-effort');}} />;
  if (screen === 'manual-effort' && task) return <Box flexDirection="column"><Choices key={manualModel} title={tr(lang, 'Fixed Reasoning Effort (until mode is changed)', '固定思考强度（直到主动切换模式）')} values={(governor.models.find(model => model.model === manualModel)?.supportedReasoningEfforts ?? []).map(effort => ({value: effort.reasoningEffort, label: effort.reasoningEffort}))} onSelect={value => {if (busy) return; void action(async () => {await governor.setMode(task.id, 'manual', {model: manualModel, effort: value}); setScreen('list');});}} /><Text color="red">{safeText(notice)}</Text></Box>;
  if (screen === 'open' && task) return <Box flexDirection="column" padding={1}><Choices title={tr(lang, 'Open in Codex (after completion)', '在 Codex 中打开（任务完成后）')} values={[{value: 'vscode', label: 'VS Code'}, {value: 'app', label: 'Codex App'}, {value: 'both', label: tr(lang, 'Both', '两者')}]} onSelect={value => {if (busy) return; void action(async () => {await openNative(task, value as NativeTarget); setScreen('list');});}} /><Text>{tr(lang, 'IDE governance requires the proxy. App messages use App settings.', 'IDE 选模管理需配置代理；App 中的新消息使用 App 自身设置。')}</Text><Text color="red">{safeText(notice)}</Text></Box>;
  if (screen === 'delete' && task) return <Box flexDirection="column" padding={1}><Choices title={tr(lang, `Delete local task record “${safeText(task.name)}”? An active turn will be interrupted first.`, `删除本地任务记录“${safeText(task.name)}”？运行中的任务会先被中断。`)} values={[{value: 'cancel', label: tr(lang, 'Cancel', '取消')}, {value: 'delete', label: tr(lang, 'Delete record', '删除记录')}]} onSelect={value => {if (value === 'cancel') {setScreen('list'); return;} void action(async () => {await governor.deleteTask(task.id); setIndex(i => Math.max(0, Math.min(i, governor.tasks.length - 1))); setScreen('list');});}} /><Text color="red">{safeText(notice)}</Text></Box>;
  const pageSize = Math.max(1, Math.floor(((stdout.rows || 24) - 12) / 4));
  const start = Math.floor(Math.max(0, index) / pageSize) * pageSize;
  const stageLabels = [profileLabel('primary', lang), `${profileLabel('primary', lang)} · ${tr(lang, 'Reasoning Effort reduced', '思考强度降低')}`, profileLabel('economy', lang)];
  const body = task && screen !== 'list' ? (screen === 'explain' ? governor.explain(task.id) : `${task.cwd}\nCodex: ${task.threadId}\n${task.error ?? ''}\n${governor.taskOutput(task) || tr(lang, 'Press Enter to send a prompt.', '按 Enter 输入任务。')}`) : '';
  const contentHeight = Math.max(1, (stdout.rows || 24) - 14);
  const width = Math.max(20, (stdout.columns || 80) - 4);
  const bodyLines = safeText(body).split('\n').flatMap(line => Array.from({length: Math.max(1, Math.ceil([...line].length / Math.max(10, Math.floor(width / 2)) ))}, (_, i) => [...line].slice(i * Math.floor(width / 2), (i + 1) * Math.floor(width / 2)).join('')));
  const offset = Math.min(scroll, Math.max(0, bodyLines.length - contentHeight));
  return <Box flexDirection="column" paddingX={1}>
    <Text bold color="cyan">CODEX RESOURCE GOVERNOR</Text><Text>{tr(lang, 'Quota Policy', '额度策略')}: {policyLabel(governor.config.policy, lang)} {busy ? '…' : ''}</Text>
    <Text>5h      {governor.quota.fiveHour ? `${governor.quota.fiveHour.remaining}%` : '—'} {tr(lang, 'remaining', '剩余')}</Text>
    <Text>Weekly  {governor.quota.weekly ? `${governor.quota.weekly.remaining}%` : '—'} {tr(lang, 'remaining', '剩余')}</Text>
    <Text> </Text>
    {screen === 'list' ? <><Text bold>{tr(lang, 'TASKS', '任务')} ({governor.tasks.length})</Text>{governor.tasks.slice(start, start + pageSize).map(t => {const next = governor.decision(t); return <Box key={t.id} flexDirection="column"><TaskRow task={t} next={next.next} selected={task?.id === t.id} lang={lang} /><Text dimColor>  {t.mode === 'manual' ? tr(lang, 'FIXED until changed', '手动固定，直到主动修改') : t.mode === 'off' ? tr(lang, 'NATIVE CONTROL', '原生控制') : `${tr(lang, 'Model Profile', '执行配置')}: ${stageLabels[next.stage === 1 && next.next?.effort === governor.config.primary.effort ? 0 : next.stage]}`}</Text></Box>;})}{!task && <Text dimColor>{tr(lang, 'N creates your first managed task.', '按 N 创建第一个受管理任务。')}</Text>}</> : task ? <><TaskRow task={task} next={governor.decision(task).next} selected lang={lang} /><Text>{bodyLines.slice(offset, offset + contentHeight).join('\n')}</Text><Text dimColor>↑ ↓ · {offset + 1}/{bodyLines.length}</Text></> : null}
    <Text color={governor.connectionError ? 'red' : 'yellow'} wrap="truncate">{safeText(governor.connectionError || notice || (governor.quotaError ? tr(lang, 'Quota unavailable; existing holds retained.', '额度不可用，保留已有降档。') : ' '))}</Text>
    <Text dimColor>{tr(lang, 'Enter Details/Prompt   P Task Priority   M Mode   O Open Codex', 'Enter 详情/输入   P 任务优先级   M 模式   O 打开 Codex')}</Text>
    <Text dimColor>{tr(lang, 'E Explain  C Config  N New  R Refresh  I Interrupt  D Delete  Q Quit', 'E 解释  C 配置  N 新建  R 刷新  I 中断  D 删除  Q 退出')}</Text>
  </Box>;
}
