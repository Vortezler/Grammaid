// Structural policy only: never inspect a field value, page text, screenshots or pixels
// to decide whether it is safe. Applied before extraction, checking and replacement.
const sensitive = /\b(?:password|passcode|passwd|pwd|pin|otp|totp|verification|security code|one time|username|user name|user id|login|log in|sign in|sign up|account|email|e mail|phone|telephone|mobile|contact|recipient|credit|debit|card|cardholder|cvv|cvc|ccnum|cc number|cc exp|expiry|expiration|iban|swift|routing|bank|payment|billing|shipping|address|addr|street|apartment|postal|postcode|zip|city|province|state|country|county|name|company|organization|birth|dob|passport|social security|ssn|tax id|identity|national id|license number)\b/iu;
const freePurpose = /\b(?:message|comment|body|content|query|search|prompt|essay|reply|draft|note|notes|post|title|subject|description|editor|caption|free text)\b/iu;
const structuredForm = /\b(?:login|log in|sign in|sign up|signup|register|registration|checkout|payment|billing|shipping|address|account|profile|identity|banking)\b/iu;
const normalize = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-:.]+/g, ' ').replace(/\s+/g, ' ').trim();
function metadata(el: Element): string {
  return normalize(['name', 'id', 'aria-label', 'placeholder', 'data-testid', 'data-purpose'].map((name) => el.getAttribute(name) ?? '').join(' '));
}
function autocompleteBlocks(el: Element): boolean {
  const tokens = (el.getAttribute('autocomplete') ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.some((token) => !['on', 'off'].includes(token));
}
function labelText(el: Element | null): string {
  if (!el || el.matches('input,textarea,select,[contenteditable]')) return '';
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (node) => node.parentElement?.closest('input,textarea,select,[contenteditable]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let text = ''; let node: Node | null;
  while ((node = walker.nextNode()) && text.length < 500) text += node.textContent ?? '';
  return text;
}
function formBlocks(form: Element): boolean {
  if (structuredForm.test(metadata(form)) || form.querySelector('input[type="password"],[autocomplete~="cc-number" i],[autocomplete~="current-password" i]')) return true;
  const action = form.getAttribute('action');
  if (action) { try { return structuredForm.test(normalize(new URL(action, form.ownerDocument.baseURI).pathname)); } catch { /* invalid action provides no purpose */ } }
  return false;
}
export function isFreeText(el: Element): boolean {
  const control = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  if (control) {
    if (el.disabled || el.readOnly || el.closest('fieldset[disabled]')) return false;
    if (el instanceof HTMLInputElement && !['text', 'search'].includes(el.type)) return false;
    if (el.getAttribute('pattern') || ['numeric', 'decimal', 'tel', 'email', 'url'].includes(el.getAttribute('inputmode') ?? '')) return false;
  } else if (!(el instanceof HTMLElement) || !el.hasAttribute('contenteditable') || el.getAttribute('contenteditable') === 'false') return false;
  if (el.closest('[inert],[aria-disabled="true"],[aria-readonly="true"]') || el.getAttribute('role') === 'spinbutton') return false;
  if (autocompleteBlocks(el) || sensitive.test(metadata(el))) return false;
  // Labels are metadata. Only inspect associated labels/legends, never surrounding page text.
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/);
  const labelled = ids.map((id) => labelText(el.ownerDocument.getElementById(id))).join(' ');
  const nativeLabels = control ? [...el.labels ?? []].map(labelText).join(' ') : '';
  if (sensitive.test(normalize(`${labelled} ${nativeLabels}`))) return false;
  if (/^(?:to|cc|bcc|from)$/iu.test((el.getAttribute('aria-label') || nativeLabels || labelled).trim())) return false;
  if (el instanceof HTMLInputElement && el.type !== 'search' && !freePurpose.test(normalize(`${metadata(el)} ${labelled} ${nativeLabels}`))) return false;
  const form = control ? el.form : el.closest('form,[role="form"]');
  if (form && (autocompleteBlocks(form) || formBlocks(form))) return false;
  for (let ancestor = el.parentElement, depth = 0; ancestor && depth < 32; ancestor = ancestor.parentElement, depth++) {
    if (autocompleteBlocks(ancestor)) return false;
    if (ancestor.matches('form,[role="form"],fieldset')) {
      if (formBlocks(ancestor)) return false;
      const legend = ancestor.tagName === 'FIELDSET' ? labelText(ancestor.querySelector(':scope > legend')) : '';
      if (sensitive.test(normalize(legend))) return false;
    } else if (structuredForm.test(normalize(`${ancestor.id} ${ancestor.getAttribute('data-purpose') ?? ''}`))) return false;
  }
  return true;
}
