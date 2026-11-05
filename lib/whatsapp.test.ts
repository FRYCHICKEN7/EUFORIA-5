import { describe, expect, it } from "vitest";
import { getWhatsAppUrl, normalizeWhatsAppNumber } from "./whatsapp";

describe("normalización de WhatsApp Honduras", () => {
  it("añade +504 a un número nacional de ocho dígitos", () => {
    expect(normalizeWhatsAppNumber("87984004")).toBe("50487984004");
    expect(getWhatsAppUrl("87984004")).toBe("https://wa.me/50487984004");
  });

  it("preserva 504 ya presente con distintos separadores", () => {
    expect(normalizeWhatsAppNumber("+504 8798-4004")).toBe("50487984004");
    expect(normalizeWhatsAppNumber("50487984004")).toBe("50487984004");
  });

  it("preserva teléfonos internacionales con +", () => {
    expect(getWhatsAppUrl("+1 (212) 555-0100")).toBe("https://wa.me/12125550100");
  });

  it("rechaza valores vacíos y números demasiado cortos", () => {
    expect(normalizeWhatsAppNumber("")).toBeNull();
    expect(normalizeWhatsAppNumber("12345")).toBeNull();
    expect(getWhatsAppUrl("abc")).toBeNull();
  });
});
