export function normalizeWhatsAppNumber(raw: string): string | null {
  const value = raw.trim();
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) return `504${digits}`;
  if (digits.length === 11 && digits.startsWith("504")) return digits;
  if (value.startsWith("+") && digits.length >= 10 && digits.length <= 15) return digits;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

export function getWhatsAppUrl(raw: string): string | null {
  const normalized = normalizeWhatsAppNumber(raw);
  return normalized ? `https://wa.me/${normalized}` : null;
}
