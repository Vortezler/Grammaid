import { render } from 'preact';
import { Speech } from '../sidebar/tabs/Speech';
render(<><header class="chrome"><div class="brand"><img src="icons/icon.svg" alt="" /><div><h1>Grammaid</h1><p class="brand-subtitle">Local speech to text</p></div><span class="brand-status">ON DEVICE</span></div></header><main><Speech active recordingPage /></main></>, document.getElementById('app')!);
