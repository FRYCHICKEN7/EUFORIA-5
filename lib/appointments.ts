import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { db, ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";
import { computeAvailableSlots, hondurasDayBounds, parseLocalDate } from "@/lib/availability";
import { APPOINTMENT_PARTITIONS_PER_DAY, appointmentLockId, blockKeysForInterval, hondurasDateForMillis, hondurasDateKeyMillis, intervalsFromLockMap, partitionBlockKeys } from "@/lib/appointment-blocks";
import { mergeProfileSources, profileRole, type ProfileRecord } from "@/lib/roles";

export type BusinessRecord = { id: string; nombre: string; modoNegocio: "unipersonal" | "multiEmpleado" | null; activo: boolean; reservasSparkPreparadas?: boolean };
export type ServiceRecord = { id: string; nombre: string; descripcion: string; precio: number | null; duracionMin: number | null; activo: boolean; recordatorioRegresoActivo?: boolean; periodoRegresoDias?: number | null; anticipacionRecordatorioDias?: number | null };
export type AvailableTimeSlot = { hora: string; inicio: string };
export type EmployeeAvailability = { id: string; uid: string; Empleado: string; nombre: string; profileImage: string; slots: AvailableTimeSlot[] };
export type AppointmentAvailability = { fecha: string; servicio: { id: string; nombre: string; precio: number; duracionMin: number }; empleados: EmployeeAvailability[] };
export type AppointmentRecord = DocumentData & {
  id: string;
  inicio: unknown;
  fin?: unknown;
  estado: string;
  clienteId: string;
  negocioId: string;
  servicioId: string;
  empleadoId?: string;
  empleadoUid?: string;
  duracionMin?: number;
  duracionRealMin?: number;
  startedAt?: unknown;
  completedAt?: unknown;
};

export function appointmentStatusLabel(status: string): string {
  switch (status) {
    case "hold": return "Esperando respuesta";
    case "pendiente_de_aprobacion": return "Pendiente de confirmar";
    case "confirmada": return "Confirmada";
    case "en_curso": return "En servicio";
    case "completada": return "Finalizada";
    case "finalizada": return "Finalizada";
    case "cancelada": return "Cancelada";
    case "rechazada": return "Rechazada";
    case "expirada": return "Venció";
    default: return "Pendiente";
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function clockFromMinutes(value: unknown): string {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= 24 * 60) return "";
  return `${String(Math.floor(Number(value) / 60)).padStart(2, "0")}:${String(Number(value) % 60).padStart(2, "0")}`;
}

export async function loadBusinesses(): Promise<BusinessRecord[]> {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("El servicio no está disponible.");
  const snapshot = await getDocs(collection(db, "negocios"));
  return snapshot.docs
    .map((item) => {
      const data = item.data();
      const mode: BusinessRecord["modoNegocio"] = data.modoNegocio === "multiEmpleado" || data.modoNegocio === "unipersonal" ? data.modoNegocio : null;
      return { id: item.id, nombre: String(data.nombre ?? data.nombreNegocio ?? data.name ?? "EUFORIA"), modoNegocio: mode, activo: data.activo === true, reservasSparkPreparadas: data.reservasSparkPreparadas === true };
    })
    .filter((business) => business.activo);
}

export async function loadServices(businessId: string, includeInactive = false): Promise<ServiceRecord[]> {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("El servicio no está disponible.");
  const snapshot = await getDocs(collection(db, "negocios", businessId, "servicios"));
  return snapshot.docs
    .map((item) => {
      const data = item.data();
      return {
        id: item.id,
        nombre: String(data.nombre ?? data.name ?? "Servicio"),
        descripcion: String(data.descripcion ?? data.description ?? ""),
        precio: numberOrNull(data.precio),
        duracionMin: numberOrNull(data.duracionMin),
        activo: data.activo === true,
        recordatorioRegresoActivo: data.recordatorioRegresoActivo === true,
        periodoRegresoDias: numberOrNull(data.periodoRegresoDias),
        anticipacionRecordatorioDias: numberOrNull(data.anticipacionRecordatorioDias),
      };
    })
    .filter((service) => includeInactive || service.activo);
}

export async function getAvailableEmployeeSlots(input: { negocioId: string; servicioId: string; fecha: string }): Promise<AppointmentAvailability> {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("El servicio no está disponible.");
  const database = db;
  const day = parseLocalDate(input.fecha);
  const bounds = hondurasDayBounds(input.fecha);
  if (!day || !bounds) throw new Error("Escribe una fecha válida.");
  const nowMs = Date.now();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tegucigalpa", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const values = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  if (input.fecha < today) throw new Error("No puedes elegir una fecha que ya pasó.");
  const todayParts = parseLocalDate(today);
  if (!todayParts || Date.UTC(day.year, day.month - 1, day.day) - Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day) > 365 * 24 * 60 * 60_000) {
    throw new Error("Elige una fecha dentro del próximo año.");
  }

  const businessRef = doc(database, "negocios", input.negocioId);
  const serviceRef = doc(database, "negocios", input.negocioId, "servicios", input.servicioId);
  const hoursRef = doc(database, "negocios", input.negocioId, "horarios", String(day.weekday));
  const [businessSnapshot, serviceSnapshot, hoursSnapshot] = await Promise.all([
    getDoc(businessRef), getDoc(serviceRef), getDoc(hoursRef),
  ]);
  if (!businessSnapshot.exists() || businessSnapshot.data().activo !== true) throw new Error("Este negocio no está disponible.");
  if (businessSnapshot.data().reservasSparkPreparadas !== true) throw new Error("La agenda está en preparación. Intenta de nuevo más tarde.");
  if (!serviceSnapshot.exists() || serviceSnapshot.data().activo !== true) throw new Error("Este servicio no está disponible.");
  const serviceData = serviceSnapshot.data();
  const duration = Number(serviceData.duracionMin);
  const price = Number(serviceData.precio);
  const service = {
    id: input.servicioId,
    nombre: String(serviceData.nombre ?? serviceData.name ?? "Servicio"),
    precio: Number.isFinite(price) ? price : 0,
    duracionMin: duration,
  };
  if (!Number.isInteger(duration) || duration < 5 || duration > 480 || !Number.isFinite(price) || price < 0) {
    throw new Error("Este servicio aún no tiene un precio y una duración válidos.");
  }
  const hours = hoursSnapshot.data();
  if (!hoursSnapshot.exists() || !hours || hours.activo !== true) return { fecha: input.fecha, servicio: service, empleados: [] };

  const publicEmployees = await getDocs(query(
    collection(database, "negocios", input.negocioId, "empleadosPublicos"),
    where("activo", "==", true), where("publica", "==", true), where("disponible", "==", true), limit(100),
  ));
  const employees = await Promise.all(publicEmployees.docs.map(async (employeeSnapshot) => {
    const employee = employeeSnapshot.data();
    const uid = String(employee.uid ?? employee.id ?? employeeSnapshot.id);
    const scheduleRef = doc(database, "negocios", input.negocioId, "empleados", uid, "disponibilidad", String(day.weekday));
    const lockQuery = query(
      collection(database, "negocios", input.negocioId, "bloqueosCitas"),
      where("empleadoUid", "==", uid),
      where("fechaLocalKey", "==", hondurasDateKeyMillis(input.fecha)),
      limit(APPOINTMENT_PARTITIONS_PER_DAY + 1),
    );
    const [scheduleSnapshot, lockSnapshot] = await Promise.all([getDoc(scheduleRef), getDocs(lockQuery)]);
    const schedule = scheduleSnapshot.data();
    if (!scheduleSnapshot.exists() || !schedule || schedule.activo !== true) return null;
    if (lockSnapshot.size > APPOINTMENT_PARTITIONS_PER_DAY) throw new Error("La agenda necesita preparación antes de mostrar horarios.");
    const lockMap = lockSnapshot.docs.reduce<Record<string, unknown>>((merged, lock) => {
      const blocks = lock.data().bloques;
      if (blocks && typeof blocks === "object" && !Array.isArray(blocks)) Object.assign(merged, blocks);
      return merged;
    }, {});
    const appointments = intervalsFromLockMap(lockMap, bounds.startMs);
    const slots = computeAvailableSlots({
      date: input.fecha,
      nowMs,
      serviceDurationMin: duration,
      opening: String(hours.apertura ?? ""),
      closing: String(hours.cierre ?? ""),
      businessBreaks: Array.isArray(hours.recesos) ? hours.recesos : [],
      employeeStart: clockFromMinutes(schedule.inicioMin) || String(schedule.inicio ?? ""),
      employeeEnd: clockFromMinutes(schedule.finMin) || String(schedule.fin ?? ""),
      appointments,
      slotStepMin: 15,
    });
    return slots.length === 0 ? null : {
      id: uid,
      uid,
      Empleado: String(employee.Empleado ?? ""),
      nombre: String(employee.name ?? employee.nombre ?? employee.displayName ?? "Profesional"),
      profileImage: typeof employee.profileImage === "string" ? employee.profileImage : "",
      slots: slots.map((slot) => ({ hora: slot.hora, inicio: new Date(slot.inicioMs).toISOString() })),
    } satisfies EmployeeAvailability;
  }));
  return { fecha: input.fecha, servicio: service, empleados: employees.filter((employee): employee is EmployeeAvailability => employee !== null) };
}

function mapAppointments(snapshot: { docs: Array<{ id: string; data: () => DocumentData }> }): AppointmentRecord[] {
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }) as AppointmentRecord)
    .filter((item) => item.estado !== "preparando");
}

