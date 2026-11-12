import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { db, ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";
import { mergeProfileSources, profileRole, type ProfileRecord } from "@/lib/roles";
import { planLegacyAppointmentLocks, AppointmentPlanError } from "@/lib/appointment-migration";
import { appointmentMillis } from "@/lib/appointments";

const MAX_EXISTING_LOCKS = 5000;
const BATCH_WRITE_LIMIT = 450;
const PREPARATION_LEASE_MS = 15 * 60_000;

export type AppointmentPreparationResult = {
  citasRevisadas: number;
  espaciosPreparados: number;
  espaciosAntiguosRetirados: number;
};

type MigrationOperation =
  | { kind: "set"; reference: DocumentReference; data: DocumentData }
  | { kind: "delete"; reference: DocumentReference };

function preparationUnavailable() {
  return new Error("No pudimos terminar la preparación. Las reservas siguen cerradas. Revisa tu conexión e inténtalo de nuevo.");
}

async function verifyAdmin(database: NonNullable<typeof db>, uid: string) {
  const [userSnapshot, employeeSnapshot, legacySnapshot] = await Promise.all([
    getDoc(doc(database, "users", uid)),
    getDoc(doc(database, "empleados", uid)),
    getDoc(doc(database, "usuarios", uid)),
  ]);
  const profile = mergeProfileSources([
    userSnapshot.exists() ? { ...userSnapshot.data(), id: uid } as ProfileRecord : null,
    employeeSnapshot.exists() ? { ...employeeSnapshot.data(), id: uid } as ProfileRecord : null,
    legacySnapshot.exists() ? { ...legacySnapshot.data(), id: uid } as ProfileRecord : null,
  ]);
  if (profileRole(profile) !== "admin") throw new Error("Solo administración puede preparar la agenda.");
}

function dateMillis(value: unknown): number | null {
  return appointmentMillis(value);
}

function customerAppointmentCandidate(id: string, data: DocumentData) {
  return {
    id,
    estado: String(data.estado ?? ""),
    empleadoUid: typeof data.empleadoUid === "string" ? data.empleadoUid : undefined,
    empleadoId: typeof data.empleadoId === "string" ? data.empleadoId : undefined,
    inicioMs: dateMillis(data.inicio),
    finMs: dateMillis(data.fin),
    duracionMin: Number.isInteger(data.duracionMin) ? Number(data.duracionMin) : null,
    holdExpiresAtMs: dateMillis(data.holdExpiresAt),
    createdAtMs: dateMillis(data.createdAt),
  };
}

export async function prepareExistingBusinessAppointments(businessId: string): Promise<AppointmentPreparationResult> {
  if (!(await ensureFirebaseConfigured()) || !db || !firebaseAuth) throw preparationUnavailable();
  const database = db;
  const user = firebaseAuth.currentUser;
  if (!user?.uid) throw new Error("Inicia sesión para preparar la agenda.");
  await verifyAdmin(database, user.uid);

  const businessRef = doc(database, "negocios", businessId);
  const initialBusiness = await getDoc(businessRef);
  if (!initialBusiness.exists() || initialBusiness.data().activo !== true) {
    throw new Error("Elige un negocio activo para preparar la agenda.");
  }

  await runTransaction(database, async (transaction) => {
    const businessSnapshot = await transaction.get(businessRef);
    if (!businessSnapshot.exists() || businessSnapshot.data().activo !== true) {
      throw new Error("El negocio dejó de estar activo. Actualiza la pantalla e inténtalo de nuevo.");
    }
    const business = businessSnapshot.data();
    const startedAt = dateMillis(business.reservasSparkPreparandoAt);
    if (business.reservasSparkPreparando === true && startedAt !== null
      && Date.now() - startedAt < PREPARATION_LEASE_MS) {
      throw new Error("La agenda ya se está preparando. Espera a que termine antes de iniciar otra vez.");
    }
    transaction.update(businessRef, {
      reservasSparkPreparadas: false,
      reservasSparkPreparando: true,
      reservasSparkPreparandoAt: serverTimestamp(),
      reservasSparkPreparandoPor: user.uid,
      updatedAt: serverTimestamp(),
    });
  });

  let clearLease = true;
  try {
    const appointmentSnapshot = await getDocs(query(
      collection(database, "citas"),
      where("negocioId", "==", businessId),
      limit(501),
    ));
    const candidates = appointmentSnapshot.docs.map((item) => customerAppointmentCandidate(item.id, item.data()));
    const plan = planLegacyAppointmentLocks(businessId, candidates, Date.now());

    const existingLocks = await getDocs(query(
      collection(database, "negocios", businessId, "bloqueosCitas"),
      limit(MAX_EXISTING_LOCKS + 1),
    ));
    if (existingLocks.size > MAX_EXISTING_LOCKS) {
      throw new AppointmentPlanError("Hay demasiados espacios de horario antiguos para revisar. La agenda sigue cerrada; pide ayuda antes de abrir las reservas.");
    }
    const existingById = new Map(existingLocks.docs.map((item) => [item.id, item.data()]));
    const expectedIds = new Set(plan.map((item) => item.id));
    const operations: MigrationOperation[] = plan.map((item) => {
      const reference = doc(database, "negocios", businessId, "bloqueosCitas", item.id);
      const previous = existingById.get(item.id);
      const data: DocumentData = {
        id: item.id,
        negocioId: item.negocioId,
        empleadoUid: item.empleadoUid,
        fechaLocal: item.fechaLocal,
        fechaLocalKey: item.fechaLocalKey,
        particion: item.particion,
        bloques: item.bloques,
        ultimaCitaId: item.ultimaCitaId,
        createdAt: previous?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      return { kind: "set", reference, data };
    });
    for (const existing of existingLocks.docs) {
      if (!expectedIds.has(existing.id)) {
        operations.push({
          kind: "delete",
          reference: doc(database, "negocios", businessId, "bloqueosCitas", existing.id),
        });
      }
    }

    for (let offset = 0; offset < operations.length; offset += BATCH_WRITE_LIMIT) {
      const batch = writeBatch(database);
      for (const operation of operations.slice(offset, offset + BATCH_WRITE_LIMIT)) {
        if (operation.kind === "set") batch.set(operation.reference, operation.data);
        else batch.delete(operation.reference);
      }
      await batch.commit();
    }

    await updateDoc(businessRef, {
      reservasSparkPreparadas: true,
      reservasSparkPreparando: false,
      reservasSparkPreparandoAt: deleteField(),
      reservasSparkPreparandoPor: deleteField(),
      updatedAt: serverTimestamp(),
    });
    clearLease = false;
    return {
      citasRevisadas: appointmentSnapshot.size,
      espaciosPreparados: plan.length,
      espaciosAntiguosRetirados: existingLocks.docs.filter((item) => !expectedIds.has(item.id)).length,
    };
  } catch (reason) {
    if (clearLease) {
      await updateDoc(businessRef, {
        reservasSparkPreparadas: false,
        reservasSparkPreparando: false,
        reservasSparkPreparandoAt: deleteField(),
        reservasSparkPreparandoPor: deleteField(),
        updatedAt: serverTimestamp(),
      }).catch((leaseError) => console.warn("No se pudo liberar el estado de preparación de la agenda.", leaseError));
    }
    if (reason instanceof AppointmentPlanError) throw reason;
    console.warn("No se pudo terminar la preparación de la agenda.", reason);
    throw preparationUnavailable();
  }
}
