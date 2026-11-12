// Content script entry. Holds no engines: it finds editable fields, asks the background page
// for lints, and draws. Everything is wrapped so a failure here can never break the host page.
//
// Scanning is OFF unless the background says this tab is active: the site is on the user's list,
// or the user clicked the toolbar button in this tab. While active, every text field in the page
// is checked automatically. Synonyms/Rephrase from the context menu work anywhere, because the
// user asked for them explicitly.
import { send, type Activation, type ContentRequest, type PageText } from '../shared/types';
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

  let active = false;
  let overlay: Overlay | null = null;
  let watcher: FieldWatcher | null = null;
  let actions: SelectionActions | null = null;

  /** Overlay and selection actions are created on first need; they cost nothing until then. */
  const ui = () => {
    if (!overlay) {
      overlay = new Overlay();
      watcher = new FieldWatcher(overlay);
      actions = new SelectionActions(overlay, () => active);
    }
    return { overlay, watcher: watcher as FieldWatcher, actions: actions as SelectionActions };
  };

  const apply = (next: Activation) => {
    const was = active;
    active = next.active;
    if (active) {
      const u = ui();
      u.watcher.start();
      u.actions.start();
      if (was) u.watcher.recheck(); // settings changed while running
    } else if (was) {
      watcher?.stop();
      actions?.stop();
      overlay?.closeSurface(true);
    }
  };

  const refresh = () =>
    send({ type: 'get-activation' }).then((res) => {
      if (res.ok) apply(res.data);
    });

  void refresh();

  // Dictionary, categories, dialect or the site list changed: ask again, then recheck.
  browser.storage.onChanged.addListener((changes, area) => {
    try {
      if (area === 'local' && changes.settings) void refresh();
    } catch (e) {
      console.warn('Grammaid: could not apply new settings', e);
    }
  });

  browser.runtime.onMessage.addListener((message: unknown): Promise<PageText | boolean> | undefined => {
    try {
      const req = message as ContentRequest | null;
      if (!req || typeof req !== 'object') return undefined;
      if (req.type === 'activation-changed') {
        apply(req.activation);
        // Only the top frame speaks, so a page with iframes shows one toast.
        if (req.announce && window === window.top) {
          ui().overlay.toast(
            req.activation.active
              ? 'Grammaid is on in this tab'
              : req.activation.tab || req.activation.site
                ? 'Grammaid is switched off in Settings'
                : 'Grammaid is off in this tab',
          );
        }
        return undefined;
      }
      if (req.type === 'run-action') {
        return ui().actions.run(req.action) ? Promise.resolve(true) : undefined;
      }
      if (req.type === 'get-page-text') {
        // Frames with nothing to offer stay silent so the frame that has the text can answer.
        const u = ui();
        const text = u.actions.pageText(req.source, u.watcher.currentField ?? lastFocusedField());
        return text ? Promise.resolve(text) : undefined;
      }
    } catch (e) {
      console.warn('Grammaid: message handling failed', e);
    }
    return undefined;
  });

  /** When scanning is off the watcher tracks nothing, so fall back to the focused element. */
  function lastFocusedField() {
    const el = document.activeElement;
    return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || (el instanceof HTMLElement && el.isContentEditable) ? el : null;
  }
}

try {
  main();
} catch (e) {
  console.warn('Grammaid: content script failed to start', e);
}
