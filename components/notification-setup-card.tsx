import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { BellRing, Check, Settings2 } from "lucide-react-native";
import { BRAND } from "@/constants/brand";
import { enableDeviceNotifications, getDeviceNotificationStatus, type DeviceNotificationStatus } from "@/lib/device-notifications";

export function NotificationSetupCard({ uid }: { uid: string }) {
  const [status, setStatus] = useState<DeviceNotificationStatus>("permission-ready");
  const [message, setMessage] = useState("Comprobando permisos de este dispositivo…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void getDeviceNotificationStatus(uid).then((next) => {
      if (!active) return;
      setStatus(next);
      setMessage(messageFor(next));
    });
    return () => { active = false; };
  }, [uid]);

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    if (status === "permission-denied" && Platform.OS !== "web") {
      try {
        await Linking.openSettings();
      } catch {
        setMessage("Abre Ajustes del teléfono y permite las notificaciones para EUFORIA.");
      }
      setBusy(false);
      return;
    }
    const result = await enableDeviceNotifications(uid);
    setStatus(result.status);
    setMessage(result.message);
    setBusy(false);
  };

  const active = status === "registered";
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.icon}><BellRing size={20} color={active ? BRAND.success : BRAND.primary} /></View>
        <View style={styles.copy}>
          <Text style={styles.title}>{active ? "Notificaciones activadas" : "Notificaciones de EUFORIA"}</Text>
          <Text style={styles.body}>{message}</Text>
        </View>
      </View>
      {!active && <Pressable accessibilityRole="button" onPress={() => void activate()} disabled={busy} style={[styles.button, busy && styles.disabled]}>
        {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : status === "permission-denied" ? <Settings2 size={16} color="#FFFFFF" /> : <Check size={16} color="#FFFFFF" />}
        <Text style={styles.buttonText}>{busy ? "Activando…" : status === "permission-denied" ? "Abrir ajustes del teléfono" : "Activar notificaciones"}</Text>
      </Pressable>}
    </View>
  );
}

function messageFor(status: DeviceNotificationStatus) {
  switch (status) {
    case "unsupported": return "Activa los avisos desde un teléfono compatible.";
    case "needs-project": return "Los avisos de este teléfono aún no están listos. Intenta de nuevo más tarde.";
    case "permission-denied": return "Permite los avisos para EUFORIA en los ajustes del teléfono.";
    case "permission-ready": return "Permite avisos para recibir solicitudes, confirmaciones y actualizaciones de tus citas.";
    case "registered": return "Este teléfono recibirá avisos de tu cuenta.";
    case "error": return "No pudimos activar los avisos. Intenta de nuevo.";
  }
}

const styles = StyleSheet.create({
  card: { backgroundColor: BRAND.surface, borderRadius: 20, padding: 15, marginHorizontal: 20, marginTop: 14, borderWidth: 1, borderColor: BRAND.border },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  icon: { width: 39, height: 39, borderRadius: 13, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1 },
  title: { color: BRAND.wine, fontSize: 14, fontWeight: "800" },
  body: { color: BRAND.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  button: { minHeight: 42, borderRadius: 999, backgroundColor: BRAND.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 12, paddingHorizontal: 12 },
  buttonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  disabled: { opacity: 0.65 },
});
