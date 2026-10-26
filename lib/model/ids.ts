export function newId(prefix = ''): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return prefix + c.randomUUID();
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
