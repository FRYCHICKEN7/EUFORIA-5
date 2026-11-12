import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type WriteBatch,
} from "firebase/firestore";
import { appointmentLockId, partitionBlockKeys } from "../lib/appointment-blocks";

let testEnvironment: RulesTestEnvironment;

const adminUid = "admin-euforia";
const applicantUid = "applicant-euforia";
const businessId = "salon-euforia";
const applicantEmail = "persona@example.com";
const createdAt = new Date("2026-01-01T12:00:00.000Z");

function clientProfile(uid: string, email: string) {
  return {
    id: uid,
    email,
    role: "cliente",
    rol: "cliente",
    createdAt,
    name: "Persona de prueba",
    displayName: "Persona de prueba",
    phone: "12345678",
    profileImage: "",
    photoURL: "",
    aceptaRecordatoriosWhatsApp: true,
  };
}

function pendingApplication(uid: string, email: string) {
  return {
    ...clientProfile(uid, email),
    birthdayDay: "08",
    birthdayMonth: "03",
    estadoSolicitud: "pendiente",
    solicitadaAt: createdAt,
    updatedAt: createdAt,
  };
}

async function seedAdminOnly() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const adminProfile = {
      id: adminUid,
      email: "admin@example.com",
      role: "admin",
      rol: "admin",
      createdAt,
      name: "Administración",
      displayName: "Administración",
      phone: "12345678",
      profileImage: "",
      photoURL: "",
    };
    await setDoc(doc(firestore, "users", adminUid), adminProfile);
    await setDoc(doc(firestore, "usuarios", adminUid), adminProfile);
  });
}

async function seedAdminAndBusiness() {
  await seedAdminOnly();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "negocios", businessId), {
      nombre: "EUFORIA Beauty Studio",
      activo: true,
      modoNegocio: "multiEmpleado",
      createdAt,
      updatedAt: createdAt,
    });
  });
}

async function seedApplicant() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "users", applicantUid), clientProfile(applicantUid, applicantEmail));
    await setDoc(doc(firestore, "usuarios", applicantUid), clientProfile(applicantUid, applicantEmail));
    await setDoc(doc(firestore, "empleados", applicantUid), pendingApplication(applicantUid, applicantEmail));
  });
}

const bookingClientUid = "booking-client-euforia";
const bookingClientEmail = "booking-client@example.com";
const bookingEmployeeUid = "booking-employee-euforia";
const bookingStart = new Date("2026-12-07T14:00:00.000Z");

async function seedBookingScenario() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "users", bookingClientUid), clientProfile(bookingClientUid, bookingClientEmail));
    await setDoc(doc(firestore, "usuarios", bookingClientUid), clientProfile(bookingClientUid, bookingClientEmail));
    const staff = {
      ...clientProfile(bookingEmployeeUid, "booking-employee@example.com"),
      role: "empleado",
      rol: "empleado",
      negocioId: businessId,
      Empleado: "EMP-BOOKING",
      estadoSolicitud: "aprobada",
      activo: true,
      publica: true,
      disponible: true,
    };
    await setDoc(doc(firestore, "users", bookingEmployeeUid), staff);
    await setDoc(doc(firestore, "usuarios", bookingEmployeeUid), staff);
    await setDoc(doc(firestore, "empleados", bookingEmployeeUid), staff);
    await setDoc(doc(firestore, "negocios", businessId), {
      nombre: "EUFORIA Beauty Studio", activo: true, reservasSparkPreparadas: true,
      modoNegocio: "multiEmpleado", createdAt, updatedAt: createdAt,
    });
    await setDoc(doc(firestore, "negocios", businessId, "servicios", "corte"), {
      nombre: "Corte de cabello", precio: 120, duracionMin: 90, activo: true,
    });
    await setDoc(doc(firestore, "negocios", businessId, "horarios", "1"), {
      dia: 1, activo: true, apertura: "08:00", cierre: "17:00", aperturaMin: 480, cierreMin: 1020,
      recesos: [], recesosMin: [],
    });
    await setDoc(doc(firestore, "negocios", businessId, "empleados", bookingEmployeeUid), {
      id: bookingEmployeeUid, uid: bookingEmployeeUid, usuarioId: bookingEmployeeUid,
      negocioId: businessId, role: "empleado", rol: "empleado", Empleado: "EMP-BOOKING",
      name: "Profesional de prueba", nombre: "Profesional de prueba", displayName: "Profesional de prueba",
      email: "booking-employee@example.com", phone: "12345678", activo: true, publica: true, disponible: true,
    });
    await setDoc(doc(firestore, "negocios", businessId, "empleadosPublicos", bookingEmployeeUid), {
      id: bookingEmployeeUid, uid: bookingEmployeeUid, negocioId: businessId, Empleado: "EMP-BOOKING",
      name: "Profesional de prueba", nombre: "Profesional de prueba", displayName: "Profesional de prueba",
      profileImage: "", activo: true, publica: true, disponible: true,
    });
    await setDoc(doc(firestore, "negocios", businessId, "empleados", bookingEmployeeUid, "disponibilidad", "1"), {
      dia: 1, activo: true, inicio: "08:00", fin: "17:00", inicioMin: 480, finMin: 1020, updatedAt: createdAt,
    });
  });
}

