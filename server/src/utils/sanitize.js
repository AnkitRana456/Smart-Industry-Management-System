/** Stored free text is untrusted when it reaches a prompt: one line, no control characters, bounded length. */
export function clean(value, max = 120) {
  if (value == null) return '';
  // eslint-disable-next-line no-control-regex
  const s = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
