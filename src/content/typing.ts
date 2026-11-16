import { TypingCadence, freshRandom, typingGraphemes, validateTyping, IDLE_TYPING, typingActive, type TypingField, type TypingOptions, type TypingStatus, type TypingControl } from '../shared/typing';
import { editingHost, isTextControl, readField, type Editable } from './textmap';
import { fieldSelection, restoreFieldSelection, type SelectionOffsets } from './auto-correct';
import { applyReplacement } from './apply';
import { markTypingField } from './typing-state';
import { isFreeText } from './field-policy';

function editable(el: Element): Editable | null {
  if (isTextControl(el)) return isFreeText(el) ? el : null;
  const host = editingHost(el);
  return host && isFreeText(host) ? host : null;
}
function label(el: Editable, index: number): string {
  const references = el.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
  const labels = isTextControl(el) ? [...el.labels ?? []].map((label) => label.textContent).join(' ') : '';
  return (el.getAttribute('aria-label') || references || labels || el.getAttribute('placeholder') || el.id || `Text field ${index + 1}`).replace(/\s+/g, ' ').trim().slice(0, 100);
}
interface Job {
  field: Editable; characters: string[]; expected: string; start: number; end: number;
  cadence: TypingCadence; options: TypingOptions;
}
// Native contenteditable insertion uses NBSP to keep a trailing/repeated space visible.
// It can turn that NBSP back into an ordinary space on the next character.
const richEquivalent = (actual: string, expected: string) => actual.replace(/\u00a0/g, ' ') === expected.replace(/\u00a0/g, ' ');
export class FieldTyper {
  private fields = new Map<string, Editable>();
  private ids = new WeakMap<Editable, string>();
  private selections = new WeakMap<Editable, { text: string; selection: SelectionOffsets }>();
  private job: Job | null = null;
  private status: TypingStatus = { ...IDLE_TYPING };
  private timer = 0;
  private lastReport = 0;
  private writing = false;
  private listening = false;
  constructor(private report: (status: TypingStatus) => void) {}
  private attach() {
    if (this.listening) return;
    this.listening = true;
    for (const event of ['selectionchange', 'select', 'focusin', 'mouseup', 'keyup']) document.addEventListener(event, this.remember, true);
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('focusin', this.onFocus, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
  }
  private remember = () => {
    const element = document.activeElement;
    const field = element && editable(element);
    if (!field || this.writing) return;
    const selection = fieldSelection(field);
    if (selection) this.selections.set(field, { text: readField(field).text, selection });
  };
  private onKey = (event: KeyboardEvent) => {
    if (!typingActive(this.status)) return;
    if (event.key === 'Escape') this.finish('stopped', 'Stopped with Escape.');
    else this.pause('Paused because you used the keyboard.');
  };
  private onFocus = () => {
    const focused = document.activeElement;
    if ((focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) && !isFreeText(focused)) { this.pause('Paused because focus moved to a protected field.'); return; }
    if (!this.writing && this.job && this.status.state === 'typing' && document.activeElement !== this.job.field && !this.job.field.contains(document.activeElement)) this.pause('Paused because focus moved to another field.');
  };
  private onVisibility = () => { if (document.hidden) this.pause('Paused because the target tab is hidden.'); };
  private onPageHide = () => { if (typingActive(this.status)) this.finish('stopped', 'Stopped because the page navigated away.'); };
  destroy() {
    this.finish('stopped', 'Typing stopped.');
    this.detach();
  }
  private detach() {
    if (!this.listening) return;
    this.listening = false;
    for (const event of ['selectionchange', 'select', 'focusin', 'mouseup', 'keyup']) document.removeEventListener(event, this.remember, true);
    document.removeEventListener('keydown', this.onKey, true); document.removeEventListener('focusin', this.onFocus, true);
    document.removeEventListener('visibilitychange', this.onVisibility); window.removeEventListener('pagehide', this.onPageHide);
  }
  fieldsOnPage(): TypingField[] {
    const out: TypingField[] = []; const seen = new Set<Editable>();
    this.fields.clear();
    for (const element of document.querySelectorAll('textarea,input,[contenteditable]')) {
      const field = editable(element);
      if (!field || seen.has(field) || !field.getClientRects().length || field.closest('[inert]')) continue;
      seen.add(field);
      let id = this.ids.get(field);
      if (!id) { id = crypto.randomUUID(); this.ids.set(field, id); }
      this.fields.set(id, field);
      out.push({ fieldId: id, label: label(field, out.length), kind: isTextControl(field) ? field.tagName === 'TEXTAREA' ? 'textarea' : 'input' : 'editor' });
      if (out.length >= 100) break;
    }
    this.remember(); return out;
  }
  locate(fieldId: string) {
    const field = this.fields.get(fieldId);
    if (!field?.isConnected || !editable(field)) throw new Error('This field is no longer available. Refresh the list.');
    field.scrollIntoView?.({ block: 'center' }); field.focus({ preventScroll: true });
    return true;
  }
  start(jobId: string, fieldId: string, text: string, options: TypingOptions): TypingStatus {
    validateTyping(text, options);
    if (typingActive(this.status)) throw new Error('Stop the current typing session first.');
    const field = this.fields.get(fieldId);
    if (!field?.isConnected || !editable(field) || !field.getClientRects().length) throw new Error('This field is unavailable. Refresh the list.');
    const expected = readField(field).text;
    const remembered = this.selections.get(field);
    const selected = options.position === 'caret' ? fieldSelection(field) ?? (remembered?.text === expected ? remembered.selection : null) : null;
    const start = selected?.start ?? expected.length;
    const end = selected?.end ?? start;
    const characters = typingGraphemes(text);
    if (isTextControl(field) && field.tagName === 'INPUT' && characters.some((c) => /[\r\n]/.test(c))) throw new Error('Choose a multiline field for text with line breaks.');
    if (isTextControl(field) && field.maxLength >= 0 && expected.length - (end - start) + characters.join('').length > field.maxLength) throw new Error('The text exceeds this field’s character limit.');
    this.job = { field, expected, start, end, characters, options, cadence: new TypingCadence(options) };
    this.attach();
    this.status = { jobId, state: 'typing', written: 0, total: characters.length, sequence: 0, message: 'Typing with varied pacing…' };
    markTypingField(field, true); this.prepareFocus(); this.emit(true);
    if (document.hidden) this.pause('The target tab is hidden. Resume after opening it.'); else this.schedule(250 + freshRandom() * 500);
    return { ...this.status };
  }
  private prepareFocus() {
    const job = this.job!;
    this.writing = true;
    try {
      job.field.focus({ preventScroll: true });
      if (!isTextControl(job.field) || job.field.selectionStart !== null) restoreFieldSelection(job.field, { start: job.start, end: job.end, backward: false });
    }
    finally { this.writing = false; }
  }
  control(jobId: string, action: TypingControl): TypingStatus {
    if (jobId !== this.status.jobId) throw new Error('This typing session has ended.');
    if (action === 'stop') this.finish('stopped', 'Stopped. Text already inserted stays in the field.');
    else if (action === 'pause') this.pause('Paused.');
    else if (action === 'resume' && this.status.state === 'paused' && this.job) {
      if (!this.valid()) return { ...this.status };
      if (document.hidden) throw new Error('Open the target tab before resuming.');
      this.status.state = 'typing'; this.status.message = 'Typing with varied pacing…';
      markTypingField(this.job.field, true); this.prepareFocus(); this.emit(true); this.schedule(200);
    }
    return { ...this.status };
  }
  private valid() {
    const job = this.job;
    if (!job || !job.field.isConnected || !editable(job.field)) { this.finish('error', 'The target field was removed or became read-only.'); return false; }
    if (readField(job.field).text !== job.expected) { this.finish('error', 'The field changed. Refresh and start a new session to avoid overwriting your edits.'); return false; }
    return true;
  }
  private schedule(delay: number) { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.tick(), delay); }
  private tick() {
    if (this.status.state !== 'typing' || !this.job || !this.valid()) return;
    const job = this.job;
    if (document.hidden || !job.field.getClientRects().length) { this.pause('Paused because the target is no longer visible.'); return; }
    if (document.activeElement !== job.field && !job.field.contains(document.activeElement)) { this.pause('Paused because focus changed.'); return; }
    const selection = fieldSelection(job.field);
    if (selection && (selection.start !== job.start || selection.end !== job.end)) { this.pause('Paused because the caret moved. Resume to continue at the saved position.'); return; }
    const character = job.characters[this.status.written];
    const expected = job.expected.slice(0, job.start) + character + job.expected.slice(job.end);
    if (isTextControl(job.field) && job.field.maxLength >= 0 && expected.length > job.field.maxLength) { this.finish('error', 'The field’s character limit changed.'); return; }
    this.writing = true;
    let changed = false;
    const equivalent = isTextControl(job.field) ? (actual: string, expected: string) => actual === expected
      : (actual: string, expected: string) => richEquivalent(actual, expected) || character === '\n' && richEquivalent(actual, expected + '\n');
    try { changed = applyReplacement(job.field, job.start, job.end, character, equivalent); }
    catch { /* a custom editor refused this insertion */ }
    finally { this.writing = false; }
    const actual = readField(job.field).text;
    if (!changed || !equivalent(actual, expected)) { this.finish('error', 'This editor changed or rejected the input. Typing stopped.'); return; }
    job.expected = actual; job.start = fieldSelection(job.field)?.start ?? job.start + character.length; job.end = job.start; this.status.written++;
    if (this.status.written === this.status.total) { this.finish('done', 'Finished.'); return; }
    this.emit(false); this.schedule(job.cadence.delay(character, job.characters[this.status.written]));
  }
  private pause(message: string) {
    if (this.status.state !== 'typing' || !this.job) return;
    window.clearTimeout(this.timer); markTypingField(this.job.field, false);
    this.status.state = 'paused'; this.status.message = message; this.emit(true);
  }
  private finish(state: 'done' | 'stopped' | 'error', message: string) {
    window.clearTimeout(this.timer);
    if (!this.job) return;
    markTypingField(this.job.field, false); this.job = null;
    this.detach();
    this.status.state = state; this.status.message = message; this.emit(true);
  }
  private emit(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastReport < 200) return;
    this.lastReport = now; this.status.sequence++;
    this.report({ ...this.status });
  }
  statusFor(jobId: string): TypingStatus | null { return this.status.jobId === jobId ? { ...this.status } : null; }
}
