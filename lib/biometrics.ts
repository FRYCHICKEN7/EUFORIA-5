import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const enrolledUidKey = (uid: string) => `euforia.biometric.${uid}`;

export async function isBiometricLoginAvailable(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function isBiometricEnrolledFor(uid: string): Promise<boolean> {
  if (Platform.OS === "web" || !uid) return false;
  try {
    return (await SecureStore.getItemAsync(enrolledUidKey(uid))) === "1";
  } catch {
    return false;
  }
}

export async function enrollBiometricFor(uid: string): Promise<{ ok: boolean; message?: string }> {
  if (!uid || !(await isBiometricLoginAvailable())) {
    return { ok: false, message: "Este dispositivo no tiene huella o biometría configurada." };
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Confirma tu identidad para activar el acceso biométrico de EUFORIA",
    cancelLabel: "Ahora no",
    disableDeviceFallback: true,
    biometricsSecurityLevel: "strong",
  });
  if (!result.success) return { ok: false, message: "No se activó el acceso biométrico." };
  await SecureStore.setItemAsync(enrolledUidKey(uid), "1");
  return { ok: true };
}

export async function authenticateBiometricFor(uid: string): Promise<boolean> {
  if (!(await isBiometricEnrolledFor(uid)) || !(await isBiometricLoginAvailable())) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Desbloquea tu sesión de EUFORIA",
    cancelLabel: "Cancelar",
    disableDeviceFallback: true,
    biometricsSecurityLevel: "strong",
  });
  return result.success;
}

export async function clearBiometricEnrollment(uid?: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    if (uid) await SecureStore.deleteItemAsync(enrolledUidKey(uid));
  } catch {
    // Una preferencia local dañada no debe bloquear el cierre de sesión de Firebase.
  }
}
