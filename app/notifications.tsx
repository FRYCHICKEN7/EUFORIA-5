import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BellRing, Check, Inbox, LogOut } from "lucide-react-native";
import { router } from "expo-router";
import { signOut } from "firebase/auth";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { NotificationSetupCard } from "@/components/notification-setup-card";
import { ScreenContainer } from "@/components/screen-container";
import { BRAND } from "@/constants/brand";
import { useAuthSession } from "@/lib/auth-session";
import { markNotificationRead, subscribeNotifications, type AppNotification } from "@/lib/profiles";
import { useThemeContext } from "@/lib/theme-provider";
import { firebaseAuth } from "@/lib/firebase";
import { unregisterDeviceNotifications } from "@/lib/device-notifications";

function NotificationCenter() {
  const { user, profile } = useAuthSession();
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) return;
    const unsubscribe = subscribeNotifications(uid, (notifications) => {
      setItems(notifications);
      setLoading(false);
      setError("");
    }, (reason) => {
      console.warn("No se pudo cargar la bandeja de avisos.", reason);
      setError("No pudimos cargar tus avisos. Intenta de nuevo.");
      setLoading(false);
    });
    return unsubscribe;
  }, [uid]);

  const markRead = async (item: AppNotification) => {
    if (item.leida || busyId) return;
    setBusyId(item.id);
    try { await markNotificationRead(item.id); }
    catch (reason) { console.warn("No se pudo marcar el aviso como leído.", reason); setError("No pudimos actualizar el aviso. Intenta de nuevo."); }
    finally { setBusyId(""); }
  };

  const closeSession = async () => {
    if (!firebaseAuth || signingOut) return;
    setSigningOut(true);
    try {
      if (uid) await unregisterDeviceNotifications(uid);
      await signOut(firebaseAuth);
      router.replace("/auth");
    } catch {
      setError("No se pudo cerrar la sesión. Comprueba tu conexión e inténtalo otra vez.");
    } finally { setSigningOut(false); }
  };

  return (
    <AuthGate allowedRoles={["cliente", "empleado", "admin", "administrador"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.name ?? profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.heading}>
            <Text style={[styles.eyebrow, isDark && { color: BRAND.onDarkText }]}>ACTUALIZACIONES DE TU CUENTA</Text>
            <Text style={[styles.title, isDark && { color: BRAND.onDarkText }]}>Notificaciones</Text>
            <Text style={[styles.subtitle, isDark && { color: BRAND.onDarkMutedText }]}>Solicitudes, citas y avisos dirigidos a tu perfil.</Text>
          </View>
          {uid && <NotificationSetupCard uid={uid} />}
          {error ? <Text accessibilityRole="alert" style={[styles.error, isDark && { color: BRAND.onDarkText }]}>{error}</Text> : null}
          {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={styles.stateText}>Escuchando tus avisos…</Text></View> : items.length === 0 ? <View style={styles.empty}><Inbox size={26} color={BRAND.primary} /><Text style={styles.emptyTitle}>No hay notificaciones todavía</Text><Text style={styles.emptyText}>Los avisos aparecerán aquí cuando haya una actualización de tu cuenta.</Text></View> : items.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" onPress={() => void markRead(item)} style={[styles.notice, item.leida === true && styles.read]}>
              <View style={styles.noticeTop}><View style={styles.noticeIcon}><BellRing size={16} color={item.leida === true ? BRAND.muted : BRAND.primary} /></View><Text style={styles.noticeTitle}>{String(item.titulo ?? "Aviso EUFORIA")}</Text>{item.leida !== true && <View style={styles.unreadDot} />}</View>
              <Text style={styles.noticeBody}>{String(item.cuerpo ?? "")}</Text>
              <View style={styles.noticeFoot}><Text style={styles.noticeDate}>{formatDate(item.createdAt)}</Text>{item.leida !== true && (busyId === item.id ? <ActivityIndicator size="small" color={BRAND.primary} /> : <View style={styles.markRead}><Check size={13} color={BRAND.primaryDark} /><Text style={styles.markText}>Marcar leído</Text></View>)}</View>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" disabled={signingOut} onPress={() => void closeSession()} style={styles.logout}>{signingOut ? <ActivityIndicator color={BRAND.error} size="small" /> : <LogOut size={16} color={BRAND.error} />}<Text style={styles.logoutText}>{signingOut ? "Cerrando sesión…" : "Cerrar sesión / cambiar cuenta"}</Text></Pressable>
        </ScrollView>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function NotificationsScreen() { return <NotificationCenter />; }

function formatDate(value: unknown) {
  try {
    const date = value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
      ? value.toDate()
      : value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? date.toLocaleString("es-HN", { timeZone: "America/Tegucigalpa", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
      : "Fecha reciente";
  } catch { return "Fecha reciente"; }
}

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  heading: { paddingHorizontal: 20, marginTop: 10 },
  eyebrow: { color: BRAND.primary, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" },
  title: { color: BRAND.wine, fontSize: 28, fontWeight: "800", marginTop: 5 },
  subtitle: { color: BRAND.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  error: { color: BRAND.error, fontSize: 12, lineHeight: 18, marginHorizontal: 20, marginTop: 12 },
  state: { alignItems: "center", gap: 8, padding: 28 },
  stateText: { color: BRAND.muted, fontSize: 12 },
  empty: { alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 22, padding: 25, marginHorizontal: 20, marginTop: 18, borderWidth: 1, borderColor: BRAND.border },
  emptyTitle: { color: BRAND.wine, fontSize: 15, fontWeight: "800", marginTop: 10 },
  emptyText: { color: BRAND.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 5 },
  notice: { marginHorizontal: 20, marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border },
  read: { opacity: 0.78 },
  noticeTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  noticeIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" },
  noticeTitle: { flex: 1, color: BRAND.wine, fontSize: 13, fontWeight: "800" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: BRAND.primary },
  noticeBody: { color: BRAND.muted, fontSize: 12, lineHeight: 18, marginTop: 9 },
  noticeFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 11 },
  noticeDate: { color: BRAND.muted, fontSize: 10 },
  markRead: { flexDirection: "row", alignItems: "center", gap: 4 },
  markText: { color: BRAND.primaryDark, fontSize: 10, fontWeight: "800" },
  logout: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 20, marginTop: 23, borderRadius: 999, borderWidth: 1, borderColor: "#F2C8D0", backgroundColor: "#FFF1F2" },
  logoutText: { color: BRAND.error, fontSize: 12, fontWeight: "800" },
});
