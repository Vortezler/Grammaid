// Decides where Grammaid scans. It is off by default and runs in a tab only when
//   (a) automatic-site mode is selected and the site is listed, or
//   (b) the user clicked the toolbar button on this page (revoked at navigation).
// The toolbar badge shows "on" wherever it is running.
import type { Activation, ContentRequest } from '../shared/types';
import { hostOf, isSiteEnabled, type Settings } from '../shared/settings';
import { getSettings, onSettingsChanged } from './settings';
import { ensureContent } from './injection';

type TabLike = { id?: number; url?: string };

/** Pure decision, kept separate so it can be unit-tested. */
export function decide(settings: Settings, url: string | undefined, tabOn: boolean): Activation {
  const host = hostOf(url);
  const site = settings.activationMode === 'sites' && isSiteEnabled(settings, host);
  return { active: settings.enabled && (site || tabOn), site, tab: tabOn, host };
}

const activeTabs = new Set<number>();

export async function activationFor(tab: TabLike | undefined): Promise<Activation> {
  const settings = await getSettings();
  return decide(settings, tab?.url, tab?.id !== undefined && activeTabs.has(tab.id));
}

async function paintBadge(tab: TabLike, activation: Activation): Promise<void> {
  if (tab.id === undefined) return;
  try {
    await browser.browserAction.setBadgeText({ text: activation.active ? 'on' : '', tabId: tab.id });
    await browser.browserAction.setTitle({
      tabId: tab.id,
      title: activation.active
        ? activation.site
          ? `Grammaid is on for ${activation.host}`
          : 'Grammaid is on in this tab. Click to turn it off.'
        : 'Grammaid is off here. Click to check this tab.',
    });
  } catch {
    // the tab went away
  }
}

async function notify(tab: TabLike, announce: boolean): Promise<Activation> {
  const activation = await activationFor(tab);
  await paintBadge(tab, activation);
  if (tab.id !== undefined) {
    const message: ContentRequest = { type: 'activation-changed', activation, announce };
    // Reaches every frame of the tab; pages without a content script (about:, AMO) just reject.
    try {
      if (activation.active) await ensureContent(tab.id);
      await browser.tabs.sendMessage(tab.id, message);
    } catch { /* protected pages cannot be injected */ }
  }
  return activation;
}

/** A manual approval is scoped to this page and is cleared by navigation. */
export async function toggleTab(tab: TabLike | undefined): Promise<Activation> {
  if (!tab || tab.id === undefined) return activationFor(tab);
  if (activeTabs.has(tab.id)) activeTabs.delete(tab.id);
  else activeTabs.add(tab.id);
  return notify(tab, true);
}

export async function activeTab(): Promise<TabLike | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export function registerActivation(): void {
  try {
    void browser.browserAction.setBadgeBackgroundColor({ color: '#0f9d8a' });
  } catch {
    // cosmetic
  }
  browser.tabs.onRemoved.addListener((tabId) => {
    activeTabs.delete(tabId);
  });
  // No all-page content script registration. Automatic injection is scoped to listed sites.
  let registration: browser.contentScripts.RegisteredContentScript | null = null;
  let sync = Promise.resolve();
  const synchronize = (settings: Settings) => {
    sync = sync.catch(() => undefined).then(async () => {
      await registration?.unregister(); registration = null;
      if (settings.enabled && settings.activationMode === 'sites' && settings.enabledSites.length) {
        registration = await browser.contentScripts.register({ matches: settings.enabledSites.map((site) => `*://*.${site}/*`), allFrames: true, runAt: 'document_idle', js: [{ file: 'content.js' }] });
      }
      const tabs = await browser.tabs.query({});
      for (const tab of tabs) await notify(tab, false);
    }).catch((error) => console.warn('Grammaid: activation update failed', error));
    return sync;
  };
  void getSettings().then(synchronize);
  browser.tabs.onUpdated.addListener((_id, change, tab) => {
    if (change.status === 'loading') { activeTabs.delete(_id); void notify(tab, false); }
    if (change.status === 'complete') void notify(tab, false);
  });
  // A change to the site list (or the master switch) takes effect in open tabs at once.
  onSettingsChanged((next, previous) => {
    if (!next.enabled || next.activationMode !== previous.activationMode) activeTabs.clear();
    void synchronize(next);
  });
}
