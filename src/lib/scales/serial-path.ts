/** Normalize Windows COM port names: "com 3" / "COM3" → "COM3". */
export function normalizeSerialPath(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const comMatch = /^com\s*(\d+)\s*$/i.exec(trimmed);
  if (comMatch) return `COM${comMatch[1]}`;
  return trimmed;
}
