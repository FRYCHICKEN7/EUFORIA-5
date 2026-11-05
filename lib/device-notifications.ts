import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

const CHANNEL_ID = "euforia";
const pushedUidsKey = "euforia.push.registeredUid";
const promptKey = (uid: string) => `euforia.push.prompted.${uid}`;
const bootstrapJobs = new Map<string, Promise<void>>();
const bootstrapCompletedUids = new Set<string>();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type DeviceNotificationStatus =
  | "unsupported"
  | "needs-project"
  | "permission-denied"
  | "permission-ready"
  | "registered"
  | "error";

export type DeviceNotificationResult = {
  status: DeviceNotificationStatus;
  message: string;
};

export function getExpoProjectId(): string | null {
  const id = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export async function getDeviceNotificationStatus(uid: string): Promise<DeviceNotificationStatus> {
  if (Platform.OS === "web") return "unsupported";
  if (!getExpoProjectId()) return "needs-project";
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return "permission-denied";
    return (await SecureStore.getItemAsync(pushedUidsKey)) === uid ? "registered" : "permission-ready";
  } catch {
    return "error";
  }
}

async function registerGrantedDevice(uid: string): Promise<DeviceNotificationResult> {
  if (Platform.OS === "web") {
    return { status: "unsupported", message: "Las notificaciones push requieren la aplicación instalada en Android o iOS." };
  }
  const projectId = getExpoProjectId();
  if (!projectId) {
    return { status: "needs-project", message: "Falta asociar el ID del proyecto Expo/EAS para registrar notificaciones push." };
  }
  if (!db) return { status: "error", message: "Firebase no está configurado para registrar este dispositivo." };

  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "EUFORIA",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 150, 250],
        lightColor: "#D85C7A",
      });
    }
    let permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) permissions = await Notifications.requestPermissionsAsync();
    if (!permissions.granted) {
      return { status: "permission-denied", message: "El permiso está desactivado. Puedes cambiarlo en los ajustes del teléfono." };
    }

    const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
    let deviceId = await SecureStore.getItemAsync("euforia.push.deviceId");
    if (!deviceId) {
      deviceId = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      await SecureStore.setItemAsync("euforia.push.deviceId", deviceId);
    }
    await setDoc(doc(db, "usuarios", uid, "dispositivos", deviceId), {
      token: expoToken.data,
      provider: "expo",
      platform: Platform.OS,
      enabled: true,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await SecureStore.setItemAsync(pushedUidsKey, uid);
    return { status: "registered", message: "Notificaciones push activadas en este dispositivo." };
  } catch (error) {
    console.warn("No se pudo registrar el token push de EUFORIA.", (error as { code?: string })?.code);
    return { status: "error", message: "No se pudo registrar el dispositivo. Verifica el proyecto EAS, las credenciales push y las Rules de Firestore." };
  }
}

export async function enableDeviceNotifications(uid: string): Promise<DeviceNotificationResult> {
  if (Platform.OS === "web") {
    return { status: "unsupported", message: "Las notificaciones push requieren la aplicación instalada en Android o iOS." };
  }
  if (!getExpoProjectId()) {
    return { status: "needs-project", message: "Falta asociar el ID del proyecto Expo/EAS para registrar notificaciones push." };
  }
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) {
      const requested = await Notifications.requestPermissionsAsync();
      if (!requested.granted) {
        return { status: "permission-denied", message: "El permiso está desactivado. Actívalo en los ajustes del teléfono y vuelve a intentarlo." };
      }
    }
    return await registerGrantedDevice(uid);
  } catch {
    return { status: "error", message: "No se pudo solicitar permiso de notificaciones en este dispositivo." };
  }
}

export function bootstrapDeviceNotifications(uid: string): Promise<void> {
  if (bootstrapCompletedUids.has(uid)) return Promise.resolve();
  const existing = bootstrapJobs.get(uid);
  if (existing) return existing;
  const job = (async () => {
    if (Platform.OS === "web" || !getExpoProjectId()) return;
    try {
      const permissions = await Notifications.getPermissionsAsync();
      if (permissions.granted) {
        await registerGrantedDevice(uid);
        bootstrapCompletedUids.add(uid);
        return;
      }
      if (await SecureStore.getItemAsync(promptKey(uid))) {
        bootstrapCompletedUids.add(uid);
        return;
      }
      await SecureStore.setItemAsync(promptKey(uid), "1");
      await registerGrantedDevice(uid);
      bootstrapCompletedUids.add(uid);
    } catch (error) {
      console.warn("No se pudo iniciar el registro de notificaciones.", (error as { code?: string })?.code);
    }
  })().finally(() => bootstrapJobs.delete(uid));
  bootstrapJobs.set(uid, job);
  return job;
}

export async function unregisterDeviceNotifications(uid: string): Promise<void> {
  if (Platform.OS === "web" || !db || !uid) return;
  try {
    const registeredUid = await SecureStore.getItemAsync(pushedUidsKey);
    const deviceId = await SecureStore.getItemAsync("euforia.push.deviceId");
    if (deviceId) {
      const disablePush = updateDoc(doc(db, "usuarios", uid, "dispositivos", deviceId), { enabled: false, updatedAt: serverTimestamp() });
      if (registeredUid === uid) await SecureStore.deleteItemAsync(pushedUidsKey);
      await disablePush;
    } else if (registeredUid === uid) {
      await SecureStore.deleteItemAsync(pushedUidsKey);
    }
    bootstrapCompletedUids.delete(uid);
  } catch (error) {
    console.warn("No se pudo desactivar el token push durante el cierre de sesión.", (error as { code?: string })?.code);
  } finally {
    bootstrapCompletedUids.delete(uid);
  }
}
