import type { Editable } from './textmap';
const typing = new WeakSet<Editable>();
export const isTypingField = (field: Editable) => typing.has(field);
export function markTypingField(field: Editable, active: boolean) { if (active) typing.add(field); else typing.delete(field); }
