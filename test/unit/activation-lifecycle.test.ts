import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../../src/shared/settings';
const mocks = vi.hoisted(() => ({ createEngines: vi.fn(), lint: vi.fn(async () => []), cacheSize: vi.fn(async () => 0) }));
vi.mock('../../src/background/engines', () => ({ createEngines: mocks.createEngines }));
vi.mock('../../src/background/model-cache', () => ({ cacheSize: mocks.cacheSize, clearCache: vi.fn() }));
let saved: Settings;
let updated: ((id: number, change: { status: string }, tab: { id: number; url: string }) => void)[];
let receive: (request: unknown, sender: object) => Promise<unknown> | undefined;
const tab = { id: 1, url: 'https://example.com/write' };
const executeScript = vi.fn(async () => []);
const unregister = vi.fn(async () => undefined);
const register = vi.fn(async () => ({ unregister }));
const openOptionsPage = vi.fn(async () => undefined);
beforeEach(() => {
  vi.resetModules(); saved = { ...DEFAULT_SETTINGS, enabledSites: ['example.com'] }; updated = [];
  executeScript.mockClear(); register.mockClear(); unregister.mockClear(); openOptionsPage.mockClear(); mocks.createEngines.mockReset(); mocks.lint.mockClear();
  mocks.createEngines.mockResolvedValue({ lint: { lint: mocks.lint } });
  vi.stubGlobal('browser', {
    storage: { local: { get: async () => ({ settings: saved }), set: async (items: { settings: Settings }) => { saved = items.settings; } } },
    tabs: { query: async () => [tab], executeScript, sendMessage: async () => undefined, onUpdated: { addListener: (callback: typeof updated[number]) => updated.push(callback) }, onRemoved: { addListener: vi.fn() } },
    browserAction: { setBadgeBackgroundColor: vi.fn(), setBadgeText: async () => undefined, setTitle: async () => undefined, onClicked: { addListener: vi.fn() } },
    runtime: { getURL: (name: string) => `moz-extension://test/${name}`, openOptionsPage, onMessage: { addListener: (callback: typeof receive) => { receive = callback; } } },
    menus: { removeAll: async () => undefined, create: vi.fn(), onClicked: { addListener: vi.fn() } }, commands: { onCommand: { addListener: vi.fn() } },
    contentScripts: { register },
  });
});
afterEach(() => vi.unstubAllGlobals());
async function boot() { await import('../../src/background/index'); for (let i = 0; i < 20; i++) await Promise.resolve(); }
describe('on-demand activation lifecycle', () => {
  it('cold startup and settings/model status do not inject, open tabs or load engines', async () => {
    await boot();
    expect(executeScript).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled(); expect(openOptionsPage).not.toHaveBeenCalled(); expect(mocks.createEngines).not.toHaveBeenCalled();
    expect(await receive({ type: 'get-settings' }, {})).toMatchObject({ ok: true, data: { activationMode: 'click' } });
    expect(await receive({ type: 'model-status' }, {})).toMatchObject({ ok: true, data: { gpt2: 'idle', t5: 'idle' } });
    expect(mocks.createEngines).not.toHaveBeenCalled();
    await receive({ type: 'open-settings' }, {}); expect(openOptionsPage).toHaveBeenCalledOnce(); expect(mocks.createEngines).not.toHaveBeenCalled();
  });
  it('injects on click, disables on the next click, and revokes approval at navigation', async () => {
    await boot(); const { toggleTab, activationFor } = await import('../../src/background/activation');
    expect((await toggleTab(tab)).active).toBe(true); expect(executeScript).toHaveBeenCalledWith(1, { file: 'content.js', allFrames: true, runAt: 'document_idle' });
    expect((await toggleTab(tab)).active).toBe(false); expect(executeScript).toHaveBeenCalledOnce();
    await toggleTab(tab); const count = executeScript.mock.calls.length;
    updated.forEach((callback) => callback(1, { status: 'loading' }, tab));
    expect((await activationFor(tab)).active).toBe(false);
    updated.forEach((callback) => callback(1, { status: 'complete' }, tab));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(executeScript).toHaveBeenCalledTimes(count); expect(mocks.createEngines).not.toHaveBeenCalled();
  });
  it('registers only listed sites in automatic mode, then unregisters when click-only is chosen', async () => {
    saved = { ...saved, activationMode: 'sites' }; await boot();
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ matches: ['*://*.example.com/*'] }));
    const { setSettings } = await import('../../src/background/settings'); await setSettings({ activationMode: 'click' });
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
    const { activationFor } = await import('../../src/background/activation'); expect((await activationFor(tab)).active).toBe(false);
  });
  it('loads the engine once only after an actual writing request', async () => {
    await boot(); await receive({ type: 'lint', text: 'Hello.' }, {}); await receive({ type: 'lint', text: 'Again.' }, {});
    expect(mocks.createEngines).toHaveBeenCalledOnce(); expect(mocks.lint).toHaveBeenCalledTimes(2);
  });
  it('migrates existing site lists without overriding an explicit click-only choice', () => {
    expect(normalizeSettings({ enabledSites: ['example.com'] }).activationMode).toBe('sites');
    expect(normalizeSettings({ enabledSites: ['example.com'], activationMode: 'click' }).activationMode).toBe('click');
  });
});
