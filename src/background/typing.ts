import { IDLE_TYPING, typingActive, validateTyping, type TypingControl, type TypingField, type TypingOptions, type TypingStatus, type TypingTab, type TypingTarget } from '../shared/typing';
import type { ContentRequest } from '../shared/types';
import { ensureContent } from './injection';
export interface TypingSender { tab?: { id?: number }; frameId?: number }
interface Discovery { tabId: number; results: TypingTarget[]; finish: () => void }
export class TypingCoordinator {
  private current: TypingStatus = { ...IDLE_TYPING };
  private discoveries = new Map<string, Discovery>();
  private targets = new Map<string, TypingTarget>();
  private key(target: Pick<TypingTarget, 'tabId' | 'frameId' | 'fieldId'>) { return `${target.tabId}:${target.frameId}:${target.fieldId}`; }
  async tabs(): Promise<TypingTab[]> {
    const tabs = await browser.tabs.query({});
    return tabs.filter((tab) => tab.id !== undefined && /^(https?|file):/i.test(tab.url ?? '')).map((tab) => ({
      tabId: tab.id!, title: tab.title ?? 'Untitled tab', host: new URL(tab.url!).hostname || 'Local file', active: !!tab.active,
    }));
  }
  async discover(tabId: number): Promise<TypingTarget[]> {
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Choose a browser tab.');
    await ensureContent(tabId);
    const nonce = crypto.randomUUID();
    for (const [key, target] of this.targets) if (target.tabId === tabId) this.targets.delete(key);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(), 500);
      const finish = () => {
        clearTimeout(timer);
        const discovery = this.discoveries.get(nonce);
        if (!discovery) return;
        this.discoveries.delete(nonce);
        for (const target of discovery.results) this.targets.set(this.key(target), target);
        resolve(discovery.results);
      };
      this.discoveries.set(nonce, { tabId, results: [], finish });
      const request: ContentRequest = { type: 'typing-discover', nonce };
      void browser.tabs.sendMessage(tabId, request).catch(finish);
    });
  }
  reportTargets(nonce: string, fields: TypingField[], frame: string, sender: TypingSender) {
    const discovery = this.discoveries.get(nonce);
    if (!discovery || sender.tab?.id !== discovery.tabId || !Number.isInteger(sender.frameId) || !Array.isArray(fields)) return;
    for (const field of fields.slice(0, 100)) {
      if (!field || typeof field.fieldId !== 'string' || typeof field.label !== 'string' || !['input', 'textarea', 'editor'].includes(field.kind)) continue;
      const target: TypingTarget = { fieldId: field.fieldId, label: field.label.slice(0, 100), kind: field.kind, tabId: discovery.tabId, frameId: sender.frameId!, frame: typeof frame === 'string' ? frame.slice(0, 100) : 'Page' };
      if (!discovery.results.some((other) => this.key(other) === this.key(target))) discovery.results.push(target);
      if (discovery.results.length >= 300) break;
    }
  }
  private async inTarget(target: TypingTarget, request: ContentRequest) {
    return browser.tabs.sendMessage(target.tabId, request, { frameId: target.frameId });
  }
  async locate(target: TypingTarget) {
    const known = this.targets.get(this.key(target));
    if (!known) throw new Error('Refresh the field list and choose a target.');
    await browser.tabs.update(known.tabId, { active: true });
    if (!await this.inTarget(known, { type: 'typing-locate', fieldId: known.fieldId })) throw new Error('The field is no longer available. Refresh the list.');
  }
  async start(target: TypingTarget, text: string, options: TypingOptions): Promise<TypingStatus> {
    validateTyping(text, options);
    if (typingActive(this.current)) throw new Error('Stop the current typing session first.');
    const known = this.targets.get(this.key(target));
    if (!known) throw new Error('Refresh the field list and choose a target.');
    const jobId = crypto.randomUUID();
    this.current = { ...IDLE_TYPING, jobId, state: 'starting', target: known, message: 'Opening the target field…' };
    try {
      await browser.tabs.update(known.tabId, { active: true });
      if (this.current.jobId !== jobId || this.current.state !== 'starting') return { ...this.current };
      const reply = await this.inTarget(known, { type: 'typing-start-in-field', jobId, fieldId: known.fieldId, text, options }) as TypingStatus | undefined;
      if (this.current.jobId !== jobId || (this.current as TypingStatus).state === 'stopped') {
        await this.inTarget(known, { type: 'typing-control-in-field', jobId, action: 'stop' }).catch(() => undefined);
        return { ...this.current };
      }
      if (!reply || reply.jobId !== jobId) throw new Error('The target page did not respond. Refresh the field list.');
      this.update(reply, { tab: { id: known.tabId }, frameId: known.frameId });
    } catch (error) {
      if (this.current.jobId === jobId) this.current = { ...this.current, state: 'error', message: error instanceof Error ? error.message : String(error) };
    }
    return { ...this.current };
  }
  update(status: TypingStatus, sender: TypingSender) {
    const target = this.current.target;
    if (!status || !target || !typingActive(this.current) || status.jobId !== this.current.jobId || sender.tab?.id !== target.tabId || sender.frameId !== target.frameId || status.sequence <= this.current.sequence) return;
    if (!['typing', 'paused', 'done', 'stopped', 'error'].includes(status.state)) return;
    this.current = { ...status, target };
  }
  async status(): Promise<TypingStatus> {
    const current = this.current;
    if ((current.state === 'typing' || current.state === 'paused') && current.target) {
      try {
        const reply = await this.inTarget(current.target, { type: 'typing-get-state', jobId: current.jobId }) as TypingStatus | null;
        if (this.current.jobId !== current.jobId) return { ...this.current };
        if (!reply || reply.jobId !== current.jobId) this.current = { ...current, state: 'stopped', message: 'The target page has changed. Refresh and start again.' };
        else this.update(reply, { tab: { id: current.target.tabId }, frameId: current.target.frameId });
      } catch { if (this.current.jobId === current.jobId) this.current = { ...current, state: 'stopped', message: 'The target tab or frame is no longer available.' }; }
    }
    return { ...this.current };
  }
  async control(action: TypingControl): Promise<TypingStatus> {
    if (!['pause', 'resume', 'stop'].includes(action)) throw new Error('Unknown typing action.');
    const current = this.current;
    if (!typingActive(current) || !current.target) return { ...current };
    if (current.state === 'starting') { this.current = { ...current, state: 'stopped', message: 'Start cancelled.' }; return { ...this.current }; }
    try {
      if (action === 'resume') await browser.tabs.update(current.target.tabId, { active: true });
      const reply = await this.inTarget(current.target, { type: 'typing-control-in-field', jobId: current.jobId, action }) as TypingStatus | undefined;
      if (!reply || reply.jobId !== current.jobId) throw new Error('The target page is no longer available.');
      this.update(reply, { tab: { id: current.target.tabId }, frameId: current.target.frameId });
    } catch (error) {
      // Retain ownership if a transient failure prevents a command. Polling confirms
      // navigation separately; the user can retry Stop without losing the session.
      throw new Error(error instanceof Error ? error.message : String(error));
    }
    return { ...this.current };
  }
  register() {
    browser.tabs.onRemoved.addListener((tabId) => this.tabEnded(tabId));
    browser.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading') this.tabEnded(tabId); });
  }
  private tabEnded(tabId: number) {
    for (const [key, target] of this.targets) if (target.tabId === tabId) this.targets.delete(key);
    if (typingActive(this.current) && this.current.target?.tabId === tabId) this.current = { ...this.current, state: 'stopped', message: 'The target tab closed or navigated. Typing stopped.' };
  }
}
