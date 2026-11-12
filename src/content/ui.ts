// Shared DOM helper and the stylesheet for everything Grammaid draws inside a page (shadow DOM).

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
    else if (key === 'class') el.className = String(value);
    else if (typeof value === 'boolean') {
      if (value) el.setAttribute(key, '');
    } else el.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

// Motion follows a few rules: feedback lands on press (not release), surfaces grow out of the
// thing that opened them and leave the same way, nothing bounces unless a gesture threw it, and
// reduced-motion users get a plain cross-fade. Surfaces are translucent "materials" that turn
// solid when the user asks for less transparency or more contrast.
export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --teal: #0f9d8a; --red: #d93025; --blue: #1a73e8;
  --surface: rgba(255, 255, 255, 0.82); --surface-solid: #ffffff;
  --text: #1c1c1e; --muted: rgba(60, 60, 67, 0.72); --hairline: rgba(60, 60, 67, 0.16);
  --fill: rgba(120, 120, 128, 0.12); --fill-press: rgba(120, 120, 128, 0.22);
  --shadow: 0 12px 36px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08);
  --ease: cubic-bezier(0.2, 0.9, 0.3, 1);
  position: fixed; inset: 0; pointer-events: none;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text);
  text-align: left; letter-spacing: 0;
}
@media (prefers-color-scheme: dark) {
  .root {
    --surface: rgba(44, 44, 46, 0.8); --surface-solid: #2c2c2e;
    --text: #f2f2f7; --muted: rgba(235, 235, 245, 0.66); --hairline: rgba(235, 235, 245, 0.18);
    --fill: rgba(120, 120, 128, 0.26); --fill-press: rgba(120, 120, 128, 0.4);
    --shadow: 0 12px 36px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3);
    --red: #ff6b5e; --blue: #6aa9ff; --teal: #3ecfb9;
  }
}

/* Underlines: a zigzag drawn with gradients (no images, so no page CSP can block it). */
.u {
  position: absolute; height: 4px; pointer-events: none; border-radius: 1px;
  background:
    linear-gradient(135deg, transparent 38%, var(--c) 38%, var(--c) 62%, transparent 62%) 0 0 / 6px 4px repeat-x,
    linear-gradient(45deg, transparent 38%, var(--c) 38%, var(--c) 62%, transparent 62%) 3px 0 / 6px 4px repeat-x;
}
.u.spelling, .u.grammar { --c: var(--red); }
.u.style { --c: var(--blue); }
.hl { position: absolute; pointer-events: none; border-radius: 3px; opacity: 0; transition: opacity 80ms linear; }
.hl.on { opacity: 1; }
.hl.spelling, .hl.grammar { background: rgba(217, 48, 37, 0.14); }
.hl.style { background: rgba(26, 115, 232, 0.14); }

/* Floating surfaces */
.surface {
  position: absolute; pointer-events: auto;
  background: var(--surface);
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--hairline); border-radius: 12px; box-shadow: var(--shadow);
  opacity: 0; transform: scale(0.94);
  transition: opacity 140ms var(--ease), transform 180ms var(--ease);
}
.surface.open { opacity: 1; transform: scale(1); }
.card { width: 288px; max-width: calc(100vw - 16px); padding: 12px; }
.pop { width: 320px; max-width: calc(100vw - 16px); max-height: min(420px, calc(100vh - 16px)); overflow: auto; padding: 12px; overscroll-behavior: contain; }

.kind { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: var(--muted); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--red); flex: none; }
.dot.style { background: var(--blue); }
.dot.teal { background: var(--teal); }
.msg { margin: 6px 0 10px; font-size: 13px; line-height: 1.4; color: var(--text); }
.title { font-size: 13px; font-weight: 600; margin: 0 0 2px; }
.sub { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.row { display: flex; flex-wrap: wrap; gap: 6px; }
.col { display: flex; flex-direction: column; gap: 4px; }

button {
  font: inherit; color: inherit; border: 0; margin: 0; cursor: pointer; text-align: left;
  border-radius: 8px; background: var(--fill); padding: 6px 10px; min-height: 28px;
  transition: transform 100ms ease-out, background-color 100ms ease-out;
  -webkit-user-select: none; user-select: none;
}
button:hover { background: var(--fill-press); }
button:active { transform: scale(0.97); background: var(--fill-press); }
button:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
button.fix { background: var(--teal); color: #fff; font-weight: 600; }
button.fix:hover, button.fix:active { background: var(--teal); filter: brightness(0.94); }
@media (prefers-color-scheme: dark) { button.fix { color: #06231f; } }
button.quiet { background: transparent; color: var(--muted); padding: 5px 8px; font-size: 12px; }
button.quiet:hover { background: var(--fill); color: var(--text); }
button.item { display: flex; flex-direction: column; gap: 1px; width: 100%; background: transparent; padding: 7px 8px; }
button.item:hover { background: var(--fill); }
.item .w { font-weight: 600; }
.item .g { font-size: 11.5px; color: var(--muted); }
.item .t { white-space: pre-wrap; overflow-wrap: anywhere; }
.tag { align-self: flex-start; font-size: 10.5px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--muted); }
ins { text-decoration: none; background: rgba(15, 157, 138, 0.2); border-radius: 3px; }
del { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--red); }
.sep { height: 1px; background: var(--hairline); margin: 10px -12px 8px; }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.note { font-size: 12px; color: var(--muted); margin: 6px 0 0; }
.bar { height: 4px; border-radius: 2px; background: var(--fill); overflow: hidden; margin-top: 8px; }
.bar > i { display: block; height: 100%; width: 0; background: var(--teal); border-radius: 2px; transition: width 200ms linear; }

/* Pill */
.pill {
  position: absolute; pointer-events: auto; display: flex; align-items: center; gap: 5px;
  min-height: 22px; padding: 2px 8px 2px 7px; border-radius: 11px; font-size: 11.5px; font-weight: 600;
  background: var(--surface); color: var(--text); border: 1px solid var(--hairline);
  -webkit-backdrop-filter: blur(16px) saturate(180%); backdrop-filter: blur(16px) saturate(180%);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12); font-variant-numeric: tabular-nums;
}
.pill:hover { background: var(--surface-solid); }
.syn { position: absolute; pointer-events: auto; min-height: 24px; padding: 2px 9px; border-radius: 12px; font-size: 11.5px; font-weight: 600; background: var(--teal); color: #fff; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); }
.syn:hover, .syn:active { background: var(--teal); filter: brightness(0.94); }

.toast {
  position: absolute; left: 50%; bottom: 28px; transform: translate(-50%, 8px); opacity: 0; pointer-events: none;
  padding: 9px 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--hairline);
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
  box-shadow: var(--shadow); font-size: 13px; max-width: calc(100vw - 32px);
  transition: opacity 160ms var(--ease), transform 200ms var(--ease);
}
.toast.open { opacity: 1; transform: translate(-50%, 0); }

@media (prefers-reduced-motion: reduce) {
  .surface, .surface.open, .toast, .toast.open { transition: opacity 160ms ease; }
  .surface { transform: none; }
  .toast, .toast.open { transform: translate(-50%, 0); }
  button, button:active { transition: none; transform: none; }
}
@media (prefers-reduced-transparency: reduce) {
  .surface, .pill, .toast { background: var(--surface-solid); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
@media (prefers-contrast: more) {
  .root { --hairline: currentColor; --muted: var(--text); }
  .surface, .pill, .toast { background: var(--surface-solid); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
`;
