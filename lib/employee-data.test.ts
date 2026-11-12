import { describe, expect, it } from "vitest";
import { employeeCodeForUid, normalizeEmployeeBirthday } from "./employee-data";

describe("employee-data", () => {
  it("normaliza cumpleaños manuales guardados como texto a números", () => {
    expect(normalizeEmployeeBirthday("08", "03")).toEqual({ birthdayDay: 8, birthdayMonth: 3 });
  });

  it("omite fechas incompletas o imposibles", () => {
    expect(normalizeEmployeeBirthday("08", undefined)).toBeNull();
    expect(normalizeEmployeeBirthday("31", "04")).toBeNull();
    expect(normalizeEmployeeBirthday(32, 1)).toBeNull();
  });

  it("produce el mismo código de empleado para el mismo UID", () => {
    expect(employeeCodeForUid("abcde1234567890")).toBe("EMP-ABCDE1234567");
    expect(employeeCodeForUid("abcde1234567890")).toBe(employeeCodeForUid("abcde1234567890"));
  });
});