export function subscribeAdminAppointments(next: (items: AppointmentRecord[]) => void, error: (reason: Error) => void): Unsubscribe {
  if (!db) throw new Error("El servicio no está disponible.");
  const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const appointmentsQuery = query(collection(db, "citas"), where("inicio", ">=", since), orderBy("inicio", "asc"), limit(500));
  return onSnapshot(appointmentsQuery, (snapshot) => next(mapAppointments(snapshot)), error);
}

export function subscribeAdminReminderAppointments(
  negocioId: string,
  next: (items: AppointmentRecord[]) => void,
  error: (reason: Error) => void,
): Unsubscribe {
  if (!db) throw new Error("El servicio no está disponible.");
  const appointmentsQuery = query(collection(db, "citas"), where("negocioId", "==", negocioId), limit(1000));
  return onSnapshot(appointmentsQuery, (snapshot) => next(mapAppointments(snapshot)), error);
}

export function subscribeClientAppointments(uid: string, next: (items: AppointmentRecord[]) => void, error: (reason: Error) => void): Unsubscribe {
  if (!db) throw new Error("El servicio no está disponible.");
  const appointmentsQuery = query(collection(db, "citas"), where("clienteId", "==", uid), orderBy("inicio", "asc"), limit(200));
  return onSnapshot(appointmentsQuery, (snapshot) => next(mapAppointments(snapshot)), error);
}

