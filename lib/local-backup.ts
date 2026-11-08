import { Platform } from "react-native";
import { collection, getDocs } from "firebase/firestore";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { db, ensureFirebaseConfigured } from "@/lib/firebase";

const SECRET_KEY = /(password|passwd|secret|credential|token|expo.?push|push.?token|api.?key|private.?key|authorization|refresh.?token|access.?token|identity|identidad)/i;
const CLIENT_ROLES = new Set(["cliente", "customer", "client"]);

function clean(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clean);
  const object = value as Record<string, unknown> & { toDate?: () => Date; toMillis?: () => number };
  if (typeof object.toDate === "function") return object.toDate().toISOString();
  if (typeof object.toMillis === "function") return new Date(object.toMillis()).toISOString();
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(object)) {
    if (!SECRET_KEY.test(key) && key !== "dispositivos") result[key] = clean(nested);
  }
  return result;
}

async function readRows(path: string[]): Promise<Record<string, unknown>[]> {
  const snapshot = await getDocs(collection(db!, path.join("/")));
  return snapshot.docs.map((item) => ({ id: item.id, ...(clean(item.data()) as Record<string, unknown>) }));
}

export async function createLocalBusinessBackup() {
  if (!(await ensureFirebaseConfigured()) || !db) throw new Error("La conexión con los datos no está disponible.");
  const businesses = await readRows(["negocios"]);
  const businessDetails = await Promise.all(businesses.map(async (business) => {
    const id = String(business.id);
    const [services, schedules, businessHours] = await Promise.all([
      readRows(["negocios", id, "servicios"]),
      readRows(["negocios", id, "empleados"]),
      readRows(["negocios", id, "horarios"]),
    ]);
    const employeesWithHours = await Promise.all(schedules.map(async (employee) => ({
      ...employee,
      disponibilidad: await readRows(["negocios", id, "empleados", String(employee.id), "disponibilidad"]),
    })));
    return { ...business, servicios: services, horariosSemanales: businessHours, empleadosYDisponibilidad: employeesWithHours } as Record<string, unknown>;
  }));

  const [employeeProfiles, userProfiles, legacyUserProfiles, appointments, reminderHistory] = await Promise.all([
    readRows(["empleados"]), readRows(["users"]), readRows(["usuarios"]), readRows(["citas"]), readRows(["recordatoriosWhatsApp"]),
  ]);
  const clientRows = [...userProfiles, ...legacyUserProfiles].filter((profile) => {
    const role = String(profile.role ?? profile.rol ?? "").toLowerCase();
    return CLIENT_ROLES.has(role);
  });
  const clientsByUid = new Map<string, Record<string, unknown>>();
  clientRows.forEach((profile) => {
    const uid = String(profile.id ?? "");
    if (!uid) return;
    clientsByUid.set(uid, { ...clientsByUid.get(uid), ...profile });
  });

  return {
    format: "euforia-local-business-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    businessIdentity: businessDetails.map(({ id, nombre, nombreNegocio, name }) => ({ id, nombre: nombre ?? nombreNegocio ?? name ?? "EUFORIA" })),
    collections: {
      businesses: businessDetails,
      services: businessDetails.flatMap((business) => Array.isArray(business.servicios) ? business.servicios.map((service) => ({ negocioId: business.id, ...service })) : []),
      businessHours: businessDetails.map(({ id, horario, horarios, horariosSemanales, horas, horarioAtencion, empleadosYDisponibilidad }) => ({ id, horario, horarios, horariosSemanales, horas, horarioAtencion, empleadosYDisponibilidad })),
      employees: employeeProfiles,
      clients: [...clientsByUid.values()],
      appointments,
      whatsappReminderHistory: reminderHistory,
    },
  };
}

export async function saveLocalBusinessBackup(backup: Awaited<ReturnType<typeof createLocalBusinessBackup>>) {
  const json = JSON.stringify(backup, null, 2);
  const filename = `euforia-respaldo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  if (Platform.OS === "android") {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return { saved: false as const, cancelled: true as const };
    const uri = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, filename, "application/json");
    await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
    return { saved: true as const, cancelled: false as const };
  }
  if (Platform.OS === "ios") {
    const cache = FileSystem.cacheDirectory;
    if (!cache) throw new Error("No hay espacio temporal disponible para preparar el archivo.");
    const uri = `${cache}${filename}`;
    await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
    if (!(await Sharing.isAvailableAsync())) throw new Error("No está disponible la opción para guardar o compartir archivos en este dispositivo.");
    await Sharing.shareAsync(uri, { mimeType: "application/json", UTI: "public.json", dialogTitle: "Guardar respaldo de EUFORIA" });
    return { saved: false as const, cancelled: false as const, shared: true as const };
  }
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    URL.revokeObjectURL(url);
    return { saved: true as const, cancelled: false as const };
  }
  throw new Error("El respaldo local no está disponible en esta plataforma.");
}
