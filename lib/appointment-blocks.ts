export const APPOINTMENT_BLOCK_MINUTES = 15;
export const APPOINTMENT_BLOCK_MS = APPOINTMENT_BLOCK_MINUTES * 60_000;
export const MAX_APPOINTMENT_BLOCKS = 32;

export function hondurasDateForMillis(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) throw new Error("La fecha de la cita no es válida.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** UTC midnight identifying a Honduran civil date; Rules recomputes this key from the appointment start. */
export function hondurasDateKeyMillis(fechaLocal: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaLocal);
  if (!match) throw new Error("La fecha de la cita no es válida.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error("La fecha de la cita no es válida.");
  }
  const timestampMs = Date.UTC(year, month - 1, day);
  if (new Date(timestampMs).toISOString().slice(0, 10) !== fechaLocal) {
    throw new Error("La fecha de la cita no es válida.");
  }
  return timestampMs;
}

export function partitionBlockKeys(blockKeys: readonly string[], localDayStartMs: number): AppointmentBlockPartition[] {
  if (!Number.isFinite(localDayStartMs) || blockKeys.length === 0) return [];
  const dayStartBlock = Math.floor(localDayStartMs / APPOINTMENT_BLOCK_MS);
  const grouped = new Map<number, string[]>();
  for (const key of blockKeys) {
    const absoluteBlock = Number(key);
    const dayOffset = absoluteBlock - dayStartBlock;
    if (!Number.isSafeInteger(absoluteBlock) || dayOffset < 0 || dayOffset >= APPOINTMENT_BLOCKS_PER_PARTITION * APPOINTMENT_PARTITIONS_PER_DAY) {
      throw new Error("La cita debe quedar dentro del mismo día de Honduras.");
    }
    const partition = Math.floor(dayOffset / APPOINTMENT_BLOCKS_PER_PARTITION);
    const current = grouped.get(partition) ?? [];
    current.push(key);
    grouped.set(partition, current);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([partition, keys]) => ({ partition, keys }));
}

export function appointmentLockId(employeeUid: string, fechaLocalKey: number, partition: number): string {
  if (!employeeUid || employeeUid.includes("/") || !Number.isSafeInteger(fechaLocalKey)
    || !Number.isInteger(partition) || partition < 0 || partition >= APPOINTMENT_PARTITIONS_PER_DAY) {
    throw new Error("No pudimos preparar el bloqueo de horario.");
  }
  return `${employeeUid}_${fechaLocalKey}_${partition}`;
}

/** Each key represents a 15-minute UTC epoch bucket; the lock document is scoped to the Honduran local day. */
export function blockKeysForInterval(startMs: number, endMs: number): string[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("La duración de la cita no es válida.");
  }
  const first = Math.floor(startMs / APPOINTMENT_BLOCK_MS);
  const lastExclusive = Math.ceil(endMs / APPOINTMENT_BLOCK_MS);
  const count = lastExclusive - first;
  if (count < 1 || count > MAX_APPOINTMENT_BLOCKS) {
    throw new Error("La duración de la cita excede los bloques permitidos.");
  }
  return Array.from({ length: count }, (_, offset) => String(first + offset));
}

export function intervalsFromLockMap(blocks: unknown, _localDayStartMs: number) {
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) return [];
  return Object.keys(blocks).flatMap((key) => {
    const blockIndex = Number(key);
    return Number.isSafeInteger(blockIndex) && blockIndex >= 0
      ? [{ estado: "confirmada", inicioMs: blockIndex * APPOINTMENT_BLOCK_MS, finMs: (blockIndex + 1) * APPOINTMENT_BLOCK_MS }]
      : [];
  });
}
export const APPOINTMENT_BLOCKS_PER_PARTITION = 4;
export const APPOINTMENT_PARTITION_MS = APPOINTMENT_BLOCKS_PER_PARTITION * APPOINTMENT_BLOCK_MS;
export const APPOINTMENT_PARTITIONS_PER_DAY = (24 * 60 * 60_000) / APPOINTMENT_PARTITION_MS;

export type AppointmentBlockPartition = { partition: number; keys: string[] };
