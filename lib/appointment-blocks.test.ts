import { describe, expect, it } from "vitest";
import { APPOINTMENT_BLOCK_MS, APPOINTMENT_PARTITIONS_PER_DAY, appointmentLockId, blockKeysForInterval, hondurasDateForMillis, hondurasDateKeyMillis, intervalsFromLockMap, partitionBlockKeys } from "./appointment-blocks";
import { hondurasDateTimeMs } from "./availability";

function at(date: string, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const timestamp = hondurasDateTimeMs(date, hours * 60 + minutes);
  if (timestamp === null) throw new Error("Hora de prueba inválida");
  return timestamp;
}

describe("candados por bloques de citas", () => {
  it("forma una clave UTC de medianoche para el día civil en Honduras", () => {
    expect(hondurasDateKeyMillis("2026-12-07")).toBe(Date.UTC(2026, 11, 7));
    expect(() => hondurasDateKeyMillis("2026-02-30")).toThrow();
  });

  it("divide una cita de ocho horas en como máximo nueve registros de una hora", () => {
    const date = "2026-12-07";
    const localDayStart = hondurasDateKeyMillis(date) + 6 * 60 * 60_000;
    const start = at(date, "09:00");
    const blocks = blockKeysForInterval(start, start + 480 * 60_000);
    const partitions = partitionBlockKeys(blocks, localDayStart);
    expect(APPOINTMENT_PARTITIONS_PER_DAY).toBe(24);
    expect(partitions.map(({ partition, keys }) => [partition, keys.length])).toEqual(
      Array.from({ length: 8 }, (_, index) => [9 + index, 4]),
    );
    expect(partitions.flatMap(({ keys }) => keys)).toEqual(blocks);
    const offsetStart = at(date, "09:15");
    const offsetBlocks = blockKeysForInterval(offsetStart, offsetStart + 480 * 60_000);
    const offsetPartitions = partitionBlockKeys(offsetBlocks, localDayStart);
    expect(offsetPartitions.map(({ keys }) => keys.length)).toEqual([3, 4, 4, 4, 4, 4, 4, 4, 1]);
    expect(appointmentLockId("empleado-1", hondurasDateKeyMillis(date), 12)).toBe(`empleado-1_${hondurasDateKeyMillis(date)}_12`);
    expect(() => appointmentLockId("empleado-1", hondurasDateKeyMillis(date), 24)).toThrow();
  });

  it("guarda seis bloques para un servicio de 90 minutos en Honduras", () => {
    const start = at("2026-11-03", "08:00");
    const blocks = blockKeysForInterval(start, start + 90 * 60_000);
    expect(blocks).toHaveLength(6);
    expect(blocks).toEqual(Array.from({ length: 6 }, (_, index) => String(start / APPOINTMENT_BLOCK_MS + index)));
    expect(hondurasDateForMillis(start)).toBe("2026-11-03");
  });

  it("redondea al bloque siguiente para cubrir duraciones no divisibles entre 15", () => {
    const start = at("2026-11-03", "08:15");
    expect(blockKeysForInterval(start, start + 20 * 60_000)).toHaveLength(2);
    expect(blockKeysForInterval(start, start + 5 * 60_000)).toHaveLength(1);
  });

  it("rechaza intervalos vacíos y citas que exceden 32 bloques", () => {
    expect(() => blockKeysForInterval(100, 100)).toThrow();
    expect(() => blockKeysForInterval(0, 481 * 60_000)).toThrow();
  });

  it("mantiene ocupado un bloque numérico aunque el valor almacenado sea inesperado", () => {
    const first = 200_000;
    expect(intervalsFromLockMap({ [String(first)]: "cita", [String(first + 1)]: false, corrupto: "ignorar" }, 0)).toEqual([
      { estado: "confirmada", inicioMs: first * APPOINTMENT_BLOCK_MS, finMs: (first + 1) * APPOINTMENT_BLOCK_MS },
      { estado: "confirmada", inicioMs: (first + 1) * APPOINTMENT_BLOCK_MS, finMs: (first + 2) * APPOINTMENT_BLOCK_MS },
    ]);
  });
});
