// Context-menu entries, keyboard commands and the toolbar button.
import type { ContentRequest } from '../shared/types';
import { toggleTab } from './activation';
import { ensureContent } from './injection';

type Action = 'synonyms' | 'rephrase';

async function runInTab(tabId: number, action: Action, frameId?: number): Promise<void> {
  const message: ContentRequest = { type: 'run-action', action };
  try {
    await ensureContent(tabId);
    await browser.tabs.sendMessage(tabId, message, frameId === undefined ? {} : { frameId });
  } catch {
    // No content script on this page (about:, addons.mozilla.org, ...): nothing to do.
  }
}

export function registerMenus(): void {
  browser.menus.removeAll().then(() => {
    browser.menus.create({ id: 'grammaid-synonyms', title: 'Grammaid: Synonyms', contexts: ['selection'] });
    browser.menus.create({ id: 'grammaid-rephrase', title: 'Grammaid: Rephrase', contexts: ['selection'] });
    browser.menus.create({ id: 'grammaid-settings', title: 'Grammaid settings', contexts: ['browser_action'] });
  });

  browser.menus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'grammaid-settings') { void browser.runtime.openOptionsPage(); return; }
    if (tab?.id === undefined) return;
    if (info.menuItemId === 'grammaid-synonyms') void runInTab(tab.id, 'synonyms', info.frameId);
    if (info.menuItemId === 'grammaid-rephrase') void runInTab(tab.id, 'rephrase', info.frameId);
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === 'open-settings') { void browser.runtime.openOptionsPage(); return; }
    if (command === 'toggle-sidebar') {
      // Must be called synchronously inside the user-input handler.
      void browser.sidebarAction.toggle();
      return;
    }
    if (command !== 'synonyms' && command !== 'rephrase') return;
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      // Sent to every frame; only the frame holding the selection acts on it.
      if (tab?.id !== undefined) void runInTab(tab.id, command);
    });
  });

  // The toolbar button switches Grammaid on (or off) for the tab it was clicked in.
  browser.browserAction.onClicked.addListener((tab) => {
    void toggleTab(tab);
  });
}
