/** `TRUST_PROXY` → Express `trust proxy` value: 'false' | hop count | subnet/preset list. */
export function parseTrustProxy(value: string): boolean | number | string {
  const trimmed = value.trim();
  if (trimmed === 'false') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}
