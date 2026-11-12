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
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

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
});
