import { describe, expect, it } from "vitest";
import { formatCustomerBirthday, isValidCustomerBirthday, normalizeCustomerPhone } from "./customer-fields";

describe("normalizeCustomerPhone", () => {
  it("acepta ocho dígitos hondureños y limpia separadores comunes", () => {
    expect(normalizeCustomerPhone("87984004")).toBe("87984004");
    expect(normalizeCustomerPhone("8798-4004")).toBe("87984004");
    expect(normalizeCustomerPhone("8798 4004")).toBe("87984004");
  });

  it("acepta formato internacional con + y guarda solo el prefijo y dígitos", () => {
    expect(normalizeCustomerPhone("+504 8798-4004")).toBe("+50487984004");
    expect(normalizeCustomerPhone("+1 (202) 555-0123")).toBe("+12025550123");
  });

  it("rechaza teléfono vacío, incompleto y sin + internacional", () => {
    expect(normalizeCustomerPhone("")).toBeNull();
    expect(normalizeCustomerPhone("1234567")).toBeNull();
    expect(normalizeCustomerPhone("50487984004")).toBeNull();
    expect(normalizeCustomerPhone("+123")).toBeNull();
  });
});

describe("customer birthday", () => {
  it("valida día y mes sin año y permite el 29 de febrero", () => {
    expect(isValidCustomerBirthday(29, 2)).toBe(true);
    expect(isValidCustomerBirthday(31, 4)).toBe(false);
    expect(isValidCustomerBirthday(0, 1)).toBe(false);
    expect(formatCustomerBirthday(15, 3)).toBe("15 de marzo");
    expect(formatCustomerBirthday(29, 2)).toBe("29 de febrero");
  });
});
