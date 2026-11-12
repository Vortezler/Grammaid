// Content script entry. Holds no engines: it finds editable fields, asks the background page
// for lints, and draws. Everything is wrapped so a failure here can never break the host page.
import { send, type ContentRequest, type PageText } from '../shared/types';
import { DEFAULT_SETTINGS, isSiteDisabled, normalizeSettings, type Settings } from '../shared/settings';
import { FieldWatcher } from './field-watcher';
import { Overlay } from './overlay';
import { SelectionActions } from './selection-actions';

declare global {
  interface Window {
    __grammaidLoaded?: boolean;
  }
}

function main() {
  if (window.__grammaidLoaded) return;
  window.__grammaidLoaded = true;

  let settings: Settings = DEFAULT_SETTINGS;
  let overlay: Overlay | null = null;
  let watcher: FieldWatcher | null = null;
  let actions: SelectionActions | null = null;

  const enabledHere = () => settings.enabled && !isSiteDisabled(settings, location.hostname);

  const startUp = () => {
    if (overlay) return;
    overlay = new Overlay();
    watcher = new FieldWatcher(overlay, settings);
    actions = new SelectionActions(overlay, enabledHere);
    watcher.start();
    actions.start();
  };

  const shutDown = () => {
    watcher?.stop();
    actions?.stop();
    overlay?.destroy();
    overlay = null;
    watcher = null;
    actions = null;
  };

  const applySettings = (next: Settings) => {
    settings = next;
    if (enabledHere()) {
      startUp();
      watcher?.updateSettings(next);
    } else {
      shutDown();
    }
  };

  void send({ type: 'get-settings' }).then((res) => applySettings(res.ok ? res.data : DEFAULT_SETTINGS));

  browser.storage.onChanged.addListener((changes, area) => {
    try {
      if (area === 'local' && changes.settings) applySettings(normalizeSettings(changes.settings.newValue));
    } catch (e) {
      console.warn('Grammaid: could not apply new settings', e);
    }
  });

  browser.runtime.onMessage.addListener((message: unknown): Promise<PageText | boolean> | undefined => {
    try {
      const req = message as ContentRequest | null;
      if (!req || typeof req !== 'object') return undefined;
      if (req.type === 'run-action') {
        if (!enabledHere()) return undefined;
        startUp();
        return actions?.run(req.action) ? Promise.resolve(true) : undefined;
      }
      if (req.type === 'get-page-text') {
        // Frames with nothing to offer stay silent so the frame that has the text can answer.
        const text = actions?.pageText(req.source, watcher?.currentField ?? null);
        return text ? Promise.resolve(text) : undefined;
      }
    } catch (e) {
      console.warn('Grammaid: message handling failed', e);
    }
    return undefined;
  });
}

try {
  main();
} catch (e) {
  console.warn('Grammaid: content script failed to start', e);
}