function appointmentPayload(citaId: string, start: Date, durationMin = 90) {
  const startMs = start.getTime();
  const blockStart = Math.floor(startMs / (15 * 60_000));
  const bloques = Array.from({ length: Math.ceil(durationMin / 15) }, (_, index) => String(blockStart + index));
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tegucigalpa", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(start);
  const dateValues = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const fechaLocal = `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
  const [year, month, day] = fechaLocal.split("-").map(Number);
  const fechaLocalKey = Date.UTC(year, month - 1, day);
  const appointment = {
    negocioId: businessId,
    negocioNombre: "EUFORIA Beauty Studio",
    clienteId: bookingClientUid,
    clienteEmail: bookingClientEmail,
    clienteNombre: "Persona de prueba",
    clienteTelefono: "12345678",
    servicioId: "corte",
    servicioNombre: "Corte de cabello",
    precio: 120,
    duracionMin: durationMin,
    inicio: start,
    fin: new Date(startMs + durationMin * 60_000),
    fechaLocal,
    fechaLocalKey,
    empleadoId: bookingEmployeeUid,
    empleadoUid: bookingEmployeeUid,
    empleadoNombre: "Profesional de prueba",
    empleadoCodigo: "EMP-BOOKING",
    modoNegocio: "multiEmpleado",
    estado: "pendiente_de_aprobacion",
  };
  return { appointment, fechaLocal, fechaLocalKey, bloques, citaId };
}

async function commitBooking(
  firestore: unknown,
  citaId: string,
  start: Date,
  durationMin = 90,
  options: { blockKeys?: string[]; blockValue?: unknown; beforeCommit?: () => Promise<void> } = {},
) {
  const database = firestore as Firestore;
  const { appointment, fechaLocal, fechaLocalKey, bloques } = appointmentPayload(citaId, start, durationMin);
  const blocksForAppointment = options.blockKeys ?? bloques;
  const appointmentRef = doc(database, "citas", citaId);
  const preparedAt = serverTimestamp();
  await setDoc(appointmentRef, {
    ...appointment,
    estado: "preparando",
    createdAt: preparedAt,
    updatedAt: preparedAt,
  });

  const groups = partitionBlockKeys(blocksForAppointment, fechaLocalKey + 6 * 60 * 60_000);
  const lockRefs = groups.map(({ partition }) => doc(
    database,
    "negocios",
    businessId,
    "bloqueosCitas",
    appointmentLockId(bookingEmployeeUid, fechaLocalKey, partition),
  ));
  const lockSnapshots = await Promise.all(lockRefs.map((reference) => getDoc(reference)));
  const batch = writeBatch(database);
  const committedAt = serverTimestamp();
  batch.update(appointmentRef, { estado: "pendiente_de_aprobacion", updatedAt: committedAt });
  const blockValue = Object.prototype.hasOwnProperty.call(options, "blockValue") ? options.blockValue : true;
  for (const [index, group] of groups.entries()) {
    const lockRef = lockRefs[index];
    const lockSnapshot = lockSnapshots[index];
    const previous = lockSnapshot.data()?.bloques;
    const previousMap = previous && typeof previous === "object" && !Array.isArray(previous)
      ? previous as Record<string, unknown>
      : {};
    const blockMap: Record<string, unknown> = { ...previousMap };
    for (const key of group.keys) blockMap[key] = blockValue;
    if (lockSnapshot.exists()) {
      batch.update(lockRef, {
        bloques: blockMap,
        ultimaCitaId: citaId,
        updatedAt: committedAt,
      });
    } else {
      batch.set(lockRef, {
        id: lockRef.id,
        negocioId: businessId,
        empleadoUid: bookingEmployeeUid,
        fechaLocal,
        fechaLocalKey,
        particion: group.partition,
        bloques: blockMap,
        ultimaCitaId: citaId,
        createdAt: committedAt,
        updatedAt: committedAt,
      });
    }
  }
  await options.beforeCommit?.();

  try {
    await batch.commit();
  } catch (error) {
    await deleteDoc(appointmentRef).catch(() => undefined);
    throw error;
  }
}

async function rejectBooking(firestore: unknown, citaId: string, start: Date, durationMin = 90) {
  const database = firestore as Firestore;
  const { fechaLocalKey, bloques } = appointmentPayload(citaId, start, durationMin);
  const groups = partitionBlockKeys(bloques, fechaLocalKey + 6 * 60 * 60_000);
  const batch = writeBatch(database);
  const updatedAt = serverTimestamp();
  for (const group of groups) {
    const lockRef = doc(database, "negocios", businessId, "bloqueosCitas", appointmentLockId(bookingEmployeeUid, fechaLocalKey, group.partition));
    const lockSnapshot = await getDoc(lockRef);
    if (!lockSnapshot.exists()) throw new Error("Falta el bloqueo de prueba.");
    const previous = lockSnapshot.data().bloques as Record<string, boolean>;
    const next = { ...previous };
    for (const key of group.keys) delete next[key];
    batch.update(lockRef, { bloques: next, ultimaCitaId: citaId, updatedAt });
  }
  batch.update(doc(database, "citas", citaId), {
    estado: "rechazada", decisionPor: adminUid, decisionAt: updatedAt, updatedAt,
  });
  batch.set(doc(database, "notificaciones", `${citaId}-rechazo`), {
    destinatarioId: bookingClientUid,
    tipo: "cita_rechazada",
    titulo: "Solicitud no aceptada",
    cuerpo: "El espacio ya está disponible.",
    citaId,
    negocioId: businessId,
    createdAt: updatedAt,
    leida: false,
  });
  await batch.commit();
}

async function confirmBooking(firestore: unknown, citaId: string) {
  const database = firestore as Firestore;
  await updateDoc(doc(database, "citas", citaId), {
    estado: "confirmada",
    decisionPor: adminUid,
    decisionAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

function addBookingNotificationWrites(batch: WriteBatch, firestore: unknown, citaId: string) {
  const database = firestore as Parameters<typeof doc>[0];
  const createdAt = serverTimestamp();
  for (const [suffix, destinatarioId] of [["client", bookingClientUid], ["employee", bookingEmployeeUid], ["admin", "admin"]]) {
    batch.set(doc(database, "notificaciones", `${citaId}-${suffix}`), {
      destinatarioId,
      tipo: "nueva_solicitud_cita",
      titulo: "Nueva solicitud de cita",
      cuerpo: "Una persona solicitó una hora disponible.",
      citaId,
      negocioId: businessId,
      createdAt,
      leida: false,
    });
  }
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("reglas de registro y equipo", () => {
  beforeAll(async () => {
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    testEnvironment = await initializeTestEnvironment({
      projectId: "demo-euforia-rules",
      firestore: { rules, host: "127.0.0.1", port: 8080 },
    });
  });

  afterEach(async () => {
    await testEnvironment.clearFirestore();
  });

  afterAll(async () => {
    await testEnvironment.cleanup();
  });

  it("permite que una persona cree sus dos perfiles cliente y la solicitud pendiente en un solo lote", async () => {
    const firestore = testEnvironment.authenticatedContext(applicantUid, { email: applicantEmail }).firestore();
    const batch = writeBatch(firestore);
    const profile = {
      id: applicantUid,
      email: applicantEmail,
      role: "cliente",
      rol: "cliente",
      name: "Persona de prueba",
      displayName: "Persona de prueba",
      phone: "12345678",
      profileImage: "",
      photoURL: "",
      aceptaRecordatoriosWhatsApp: true,
      createdAt: serverTimestamp(),
    };
    batch.set(doc(firestore, "users", applicantUid), profile);
    batch.set(doc(firestore, "usuarios", applicantUid), profile);
    batch.set(doc(firestore, "empleados", applicantUid), {
      ...profile,
      estadoSolicitud: "pendiente",
      solicitadaAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  it("permite crear perfiles de cliente provisionales solo a administración y que el cliente cierre el cambio inicial", async () => {
    await seedAdminOnly();
    const uid = "admin-created-customer";
    const email = "nuevo-cliente@example.com";
    const adminDb = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    const batch = writeBatch(adminDb);
    const profile = {
      ...clientProfile(uid, email),
      mustChangePassword: true,
      createdAt: serverTimestamp(),
    };
    batch.set(doc(adminDb, "users", uid), profile);
    batch.set(doc(adminDb, "usuarios", uid), profile);
    await assertSucceeds(batch.commit());

    const customerDb = testEnvironment.authenticatedContext(uid, { email }).firestore();
    const passwordChange = writeBatch(customerDb);
    passwordChange.update(doc(customerDb, "users", uid), {
      mustChangePassword: false,
      passwordChangedAt: serverTimestamp(),
    });
    passwordChange.update(doc(customerDb, "usuarios", uid), {
      mustChangePassword: false,
      passwordChangedAt: serverTimestamp(),
    });
    await assertSucceeds(passwordChange.commit());

    const publicSignupDb = testEnvironment.authenticatedContext("self-provision-attempt", { email: "otra@example.com" }).firestore();
    await assertFails(setDoc(doc(publicSignupDb, "users", "self-provision-attempt"), {
      ...clientProfile("self-provision-attempt", "otra@example.com"),
      mustChangePassword: true,
      createdAt: serverTimestamp(),
    }));
  });

  it("impide al solicitante aprobarse a sí mismo o cambiar sus perfiles", async () => {
    await seedApplicant();
    const firestore = testEnvironment.authenticatedContext(applicantUid, { email: applicantEmail }).firestore();
    await assertFails(updateDoc(doc(firestore, "empleados", applicantUid), {
      role: "empleado",
      rol: "empleado",
      estadoSolicitud: "aprobada",
    }));
    await assertFails(updateDoc(doc(firestore, "users", applicantUid), {
      role: "empleado",
      rol: "empleado",
      negocioId: businessId,
      updatedAt: serverTimestamp(),
    }));
  });

  it("permite que administración apruebe en una sola operación y cree la membresía y el aviso", async () => {
    await seedAdminAndBusiness();
    await seedApplicant();
    const firestore = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    const batch = writeBatch(firestore);
    const updatedAt = serverTimestamp();
    batch.update(doc(firestore, "users", applicantUid), {
      role: "empleado", rol: "empleado", negocioId: businessId, birthdayDay: 8, birthdayMonth: 3, updatedAt,
    });
    batch.update(doc(firestore, "usuarios", applicantUid), {
      role: "empleado", rol: "empleado", negocioId: businessId, birthdayDay: 8, birthdayMonth: 3, updatedAt,
    });
    batch.update(doc(firestore, "empleados", applicantUid), {
      role: "empleado",
      rol: "empleado",
      birthdayDay: 8,
      birthdayMonth: 3,
      estadoSolicitud: "aprobada",
      Empleado: "EMP-APPLICANT",
      negocioId: businessId,
      aprobadaAt: serverTimestamp(),
      aprobadoPorUid: adminUid,
      activo: true,
      publica: true,
      disponible: false,
      updatedAt,
    });
    batch.set(doc(firestore, "negocios", businessId, "empleados", applicantUid), {
      id: applicantUid,
      uid: applicantUid,
      usuarioId: applicantUid,
      email: applicantEmail,
      name: "Persona de prueba",
      nombre: "Persona de prueba",
      displayName: "Persona de prueba",
      phone: "12345678",
      profileImage: "",
      photoURL: "",
      role: "empleado",
      rol: "empleado",
      estadoSolicitud: "aprobada",
      aprobadaAt: serverTimestamp(),
      aprobadoPorUid: adminUid,
      birthdayDay: 8,
      birthdayMonth: 3,
      negocioId: businessId,
      Empleado: "EMP-APPLICANT",
      activo: true,
      publica: true,
      disponible: false,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(firestore, "negocios", businessId, "empleadosPublicos", applicantUid), {
      id: applicantUid,
      uid: applicantUid,
      negocioId: businessId,
      Empleado: "EMP-APPLICANT",
      name: "Persona de prueba",
      nombre: "Persona de prueba",
      displayName: "Persona de prueba",
      profileImage: "",
      activo: true,
      publica: true,
      disponible: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(firestore, "notificaciones")), {
      destinatarioId: applicantUid,
      solicitanteUid: applicantUid,
      tipo: "solicitud_empleado_aceptada",
      titulo: "Solicitud aceptada",
      cuerpo: "Ya puedes ingresar como empleado.",
      createdAt: serverTimestamp(),
      leida: false,
    });
    await assertSucceeds(batch.commit());
  });

  it("expone el perfil público mínimo pero niega la membresía privada y el teléfono del empleado", async () => {
    await seedAdminAndBusiness();
    const employeeUid = "public-staff-euforia";
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      const profile = { ...clientProfile(employeeUid, "staff@example.com"), role: "empleado", rol: "empleado", negocioId: businessId };
      await setDoc(doc(firestore, "users", employeeUid), profile);
      await setDoc(doc(firestore, "usuarios", employeeUid), profile);
      await setDoc(doc(firestore, "empleados", employeeUid), {
        ...profile, estadoSolicitud: "aprobada", Empleado: "EMP-PUBLIC", activo: true, publica: true, disponible: true,
      });
      await setDoc(doc(firestore, "negocios", businessId, "empleados", employeeUid), {
        id: employeeUid, uid: employeeUid, usuarioId: employeeUid, negocioId: businessId,
        email: "staff@example.com", name: "Profesional Público", nombre: "Profesional Público",
        displayName: "Profesional Público", phone: "12345678", profileImage: "", role: "empleado", rol: "empleado",
        Empleado: "EMP-PUBLIC", activo: true, publica: true, disponible: true,
      });
      await setDoc(doc(firestore, "negocios", businessId, "empleadosPublicos", employeeUid), {
        id: employeeUid, uid: employeeUid, negocioId: businessId, Empleado: "EMP-PUBLIC",
        name: "Profesional Público", nombre: "Profesional Público", displayName: "Profesional Público",
        profileImage: "", activo: true, publica: true, disponible: true,
      });
      await setDoc(doc(firestore, "negocios", businessId, "empleados", employeeUid, "disponibilidad", "1"), {
        dia: 1, activo: true, inicio: "08:00", fin: "17:00", updatedAt: createdAt,
      });
    });

    const client = testEnvironment.authenticatedContext("catalog-client", { email: "client@example.com" }).firestore();
    await assertFails(getDoc(doc(client, "negocios", businessId, "empleados", employeeUid)));
    const publicProfile = await assertSucceeds(getDoc(doc(client, "negocios", businessId, "empleadosPublicos", employeeUid)));
    expect(publicProfile.data()).not.toHaveProperty("email");
    expect(publicProfile.data()).not.toHaveProperty("phone");
    await assertSucceeds(getDoc(doc(client, "negocios", businessId, "empleados", employeeUid, "disponibilidad", "1")));
  });

  it("permite al empleado guardar sus siete días y estado disponible solo en su negocio", async () => {
    await seedAdminAndBusiness();
    const employeeUid = "schedule-staff-euforia";
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      const profile = { ...clientProfile(employeeUid, "schedule@example.com"), role: "empleado", rol: "empleado", negocioId: businessId };
      await setDoc(doc(firestore, "users", employeeUid), profile);
      await setDoc(doc(firestore, "usuarios", employeeUid), profile);
      await setDoc(doc(firestore, "empleados", employeeUid), {
        ...profile, estadoSolicitud: "aprobada", Empleado: "EMP-SCHEDULE", activo: true, publica: true, disponible: false,
      });
      await setDoc(doc(firestore, "negocios", businessId, "empleados", employeeUid), {
        id: employeeUid, uid: employeeUid, usuarioId: employeeUid, negocioId: businessId,
        email: "schedule@example.com", name: "Empleado de prueba", nombre: "Empleado de prueba",
        displayName: "Empleado de prueba", phone: "12345678", profileImage: "", role: "empleado", rol: "empleado",
        Empleado: "EMP-SCHEDULE", activo: true, publica: true, disponible: false,
      });
      await setDoc(doc(firestore, "negocios", businessId, "empleadosPublicos", employeeUid), {
        id: employeeUid, uid: employeeUid, negocioId: businessId, Empleado: "EMP-SCHEDULE",
        name: "Empleado de prueba", nombre: "Empleado de prueba", displayName: "Empleado de prueba",
        profileImage: "", activo: true, publica: true, disponible: false,
      });
    });

    const employee = testEnvironment.authenticatedContext(employeeUid, { email: "schedule@example.com" }).firestore();
    const batch = writeBatch(employee);
    for (let dia = 0; dia < 7; dia += 1) {
      batch.set(doc(employee, "negocios", businessId, "empleados", employeeUid, "disponibilidad", String(dia)), {
        dia, activo: dia === 1, inicio: "08:00", fin: "17:00", inicioMin: 480, finMin: 1020, updatedAt: serverTimestamp(),
      });
    }
    batch.update(doc(employee, "empleados", employeeUid), { disponible: true, updatedAt: serverTimestamp() });
    batch.update(doc(employee, "negocios", businessId, "empleados", employeeUid), { disponible: true, updatedAt: serverTimestamp() });
    batch.update(doc(employee, "negocios", businessId, "empleadosPublicos", employeeUid), { disponible: true, updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());

    const otherClient = testEnvironment.authenticatedContext("schedule-stranger").firestore();
    await assertFails(updateDoc(doc(otherClient, "negocios", businessId, "empleados", employeeUid, "disponibilidad", "1"), {
      inicio: "09:00",
    }));
  });

  it("permite el rechazo a administración, conserva rol cliente y notifica solo a la persona", async () => {
    await seedAdminAndBusiness();
    await seedApplicant();
    const firestore = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, "empleados", applicantUid), {
      role: "cliente",
      rol: "cliente",
      estadoSolicitud: "rechazada",
      rechazadaAt: serverTimestamp(),
      rechazadaPorUid: adminUid,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(firestore, "notificaciones")), {
      destinatarioId: applicantUid,
      solicitanteUid: applicantUid,
      tipo: "solicitud_empleado_rechazada",
      titulo: "Solicitud revisada",
      cuerpo: "Tu cuenta sigue activa como cliente.",
      createdAt: serverTimestamp(),
      leida: false,
    });
    await assertSucceeds(batch.commit());
  });

  it("no permite que una persona ajena lea solicitudes ni que un cliente cree negocios", async () => {
    await seedAdminAndBusiness();
    await seedApplicant();
    const stranger = testEnvironment.authenticatedContext("stranger-euforia", { email: "otra@example.com" }).firestore();
    await assertFails(getDocs(query(collection(stranger, "empleados"), where("estadoSolicitud", "==", "pendiente"))));
    await assertFails(updateDoc(doc(stranger, "empleados", applicantUid), {
      role: "empleado",
      rol: "empleado",
      estadoSolicitud: "aprobada",
    }));
    await assertFails(setDoc(doc(stranger, "negocios", "negocio-no-autorizado"), {
      nombre: "No autorizado",
      activo: true,
      createdAt: serverTimestamp(),
    }));
  });

  it("no concede permisos de administración cuando los perfiles tienen roles contradictorios", async () => {
    await seedAdminAndBusiness();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "usuarios", adminUid), {
        role: "cliente",
        rol: "cliente",
      });
    });
    const inconsistentAdmin = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    await assertFails(updateDoc(doc(inconsistentAdmin, "negocios", businessId), { nombre: "No debe cambiar" }));
  });

  it("permite a administración crear el negocio inicial desde la app", async () => {
    await seedAdminOnly();
    const firestore = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    await assertSucceeds(setDoc(doc(firestore, "negocios", "euforia-beauty-studio"), {
      nombre: "EUFORIA Beauty Studio",
      activo: true,
      modoNegocio: "multiEmpleado",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it("no permite crear una membresía o un aviso aislados", async () => {
    await seedAdminAndBusiness();
    await seedApplicant();
    const firestore = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    await assertFails(setDoc(doc(firestore, "negocios", businessId, "empleados", applicantUid), {
      uid: applicantUid,
      usuarioId: applicantUid,
      negocioId: businessId,
      role: "empleado",
      rol: "empleado",
      activo: true,
      publica: true,
      disponible: false,
    }));
    await assertFails(setDoc(doc(collection(firestore, "notificaciones")), {
      destinatarioId: applicantUid,
      solicitanteUid: applicantUid,
      tipo: "solicitud_empleado_aceptada",
      titulo: "Solicitud aceptada",
      cuerpo: "Aviso aislado no autorizado.",
      createdAt: serverTimestamp(),
      leida: false,
    }));
  });

  it("permite registrar y cerrar avisos WhatsApp solo con transiciones administrativas", async () => {
    await seedAdminAndBusiness();
    const admin = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    const reminderRef = doc(admin, "recordatoriosWhatsApp", "cita-a1");
    await assertSucceeds(setDoc(reminderRef, {
      id: "cita-a1",
      negocioId: businessId,
      clienteId: applicantUid,
      tipo: "cita",
      citaId: "a1",
      servicioId: "s1",
      servicioNombre: "Corte",
      fechaProgramada: serverTimestamp(),
      clienteNombre: "Persona de prueba",
      clienteTelefono: "12345678",
      estado: "preparado",
      preparadoAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      actualizadoPorUid: adminUid,
    }));
    await assertSucceeds(updateDoc(reminderRef, {
      estado: "enviado",
      enviadoAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      actualizadoPorUid: adminUid,
    }));
    await assertFails(updateDoc(reminderRef, {
      estado: "preparado",
      preparadoAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      actualizadoPorUid: adminUid,
    }));

    const customer = testEnvironment.authenticatedContext(applicantUid, { email: applicantEmail }).firestore();
    await assertFails(setDoc(doc(customer, "recordatoriosWhatsApp", "aviso-ajeno"), {
      id: "aviso-ajeno",
      negocioId: businessId,
      clienteId: applicantUid,
      tipo: "cita",
      fechaProgramada: serverTimestamp(),
      clienteNombre: "Persona de prueba",
      clienteTelefono: "12345678",
      estado: "preparado",
      preparadoAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      actualizadoPorUid: applicantUid,
    }));
  });

  it("permite reservar en Honduras con preparación privada y bloqueos atómicos", async () => {
    await seedBookingScenario();
    await seedAdminOnly();
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertSucceeds(commitBooking(client, "cita-valida", bookingStart));

    const notificationBatch = writeBatch(client);
    addBookingNotificationWrites(notificationBatch, client, "cita-valida");
    await assertSucceeds(notificationBatch.commit());
    const clientNotice = await assertSucceeds(getDoc(doc(client, "notificaciones", "cita-valida-client")));
    expect(clientNotice.data()?.destinatarioId).toBe(bookingClientUid);

    const otherClientUid = "other-booking-client";
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const profile = clientProfile(otherClientUid, "other-booking-client@example.com");
      await setDoc(doc(context.firestore(), "users", otherClientUid), profile);
      await setDoc(doc(context.firestore(), "usuarios", otherClientUid), profile);
    });
    const anotherClient = testEnvironment.authenticatedContext(otherClientUid).firestore();
    await assertFails(getDoc(doc(anotherClient, "citas", "cita-valida")));
    const lockId = appointmentLockId(bookingEmployeeUid, Date.UTC(2026, 11, 7), 8);
    const lock = await assertSucceeds(getDoc(doc(anotherClient, "negocios", businessId, "bloqueosCitas", lockId)));
    expect(Object.values(lock.data()?.bloques ?? {}).every((value) => value === true)).toBe(true);
    expect(lock.data()).not.toHaveProperty("clienteId");
    expect(lock.data()).not.toHaveProperty("clienteTelefono");
    const availabilityQuery = query(
      collection(anotherClient, "negocios", businessId, "bloqueosCitas"),
      where("empleadoUid", "==", bookingEmployeeUid),
      where("fechaLocalKey", "==", Date.UTC(2026, 11, 7)),
    );
    expect((await assertSucceeds(getDocs(availabilityQuery))).size).toBeGreaterThan(0);

    const employee = testEnvironment.authenticatedContext(bookingEmployeeUid, { email: "booking-employee@example.com" }).firestore();
    await assertSucceeds(getDoc(doc(employee, "negocios", businessId, "bloqueosCitas", lockId)));
    const otherLockId = appointmentLockId("other-employee-euforia", Date.UTC(2026, 11, 7), 8);
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "negocios", businessId, "bloqueosCitas", otherLockId), {
        id: otherLockId, negocioId: businessId, empleadoUid: "other-employee-euforia", bloques: { "123": true },
      });
    });
    await assertFails(getDoc(doc(employee, "negocios", businessId, "bloqueosCitas", otherLockId)));
    await assertFails(getDocs(collection(employee, "negocios", businessId, "bloqueosCitas")));
    const admin = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    expect((await assertSucceeds(getDocs(collection(admin, "negocios", businessId, "bloqueosCitas")))).size).toBeGreaterThan(0);
  });

  it("permite confirmar cuando el negocio, el profesional y el horario siguen vigentes", async () => {
    await seedBookingScenario();
    await seedAdminOnly();
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertSucceeds(commitBooking(client, "cita-horario-vigente", bookingStart));
    const admin = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    await assertSucceeds(confirmBooking(admin, "cita-horario-vigente"));
  });

  it("no permite confirmar si el negocio cerró las reservas después de la solicitud", async () => {
    await seedBookingScenario();
    await seedAdminOnly();
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertSucceeds(commitBooking(client, "cita-negocio-cerrado", bookingStart));
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "negocios", businessId), { reservasSparkPreparadas: false });
    });
    const admin = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    await assertFails(confirmBooking(admin, "cita-negocio-cerrado"));
  });

  it("no permite confirmar si el horario del profesional ya no cubre la solicitud", async () => {
    await seedBookingScenario();
    await seedAdminOnly();
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertSucceeds(commitBooking(client, "cita-horario-modificado", bookingStart));
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "negocios", businessId, "empleados", bookingEmployeeUid, "disponibilidad", "1"), {
        fin: "08:30",
        finMin: 510,
      });
    });
    const admin = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    await assertFails(confirmBooking(admin, "cita-horario-modificado"));
  });

  it("impide confirmar una solicitud si la agenda se cerró después de preparar el borrador", async () => {
    await seedBookingScenario();
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertFails(commitBooking(client, "cita-agenda-cerrada", bookingStart, 90, {
      beforeCommit: async () => {
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
          await updateDoc(doc(context.firestore(), "negocios", businessId), {
            reservasSparkPreparadas: false,
            reservasSparkPreparando: true,
          });
        });
      },
    }));
    const lockId = appointmentLockId(bookingEmployeeUid, Date.UTC(2026, 11, 7), 8);
    await assertFails(getDoc(doc(client, "negocios", businessId, "bloqueosCitas", lockId)));
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const lock = await getDoc(doc(context.firestore(), "negocios", businessId, "bloqueosCitas", lockId));
      expect(lock.exists()).toBe(false);
    });
  });

  it("no permite guardar datos personales en el registro público de ocupación", async () => {
    await seedBookingScenario();
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertFails(commitBooking(client, "cita-sin-datos-privados", bookingStart, 90, { blockValue: bookingClientEmail }));
  });

  it("protege los 32 bloques completos de una cita de ocho horas sin exceder Rules Emulator", async () => {
    await seedBookingScenario();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "negocios", businessId, "servicios", "corte"), { duracionMin: 480 });
    });
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertSucceeds(commitBooking(client, "cita-maxima", new Date("2026-12-07T15:00:00.000Z"), 480));
    for (const [partition, expectedSize] of Array.from({ length: 8 }, (_, index) => [9 + index, 4] as const)) {
      const lockId = appointmentLockId(bookingEmployeeUid, Date.UTC(2026, 11, 7), partition);
      const lock = await assertSucceeds(getDoc(doc(client, "negocios", businessId, "bloqueosCitas", lockId)));
      expect(Object.keys(lock.data()?.bloques ?? {})).toHaveLength(expectedSize);
    }
  });

  it("rechaza una segunda reserva que intenta ocupar bloques que ya pertenecen a otra cita", async () => {
    await seedBookingScenario();
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertSucceeds(commitBooking(client, "cita-primera", bookingStart));

    await assertFails(commitBooking(client, "cita-solapada", bookingStart, 90));
    await assertFails(getDoc(doc(client, "citas", "cita-solapada")));
  });

  it("permite actualizar el candado con otra cita del mismo día que no se cruza", async () => {
    await seedBookingScenario();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "negocios", businessId, "servicios", "corte"), { duracionMin: 15 });
    });
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertSucceeds(commitBooking(client, "cita-mañana", bookingStart, 15));

    const lockRef = doc(client, "negocios", businessId, "bloqueosCitas", appointmentLockId(bookingEmployeeUid, Date.UTC(2026, 11, 7), 8));
    const laterStart = new Date(bookingStart.getTime() + 15 * 60_000);
    await assertSucceeds(commitBooking(client, "cita-mediodia", laterStart, 15));

    const updatedLock = await getDoc(lockRef);
    expect(Object.keys(updatedLock.data()?.bloques ?? {})).toHaveLength(2);
  });

  it("al rechazar una cita de 90 minutos libera solo sus bloques compartidos con otra cita", async () => {
    await seedBookingScenario();
    await seedAdminOnly();
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertSucceeds(commitBooking(client, "cita-primera", bookingStart, 90));
    const secondStart = new Date(bookingStart.getTime() + 90 * 60_000);
    await assertSucceeds(commitBooking(client, "cita-segunda", secondStart, 90));

    const admin = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    await assertSucceeds(rejectBooking(admin, "cita-primera", bookingStart, 90));
    const lockId = appointmentLockId(bookingEmployeeUid, Date.UTC(2026, 11, 7), 9);
    const lockRef = doc(admin, "negocios", businessId, "bloqueosCitas", lockId);
    const afterRelease = await getDoc(lockRef);
    const firstBlock = String(Math.floor(bookingStart.getTime() / (15 * 60_000)));
    const firstBlockAtSharedPartition = String(Number(firstBlock) + 4);
    const secondBlockAtSharedPartition = String(Number(firstBlock) + 6);
    expect(afterRelease.data()?.bloques?.[firstBlockAtSharedPartition]).toBeUndefined();
    expect(afterRelease.data()?.bloques?.[secondBlockAtSharedPartition]).toBe(true);

    await assertSucceeds(commitBooking(client, "cita-horario-liberado", bookingStart, 90));
    const afterReuse = await getDoc(lockRef);
    expect(afterReuse.data()?.bloques?.[firstBlockAtSharedPartition]).toBe(true);
    expect(afterReuse.data()?.bloques?.[secondBlockAtSharedPartition]).toBe(true);
  });

  it("no permite rechazar una cita si la misma operación no retira sus bloqueos", async () => {
    await seedBookingScenario();
    await seedAdminOnly();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "negocios", businessId, "servicios", "corte"), { duracionMin: 15 });
    });
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertSucceeds(commitBooking(client, "cita-sin-liberacion", bookingStart, 15));
    const admin = testEnvironment.authenticatedContext(adminUid, { email: "admin@example.com" }).firestore();
    const batch = writeBatch(admin);
    const updatedAt = serverTimestamp();
    batch.update(doc(admin, "citas", "cita-sin-liberacion"), {
      estado: "rechazada", decisionPor: adminUid, decisionAt: updatedAt, updatedAt,
    });
    batch.set(doc(admin, "notificaciones", "cita-sin-liberacion-rechazo"), {
      destinatarioId: bookingClientUid,
      tipo: "cita_rechazada",
      titulo: "Solicitud no aceptada",
      cuerpo: "El espacio ya está disponible.",
      citaId: "cita-sin-liberacion",
      negocioId: businessId,
      createdAt: updatedAt,
      leida: false,
    });
    await assertFails(batch.commit());
  });

  it("rechaza una cita si no bloquea todos los intervalos de su duración", async () => {
    await seedBookingScenario();
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    const shortBlocks = appointmentPayload("cita-bloque-incompleto", bookingStart).bloques.slice(0, 1);
    await assertFails(commitBooking(client, "cita-bloque-incompleto", bookingStart, 90, { blockKeys: shortBlocks }));
  });

  it("rechaza una reserva que intenta empezar fuera del horario semanal del negocio o del profesional", async () => {
    await seedBookingScenario();
    const client = testEnvironment.authenticatedContext(bookingClientUid, { email: bookingClientEmail }).firestore();
    await assertFails(commitBooking(client, "cita-antes-de-apertura", new Date("2026-12-07T13:45:00.000Z")));
  });

});