export function subscribeEmployeeAppointments(uid: string, next: (items: AppointmentRecord[]) => void, error: (reason: Error) => void): Unsubscribe {
  if (!db) throw new Error("El servicio no está disponible.");
  const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const appointmentsQuery = query(collection(db, "citas"), where("empleadoUid", "==", uid), where("inicio", ">=", since), orderBy("inicio", "asc"), limit(500));
  return onSnapshot(appointmentsQuery, (snapshot) => next(mapAppointments(snapshot)), error);
}

export function appointmentMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    const result = value.toMillis();
    return Number.isFinite(result) ? result : null;
  }
  return null;
}

export async function reserveAppointment(input: { negocioId: string; servicioId: string; inicio: string; empleadoId: string; notas?: string }) {
  if (!(await ensureFirebaseConfigured())) throw new Error("El servicio no está disponible.");
  const database = db;
  const auth = firebaseAuth;
  const user = auth?.currentUser;
  if (!database || !user?.uid) throw Object.assign(new Error("Inicia sesión para enviar tu solicitud."), { code: "unauthenticated" });
  const startMs = Date.parse(input.inicio);
  if (!Number.isFinite(startMs)) throw Object.assign(new Error("La fecha de la cita no es válida."), { code: "invalid-argument" });
  const fechaLocal = hondurasDateForMillis(startMs);
  const fechaLocalKey = hondurasDateKeyMillis(fechaLocal);
  const localDay = parseLocalDate(fechaLocal);
  if (!localDay) throw Object.assign(new Error("La fecha de la cita no es válida."), { code: "invalid-argument" });
  const localDayBounds = hondurasDayBounds(fechaLocal);
  if (!localDayBounds) throw Object.assign(new Error("La fecha de la cita no es válida."), { code: "invalid-argument" });
  const notes = typeof input.notas === "string" ? input.notas.trim() : "";
  if (notes.length > 500) throw Object.assign(new Error("La nota no puede superar 500 caracteres."), { code: "invalid-argument" });

  const userRef = doc(database, "users", user.uid);
  const legacyUserRef = doc(database, "usuarios", user.uid);
  const employeeRoleRef = doc(database, "empleados", user.uid);
  const businessRef = doc(database, "negocios", input.negocioId);
  const serviceRef = doc(database, "negocios", input.negocioId, "servicios", input.servicioId);
  const employeeRef = doc(database, "negocios", input.negocioId, "empleadosPublicos", input.empleadoId);
  const hoursRef = doc(database, "negocios", input.negocioId, "horarios", String(localDay.weekday));
  const scheduleRef = doc(database, "negocios", input.negocioId, "empleados", input.empleadoId, "disponibilidad", String(localDay.weekday));
  const appointmentRef = doc(collection(database, "citas"));
  const clientNoticeRef = doc(database, "notificaciones", `${appointmentRef.id}-client`);
  const employeeNoticeRef = doc(database, "notificaciones", `${appointmentRef.id}-employee`);
  const adminNoticeRef = doc(database, "notificaciones", `${appointmentRef.id}-admin`);

  const preparation = await runTransaction(database, async (transaction) => {
    const [userSnapshot, legacyUserSnapshot, employeeRoleSnapshot, businessSnapshot, serviceSnapshot, employeeSnapshot, hoursSnapshot, scheduleSnapshot] = await Promise.all([
      transaction.get(userRef), transaction.get(legacyUserRef), transaction.get(employeeRoleRef),
      transaction.get(businessRef), transaction.get(serviceRef), transaction.get(employeeRef),
      transaction.get(hoursRef), transaction.get(scheduleRef),
    ]);
    const clientProfile = mergeProfileSources([
      userSnapshot.exists() ? { ...userSnapshot.data(), id: user.uid } as ProfileRecord : null,
      employeeRoleSnapshot.exists() ? { ...employeeRoleSnapshot.data(), id: user.uid } as ProfileRecord : null,
      legacyUserSnapshot.exists() ? { ...legacyUserSnapshot.data(), id: user.uid } as ProfileRecord : null,
    ]);
    if (!clientProfile || profileRole(clientProfile) !== "cliente") {
      throw Object.assign(new Error("Solo una cuenta de cliente puede enviar solicitudes de cita."), { code: "permission-denied" });
    }
    if (!businessSnapshot.exists() || businessSnapshot.data().activo !== true) throw Object.assign(new Error("Este negocio no está disponible."), { code: "failed-precondition" });
    if (businessSnapshot.data().reservasSparkPreparadas !== true) {
      throw Object.assign(new Error("La agenda todavía se está preparando. Intenta de nuevo más tarde."), { code: "failed-precondition" });
    }
    if (!serviceSnapshot.exists() || serviceSnapshot.data().activo !== true) throw Object.assign(new Error("Este servicio no está disponible."), { code: "failed-precondition" });
    if (!employeeSnapshot.exists()) throw Object.assign(new Error("Este profesional no está disponible."), { code: "failed-precondition" });
    const business = businessSnapshot.data();
    const employeeUid = String(employeeSnapshot.data().uid ?? input.empleadoId);
    if (employeeUid !== input.empleadoId) throw Object.assign(new Error("Este profesional necesita revisar su perfil antes de recibir citas."), { code: "failed-precondition" });
    const serviceData = serviceSnapshot.data();
    const employee = employeeSnapshot.data();
    const hours = hoursSnapshot.data();
    const schedule = scheduleSnapshot.data();
    const duration = Number(serviceData.duracionMin);
    const price = Number(serviceData.precio);
    if (!Number.isInteger(duration) || duration < 5 || duration > 480 || !Number.isFinite(price) || price < 0) {
      throw Object.assign(new Error("Este servicio aún no tiene un precio y una duración válidos."), { code: "failed-precondition" });
    }
    if (employee.activo !== true || employee.publica !== true || employee.disponible !== true) {
      throw Object.assign(new Error("Este profesional no recibe citas en este momento."), { code: "failed-precondition" });
    }
    if (!hoursSnapshot.exists() || !hours || hours.activo !== true || !scheduleSnapshot.exists() || !schedule || schedule.activo !== true) {
      throw Object.assign(new Error("El negocio o el profesional no tienen horario para ese día."), { code: "failed-precondition" });
    }
    const endMs = startMs + duration * 60_000;
    const blockKeys = blockKeysForInterval(startMs, endMs);
    const partitionGroups = partitionBlockKeys(blockKeys, localDayBounds.startMs);
    if (partitionGroups.length === 0 || partitionGroups.length > APPOINTMENT_PARTITIONS_PER_DAY) {
      throw Object.assign(new Error("No pudimos proteger el horario completo. Elige otra hora o un servicio más corto."), { code: "failed-precondition" });
    }
    const lockRefs = partitionGroups.map(({ partition }) => doc(
      database,
      "negocios",
      input.negocioId,
      "bloqueosCitas",
      appointmentLockId(input.empleadoId, fechaLocalKey, partition),
    ));
    const lockSnapshots = await Promise.all(lockRefs.map((reference) => transaction.get(reference)));
    const lockMap = lockSnapshots.reduce<Record<string, unknown>>((merged, snapshot) => {
      const blocks = snapshot.data()?.bloques;
      if (blocks && typeof blocks === "object" && !Array.isArray(blocks)) Object.assign(merged, blocks);
      return merged;
    }, {});
    const intervals = intervalsFromLockMap(lockMap, localDayBounds.startMs);
    const nowMs = Date.now();
    const slots = computeAvailableSlots({
      date: fechaLocal,
      nowMs,
      serviceDurationMin: duration,
      opening: String(hours.apertura ?? ""),
      closing: String(hours.cierre ?? ""),
      businessBreaks: Array.isArray(hours.recesos) ? hours.recesos : [],
      employeeStart: clockFromMinutes(schedule.inicioMin) || String(schedule.inicio ?? ""),
      employeeEnd: clockFromMinutes(schedule.finMin) || String(schedule.fin ?? ""),
      appointments: intervals,
      slotStepMin: 15,
    });
    const slot = slots.find((candidate) => candidate.inicioMs === startMs);
    if (!slot || slot.finMs !== endMs) throw Object.assign(new Error("Ese horario ya no está libre o no cabe el servicio completo. Elige otra hora."), { code: "already-exists" });
    if (blockKeys.some((key) => Object.prototype.hasOwnProperty.call(lockMap, key))) {
      throw Object.assign(new Error("Ese horario acaba de ocuparse. Elige otra hora disponible."), { code: "already-exists" });
    }

    const clientName = String(clientProfile.name ?? clientProfile.displayName ?? clientProfile.nombre ?? user.displayName ?? "Cliente");
    const clientPhone = String(clientProfile.phone ?? clientProfile.telefono ?? "");
    const serviceName = String(serviceData.nombre ?? serviceData.name ?? "Servicio");
    const employeeName = String(employee.name ?? employee.nombre ?? employee.displayName ?? "Profesional");
    const businessName = String(business.nombre ?? business.nombreNegocio ?? business.name ?? "EUFORIA");
    const createdAt = serverTimestamp();
    const dateLabel = new Date(startMs).toLocaleString("es-HN", {
      timeZone: "America/Tegucigalpa", day: "numeric", month: "long", hour: "numeric", minute: "2-digit",
    });
    transaction.set(appointmentRef, {
      negocioId: input.negocioId,
      negocioNombre: businessName,
      clienteId: user.uid,
      clienteEmail: String(user.email ?? clientProfile.email ?? ""),
      clienteNombre: clientName,
      clienteTelefono: clientPhone,
      servicioId: input.servicioId,
      servicioNombre: serviceName,
      precio: price,
      duracionMin: duration,
      inicio: Timestamp.fromMillis(startMs),
      fin: Timestamp.fromMillis(endMs),
      fechaLocal,
      fechaLocalKey,
      empleadoId: input.empleadoId,
      empleadoUid: employeeUid,
      empleadoNombre: employeeName,
      empleadoCodigo: String(employee.Empleado ?? ""),
      modoNegocio: business.modoNegocio === "multiEmpleado" ? "multiEmpleado" : "unipersonal",
      estado: "preparando",
      createdAt,
      updatedAt: createdAt,
      ...(notes ? { notas: notes } : {}),
    });
    return {
      citaId: appointmentRef.id,
      fechaLocal,
      fechaLocalKey,
      startMs,
      endMs,
      duration,
      blockKeys,
      partitionGroups,
      lockRefs,
      localDayStartMs: localDayBounds.startMs,
      aviso: {
        clienteNombre: clientName,
        empleadoUid: String(employee.uid ?? input.empleadoId),
        empleadoNombre: employeeName,
        servicioNombre: serviceName,
        fecha: dateLabel,
      },
    };
  });

  try {
    await runTransaction(database, async (transaction) => {
      const [draftSnapshot, businessSnapshot, employeeSnapshot, hoursSnapshot, scheduleSnapshot, ...lockSnapshots] = await Promise.all([
        transaction.get(appointmentRef),
        transaction.get(businessRef),
        transaction.get(employeeRef),
        transaction.get(hoursRef),
        transaction.get(scheduleRef),
        ...preparation.lockRefs.map((reference) => transaction.get(reference)),
      ]);
      if (!draftSnapshot.exists()
        || draftSnapshot.data().estado !== "preparando"
        || draftSnapshot.data().clienteId !== user.uid) {
        throw Object.assign(new Error("No pudimos preparar la solicitud. Intenta de nuevo."), { code: "failed-precondition" });
      }
      if (!businessSnapshot.exists() || businessSnapshot.data().activo !== true
        || businessSnapshot.data().reservasSparkPreparadas !== true
        || businessSnapshot.data().reservasSparkPreparando === true) {
        throw Object.assign(new Error("La agenda está en preparación. Intenta de nuevo más tarde."), { code: "failed-precondition" });
      }
      if (!employeeSnapshot.exists() || employeeSnapshot.data().activo !== true
        || employeeSnapshot.data().publica !== true || employeeSnapshot.data().disponible !== true
        || employeeSnapshot.data().negocioId !== input.negocioId
        || !hoursSnapshot.exists() || hoursSnapshot.data().activo !== true
        || !scheduleSnapshot.exists() || scheduleSnapshot.data().activo !== true) {
        throw Object.assign(new Error("El negocio o el profesional ya no tienen disponibilidad para esa hora."), { code: "failed-precondition" });
      }

      const lockMap = lockSnapshots.reduce<Record<string, unknown>>((merged, snapshot) => {
        const blocks = snapshot.data()?.bloques;
        if (blocks && typeof blocks === "object" && !Array.isArray(blocks)) Object.assign(merged, blocks);
        return merged;
      }, {});
      const intervals = intervalsFromLockMap(lockMap, preparation.localDayStartMs);
      const currentHours = hoursSnapshot.data();
      const currentSchedule = scheduleSnapshot.data();
      const slots = computeAvailableSlots({
        date: preparation.fechaLocal,
        nowMs: Date.now(),
        serviceDurationMin: preparation.duration,
        opening: String(currentHours.apertura ?? ""),
        closing: String(currentHours.cierre ?? ""),
        businessBreaks: Array.isArray(currentHours.recesos) ? currentHours.recesos : [],
        employeeStart: clockFromMinutes(currentSchedule.inicioMin) || String(currentSchedule.inicio ?? ""),
        employeeEnd: clockFromMinutes(currentSchedule.finMin) || String(currentSchedule.fin ?? ""),
        appointments: intervals,
        slotStepMin: 15,
      });
      const slot = slots.find((candidate) => candidate.inicioMs === preparation.startMs);
      if (!slot || slot.finMs !== preparation.endMs
        || preparation.blockKeys.some((key) => Object.prototype.hasOwnProperty.call(lockMap, key))) {
        throw Object.assign(new Error("Ese horario ya no está libre. Elige otra hora disponible."), { code: "already-exists" });
      }

      const updatedAt = serverTimestamp();
      transaction.update(appointmentRef, { estado: "pendiente_de_aprobacion", updatedAt });
      for (const [index, group] of preparation.partitionGroups.entries()) {
        const lockSnapshot = lockSnapshots[index];
        const lockRef = preparation.lockRefs[index];
        const previous = lockSnapshot.data()?.bloques;
        const previousMap = previous && typeof previous === "object" && !Array.isArray(previous)
          ? previous as Record<string, boolean>
          : {};
        const nextMap: Record<string, boolean> = { ...previousMap };
        for (const key of group.keys) nextMap[key] = true;
        const lockUpdate = { bloques: nextMap, ultimaCitaId: appointmentRef.id, updatedAt };
        if (lockSnapshot.exists()) {
          transaction.update(lockRef, lockUpdate);
        } else {
          transaction.set(lockRef, {
            id: lockRef.id,
            negocioId: input.negocioId,
            empleadoUid: preparation.aviso.empleadoUid,
            fechaLocal: preparation.fechaLocal,
            fechaLocalKey: preparation.fechaLocalKey,
            particion: group.partition,
            ...lockUpdate,
            createdAt: updatedAt,
          });
        }
      }
    });
  } catch (error) {
    const savedAppointment = await getDoc(appointmentRef).catch(() => null);
    if (!savedAppointment?.exists() || savedAppointment.data().estado !== "pendiente_de_aprobacion") {
      await deleteDoc(appointmentRef).catch((cleanupError) => console.warn("No se pudo limpiar la solicitud pendiente.", cleanupError));
      throw error;
    }
  }

  const reservation = { citaId: preparation.citaId, estado: "pendiente_de_aprobacion" as const, aviso: preparation.aviso };
  const noticeBatch = writeBatch(database);
  const noticeBody = `${reservation.aviso.clienteNombre} solicita ${reservation.aviso.servicioNombre} con ${reservation.aviso.empleadoNombre} el ${reservation.aviso.fecha}.`.slice(0, 500);
  const notificationData = {
    tipo: "nueva_solicitud_cita",
    titulo: "Nueva solicitud de cita",
    cuerpo: noticeBody,
    citaId: reservation.citaId,
    negocioId: input.negocioId,
    createdAt: serverTimestamp(),
    leida: false,
  };
  noticeBatch.set(clientNoticeRef, {
    ...notificationData,
    destinatarioId: user.uid,
    titulo: "Recibimos tu solicitud",
    cuerpo: `Tu solicitud de ${reservation.aviso.servicioNombre} con ${reservation.aviso.empleadoNombre} para el ${reservation.aviso.fecha} quedó pendiente de confirmación.`.slice(0, 500),
  });
  noticeBatch.set(employeeNoticeRef, { ...notificationData, destinatarioId: reservation.aviso.empleadoUid });
  noticeBatch.set(adminNoticeRef, { ...notificationData, destinatarioId: "admin" });

  try {
    await noticeBatch.commit();
    return { citaId: reservation.citaId, estado: reservation.estado, avisosEnviados: true };
  } catch (reason) {
    console.warn("No se pudieron guardar los avisos de la cita.", reason);
    return { citaId: reservation.citaId, estado: reservation.estado, avisosEnviados: false };
  }
}

