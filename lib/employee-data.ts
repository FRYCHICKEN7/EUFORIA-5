import { isValidCustomerBirthday } from "./customer-fields";

export const INITIAL_BUSINESS_ID = "euforia-beauty-studio";

export function normalizeEmployeeBirthday(day: unknown, month: unknown) {
  const parsedDay = typeof day === "number"
    ? day
    : typeof day === "string" && /^\d{1,2}$/.test(day.trim()) ? Number(day) : null;
  const parsedMonth = typeof month === "number"
    ? month
    : typeof month === "string" && /^\d{1,2}$/.test(month.trim()) ? Number(month) : null;

  if (parsedDay === null || parsedMonth === null || !isValidCustomerBirthday(parsedDay, parsedMonth)) return null;
  return { birthdayDay: parsedDay, birthdayMonth: parsedMonth };
}

export function employeeCodeForUid(uid: string) {
  const stablePart = uid.trim().slice(0, 12).toUpperCase();
  return `EMP-${stablePart}`;
}
