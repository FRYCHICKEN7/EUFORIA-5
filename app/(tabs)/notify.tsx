import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BellRing, MessageCircle, ShieldCheck } from "lucide-react-native";
import { router } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { NotificationSetupCard } from "@/components/notification-setup-card";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { useThemeContext } from "@/lib/theme-provider";

function NotifyContent() {
  const { user, profile } = useAuthSession();
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";
  return <AuthGate allowedRoles={["admin", "administrador"]}><ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background"><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
    <AppHeader name={String(profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
    <View style={styles.heading}><Text style={[styles.eyebrow, isDark && { color: BRAND.onDarkText }]}>COMUNICACIÓN CON CLIENTAS</Text><Text style={[styles.title, isDark && { color: BRAND.onDarkText }]}>Avisar</Text><Text style={[styles.subtitle, isDark && { color: BRAND.onDarkMutedText }]}>Contacta a tus clientes y recibe avisos importantes de EUFORIA.</Text></View>
    <View style={styles.card}><View style={styles.icon}><MessageCircle size={23} color={BRAND.whatsapp} /></View><Text style={styles.cardTitle}>WhatsApp para contactar clientes</Text><Text style={styles.cardText}>El botón WhatsApp abre un chat con el número de cada perfil. No se envía ningún mensaje por ti: tú decides qué escribir y cuándo.</Text><Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/clients" as never)} style={styles.action}><Text style={styles.actionText}>Ver perfiles de clientes</Text></Pressable></View>
    {user?.uid && <NotificationSetupCard uid={user.uid} />}
    <View style={styles.card}><View style={styles.icon}><BellRing size={22} color={BRAND.primary} /></View><Text style={styles.cardTitle}>Avisos de citas y servicios</Text><Text style={styles.cardText}>Aquí aparecen las solicitudes, confirmaciones y novedades para clientes, empleados y administración.</Text></View>
    <View style={styles.note}><ShieldCheck size={17} color={BRAND.success} /><Text style={styles.noteText}>Los avisos de la app se actualizan al instante. Puedes activar los avisos del teléfono desde la tarjeta anterior cuando estén disponibles.</Text></View>
  </ScrollView></ScreenContainer></AuthGate>;
}
export default function NotifyScreen() { return <NotifyContent />; }

const styles = StyleSheet.create({ content: { paddingBottom: 34 }, heading: { paddingHorizontal: 20, marginTop: 10 }, eyebrow: { color: BRAND.primary, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" }, title: { color: BRAND.wine, fontSize: 29, fontWeight: "800", marginTop: 4 }, subtitle: { color: BRAND.muted, fontSize: 13, lineHeight: 19, marginTop: 5 }, card: { backgroundColor: BRAND.surface, borderRadius: 24, padding: 19, marginHorizontal: 20, marginTop: 17, borderWidth: 1, borderColor: BRAND.border }, icon: { width: 43, height: 43, borderRadius: 15, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, cardTitle: { color: BRAND.wine, fontSize: 15, fontWeight: "800", marginTop: 12 }, cardText: { color: BRAND.muted, fontSize: 12, lineHeight: 18, marginTop: 5 }, action: { alignSelf: "flex-start", backgroundColor: BRAND.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, marginTop: 13 }, actionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, note: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginHorizontal: 20, marginTop: 15, padding: 13, backgroundColor: "#EAF6EF", borderRadius: 15 }, noteText: { color: BRAND.wine, fontSize: 11, lineHeight: 16, flex: 1 } });