export async function decideAppointment(action: "aprobarCita" | "rechazarCita", citaId: string) {
  if (!(await ensureFirebaseConfigured())) throw new Error("El servicio no está disponible.");
  const database = db;
  const user = firebaseAuth?.currentUser;
  if (!database || !user?.uid) throw new Error("Inicia sesión para continuar.");
  const appointmentRef = doc(database, "citas", citaId);
  const userRef = doc(database, "users", user.uid);
  const legacyRef = doc(database, "usuarios", user.uid);
  const employeeRoleRef = doc(database, "empleados", user.uid);
  const noticeRef = doc(collection(database, "notificaciones"));
  const nextState = action === "aprobarCita" ? "confirmada" : "rechazada";
  return runTransaction(database, async (transaction) => {
    const [appointmentSnapshot, userSnapshot, legacySnapshot, employeeRoleSnapshot] = await Promise.all([
      transaction.get(appointmentRef), transaction.get(userRef), transaction.get(legacyRef), transaction.get(employeeRoleRef),
    ]);
    if (!appointmentSnapshot.exists()) throw new Error("No encontramos esta cita.");
    const appointment = appointmentSnapshot.data();
    const profile = mergeProfileSources([
      userSnapshot.exists() ? { ...userSnapshot.data(), id: user.uid } as ProfileRecord : null,
      employeeRoleSnapshot.exists() ? { ...employeeRoleSnapshot.data(), id: user.uid } as ProfileRecord : null,
      legacySnapshot.exists() ? { ...legacySnapshot.data(), id: user.uid } as ProfileRecord : null,
    ]);
    const role = profileRole(profile);
    const assignedEmployee = appointment.empleadoUid === user.uid || appointment.empleadoId === user.uid;
    if (role !== "admin" && !(role === "empleado" && assignedEmployee)) throw Object.assign(new Error("Solo administración o el profesional asignado pueden responder."), { code: "permission-denied" });
    if (appointment.estado !== "pendiente_de_aprobacion") throw Object.assign(new Error("Esta cita ya recibió una respuesta."), { code: "failed-precondition" });
    if (nextState === "confirmada") {
      const businessId = String(appointment.negocioId ?? "");
      const employeeUid = String(appointment.empleadoUid ?? appointment.empleadoId ?? "");
      const startMs = appointmentMillis(appointment.inicio);
      const endMs = appointmentMillis(appointment.fin);
      const durationMin = Number(appointment.duracionMin);
      const invalidSchedule = () => Object.assign(
        new Error("El horario del negocio o del profesional cambió. Revisa la agenda antes de confirmar."),
        { code: "failed-precondition" },
      );
      if (!businessId || !employeeUid || startMs === null || endMs === null
        || !Number.isInteger(durationMin) || durationMin < 5 || durationMin > 480
        || endMs - startMs !== durationMin * 60_000) throw invalidSchedule();

      const localDate = hondurasDateForMillis(startMs);
      const dateParts = parseLocalDate(localDate);
      if (!dateParts || Number(appointment.fechaLocalKey) !== hondurasDateKeyMillis(localDate)) throw invalidSchedule();
      const dayId = String(dateParts.weekday);
      const [businessSnapshot, employeeSnapshot, hoursSnapshot, scheduleSnapshot] = await Promise.all([
        transaction.get(doc(database, "negocios", businessId)),
        transaction.get(doc(database, "negocios", businessId, "empleadosPublicos", employeeUid)),
        transaction.get(doc(database, "negocios", businessId, "horarios", dayId)),
        transaction.get(doc(database, "negocios", businessId, "empleados", employeeUid, "disponibilidad", dayId)),
      ]);
      const business = businessSnapshot.data();
      const employee = employeeSnapshot.data();
      const hours = hoursSnapshot.data();
      const schedule = scheduleSnapshot.data();
      if (!businessSnapshot.exists() || business?.activo !== true || business.reservasSparkPreparadas !== true
        || business.reservasSparkPreparando === true || !employeeSnapshot.exists()
        || employee?.negocioId !== businessId || employee.activo !== true || employee.publica !== true
        || employee.disponible !== true || !hoursSnapshot.exists() || hours?.activo !== true
        || !scheduleSnapshot.exists() || schedule?.activo !== true) throw invalidSchedule();

      let scheduleStillFits = false;
      try {
        scheduleStillFits = computeAvailableSlots({
          date: localDate,
          nowMs: Date.now(),
          serviceDurationMin: durationMin,
          opening: clockFromMinutes(hours.aperturaMin) || String(hours.apertura ?? ""),
          closing: clockFromMinutes(hours.cierreMin) || String(hours.cierre ?? ""),
          businessBreaks: Array.isArray(hours.recesos) ? hours.recesos : [],
          employeeStart: clockFromMinutes(schedule.inicioMin) || String(schedule.inicio ?? ""),
          employeeEnd: clockFromMinutes(schedule.finMin) || String(schedule.fin ?? ""),
          appointments: [],
          slotStepMin: 15,
        }).some((slot) => slot.inicioMs === startMs && slot.finMs === endMs);
      } catch {
        throw invalidSchedule();
      }
      if (!scheduleStillFits) throw invalidSchedule();
    }
    const now = serverTimestamp();
    if (nextState === "rechazada") {
      const employeeUid = String(appointment.empleadoUid ?? appointment.empleadoId ?? "");
      const fechaLocalKey = Number(appointment.fechaLocalKey);
      if (!Number.isSafeInteger(fechaLocalKey)) throw new Error("Esta cita todavía necesita preparación antes de modificar su horario.");
      const appointmentStartMs = appointmentMillis(appointment.inicio);
      const appointmentEndMs = appointmentMillis(appointment.fin);
      const durationMin = Number(appointment.duracionMin);
      if (appointmentStartMs === null || appointmentEndMs === null || !Number.isInteger(durationMin)
        || durationMin < 5 || durationMin > 480 || appointmentEndMs - appointmentStartMs !== durationMin * 60_000
        || fechaLocalKey !== hondurasDateKeyMillis(hondurasDateForMillis(appointmentStartMs))) {
        throw new Error("Esta cita todavía necesita preparación antes de modificar su horario.");
      }
      const localDayBounds = hondurasDayBounds(hondurasDateForMillis(appointmentStartMs));
      const blocks = blockKeysForInterval(appointmentStartMs, appointmentEndMs);
      if (!localDayBounds || blocks.length === 0) throw new Error("Los bloques de esta cita no coinciden; no se liberó el horario.");
      const groups = partitionBlockKeys(blocks, localDayBounds.startMs);
      if (groups.length === 0 || groups.length > APPOINTMENT_PARTITIONS_PER_DAY) throw new Error("Los bloques de esta cita no coinciden; no se liberó el horario.");
      const lockRefs = groups.map(({ partition }) => doc(
        database,
        "negocios",
        String(appointment.negocioId),
        "bloqueosCitas",
        appointmentLockId(employeeUid, fechaLocalKey, partition),
      ));
      const lockSnapshots = await Promise.all(lockRefs.map((reference) => transaction.get(reference)));
      for (const [index, group] of groups.entries()) {
        const lockSnapshot = lockSnapshots[index];
        const lockRef = lockRefs[index];
        const lockData = lockSnapshot.data();
        const lockMap = lockData?.bloques;
        if (!lockSnapshot.exists() || !lockMap || typeof lockMap !== "object" || Array.isArray(lockMap)) {
          throw new Error("No encontramos el registro protegido de esta cita. Pide a administración que revise la agenda.");
        }
        const nextMap: Record<string, boolean> = { ...lockMap as Record<string, boolean> };
        if (group.keys.some((key) => nextMap[key] !== true)) throw new Error("Los bloques de esta cita no coinciden; no se liberó el horario.");
        for (const key of group.keys) delete nextMap[key];
        transaction.update(lockRef, { bloques: nextMap, ultimaCitaId: citaId, updatedAt: now });
      }
    }
    transaction.update(appointmentRef, { estado: nextState, decisionPor: user.uid, decisionAt: now, updatedAt: now });
    transaction.set(noticeRef, {
      destinatarioId: String(appointment.clienteId ?? ""),
      tipo: nextState === "confirmada" ? "cita_confirmada" : "cita_rechazada",
      titulo: nextState === "confirmada" ? "Cita confirmada" : "Solicitud no aceptada",
      cuerpo: nextState === "confirmada" ? "El profesional confirmó tu hora. Tu cita ya está agendada." : "El profesional no pudo aceptar esa hora. El espacio ya está disponible para elegir otra fecha.",
      citaId,
      negocioId: String(appointment.negocioId ?? ""),
      createdAt: now,
      leida: false,
    });
    return { ok: true as const, estado: nextState };
  });
}

