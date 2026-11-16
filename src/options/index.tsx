import { render } from 'preact';
import { Settings } from '../sidebar/tabs/Settings';
import { useModelStatus } from '../sidebar/model-status';
function Preferences() {
  const [status, refresh] = useModelStatus();
  return <div class="preferences-layout">
    <aside class="preferences-rail"><a class="preferences-brand" href="#top"><img src="icons/icon.svg" alt="" /><span>Grammaid</span></a><p class="rail-caption">Preferences</p>
      <nav aria-label="Settings sections">{[['checking', 'Writing checks'], ['suggestions', 'Suggestions'], ['activation', 'Activation & privacy'], ['dictionary', 'Dictionary'], ['models', 'Local models'], ['data', 'Your data']].map(([id, label], i) => <a key={id} href={`#${id}`}><span aria-hidden="true">0{i + 1}</span>{label}</a>)}</nav>
      <p class="rail-footnote">Local by design.<br />Your writing stays on your device.</p>
    </aside>
    <main class="preferences-main" id="top"><header class="preferences-heading"><p class="eyebrow">PREFERENCES</p><h1>Settings</h1><p class="muted">Control where Grammaid runs and how it helps you write.</p><p class="save-hint">Changes save automatically</p></header><Settings active standalone status={status} refreshStatus={refresh} /></main>
  </div>;
}
render(<Preferences />, document.getElementById('app')!);
