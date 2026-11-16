// Lightweight command routing only. Heavy model code loads after a feature is requested.
import { SpellingStore } from './spelling-store';
import { TypingCoordinator } from './typing';
import { createHandlers, listen, type Engines } from './messages';
import { registerMenus } from './menus';
import { registerActivation } from './activation';

let loaded: Engines | null = null;
let loading: Promise<Engines> | null = null;
const engines = () => loading ??= import('./engines').then((module) => module.createEngines()).then((value) => loaded = value).catch((error) => { loading = null; throw error; });
const typing = new TypingCoordinator(); typing.register();
listen(createHandlers({ engines, peekEngines: () => loaded, spelling: new SpellingStore(browser.storage.local as never), typing }));
registerMenus(); registerActivation();