export async function startService(citaId: string) {
  return transitionService(citaId, "start");
}

export async function finishService(citaId: string) {
  return transitionService(citaId, "finish");
}

function transitionService(citaId: string, action: "start"): Promise<{ ok: true }>;
function transitionService(citaId: string, action: "finish"): Promise<{ ok: true; duracionRealMin: number }>;
async function transitionService(citaId: string, action: "start" | "finish"): Promise<{ ok: true } | { ok: true; duracionRealMin: number }> {
  if (!(await ensureFirebaseConfigured())) throw new Error("El servicio no está disponible.");
  const database = db;
  const user = firebaseAuth?.currentUser;
  if (!database || !user?.uid) throw new Error("Inicia sesión para continuar.");
  const appointmentRef = doc(database, "citas", citaId);
  const clientNoticeRef = doc(collection(database, "notificaciones"));
  const adminNoticeRef = doc(collection(database, "notificaciones"));
  return runTransaction(database, async (transaction) => {
    const appointmentSnapshot = await transaction.get(appointmentRef);
    if (!appointmentSnapshot.exists()) throw new Error("No encontramos esta cita.");
    const appointment = appointmentSnapshot.data();
    if (appointment.empleadoUid !== user.uid && appointment.empleadoId !== user.uid) {
      throw Object.assign(new Error("Solo el profesional asignado puede actualizar esta cita."), { code: "permission-denied" });
    }
    const now = serverTimestamp();
    let actualMinutes: number | undefined;
    let update: Record<string, unknown>;
    if (action === "start") {
      if (appointment.estado !== "confirmada") throw Object.assign(new Error("Solo puedes iniciar una cita confirmada."), { code: "failed-precondition" });
      update = { estado: "en_curso", startedAt: now, iniciadoPor: user.uid, updatedAt: now };
    } else {
      if (appointment.estado !== "en_curso") throw Object.assign(new Error("Solo puedes finalizar un servicio que ya inició."), { code: "failed-precondition" });
      const startedMs = appointmentMillis(appointment.startedAt);
      if (startedMs === null || startedMs >= Date.now()) throw Object.assign(new Error("La hora de inicio no es válida."), { code: "failed-precondition" });
      actualMinutes = Math.round(((Date.now() - startedMs) / 60_000) * 100) / 100;
      update = { estado: "finalizada", completedAt: now, finalizadoPor: user.uid, duracionRealMin: actualMinutes, updatedAt: now };
    }
    transaction.update(appointmentRef, update);
    const isStart = action === "start";
    const title = isStart ? "Servicio iniciado" : "Servicio finalizado";
    const body = isStart ? `${String(appointment.servicioNombre ?? "Tu servicio")} ya está en curso.` : `${String(appointment.servicioNombre ?? "Tu servicio")} terminó. Gracias por elegir EUFORIA.`;
    for (const [reference, recipient] of [[clientNoticeRef, String(appointment.clienteId ?? "")], [adminNoticeRef, "admin"]] as const) {
      transaction.set(reference, {
        destinatarioId: recipient,
        tipo: isStart ? "servicio_iniciado" : "servicio_finalizado",
        titulo: title,
        cuerpo: body,
        citaId,
        negocioId: String(appointment.negocioId ?? ""),
        createdAt: now,
        leida: false,
      });
    }
    return action === "finish" ? { ok: true as const, duracionRealMin: actualMinutes! } : { ok: true as const };
  });
}

export async function saveService(input: { businessId: string; id?: string; nombre: string; descripcion: string; precio: number; duracionMin: number; activo: boolean; recordatorioRegresoActivo?: boolean; periodoRegresoDias?: number; anticipacionRecordatorioDias?: number }) {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("El servicio no está disponible.");
  const { businessId, id, ...data } = input;
  const payload = { ...data, updatedAt: serverTimestamp() };
  if (id) {
    await setDoc(doc(db, "negocios", businessId, "servicios", id), payload, { merge: true });
    return id;
  }
  const reference = await addDoc(collection(db, "negocios", businessId, "servicios"), { ...payload, createdAt: serverTimestamp() });
  return reference.id;
}
