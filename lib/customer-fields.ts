export type CustomerBirthday = { day: number; month: number };

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

export function normalizeCustomerPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
}

export function isValidCustomerBirthday(day: number, month: number): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12) return false;
  const daysInMonth = new Date(2000, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

export function formatCustomerBirthday(day: unknown, month: unknown): string | null {
  if (typeof day !== "number" || typeof month !== "number" || !isValidCustomerBirthday(day, month)) return null;
  return `${day} de ${MONTH_NAMES[month - 1]}`;
}

export function customerBirthdayMonthName(month: number): string | null {
  return Number.isInteger(month) && month >= 1 && month <= 12 ? MONTH_NAMES[month - 1] : null;
}

export const CUSTOMER_BIRTHDAY_MONTHS = MONTH_NAMES;
