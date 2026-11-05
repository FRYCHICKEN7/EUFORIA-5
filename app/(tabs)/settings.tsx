import { useState } from "react";
import { Bell, ChevronRight, CloudDownload, FileJson, LogOut, Moon, ShieldCheck, Smartphone, Sun } from "lucide-react-native";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { signOut } from "firebase/auth";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { FirebaseSecurityCard } from "@/components/firebase-security-card";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { firebaseAuth } from "@/lib/firebase";
import { unregisterDeviceNotifications } from "@/lib/device-notifications";
import { useThemeContext } from "@/lib/theme-provider";

function SettingRow({ icon: Icon, title, subtitle, trailing, onPress }: { icon: typeof Bell; title: string; subtitle: string; trailing?: React.ReactNode; onPress?: () => void }) {
  const content = <View style={styles.row}><View style={styles.rowIcon}><Icon size={18} color={BRAND.primary} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowSubtitle}>{subtitle}</Text></View>{trailing ?? <ChevronRight size={18} color={BRAND.muted} />}</View>;
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

function SettingsContent() {
  const { colorScheme, setColorScheme } = useThemeContext();
  const { user, profile } = useAuthSession();
  const [signingOut, setSigningOut] = useState(false);
  const isDark = colorScheme === "dark";
  const closeSession = async () => {
    if (!firebaseAuth || signingOut) return;
    setSigningOut(true);
    try { if (user?.uid) await unregisterDeviceNotifications(user.uid); await signOut(firebaseAuth); router.replace("/auth"); }
    finally { setSigningOut(false); }
  };
  return <AuthGate allowedRoles={["admin", "administrador"]}><ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background"><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}><AppHeader name={String(profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} /><View style={styles.heading}><Text style={[styles.eyebrow, isDark && { color: BRAND.onDarkText }]}>PERSONALIZA TU EXPERIENCIA</Text><Text style={[styles.title, isDark && { color: BRAND.onDarkText }]}>Ajustes</Text></View><Text style={[styles.section, isDark && { color: BRAND.onDarkMutedText }]}>Conexión</Text><FirebaseSecurityCard /><Text style={[styles.section, isDark && { color: BRAND.onDarkMutedText }]}>Preferencias</Text><View style={styles.card}><SettingRow icon={Bell} title="Notificaciones" subtitle="Bandeja personal y permiso del dispositivo" onPress={() => router.push("/notifications")} trailing={<ChevronRight size={18} color={BRAND.muted} />} /><SettingRow icon={isDark ? Moon : Sun} title="Tema de la aplicación" subtitle="Claro o rosado oscuro" onPress={() => setColorScheme(isDark ? "light" : "dark")} trailing={<View style={styles.themePill}><Text style={styles.themeText}>{isDark ? "Rosado oscuro" : "Claro"}</Text></View>} /><SettingRow icon={ShieldCheck} title="Seguridad" subtitle="Cambiar contraseña y proteger acceso" onPress={() => router.push("/change-password")} /></View><Text style={[styles.section, isDark && { color: BRAND.onDarkMutedText }]}>Negocio</Text><View style={styles.card}><SettingRow icon={Smartphone} title="Moneda" subtitle="Lempira hondureño" trailing={<View style={styles.locked}><Text style={styles.lockedText}>L.</Text></View>} /><SettingRow icon={CloudDownload} title="Respaldos" subtitle="Exportación de datos aún no conectada" trailing={<Text style={styles.pending}>Pendiente</Text>} /></View><Text style={[styles.section, isDark && { color: BRAND.onDarkMutedText }]}>Datos</Text><View style={styles.card}><SettingRow icon={FileJson} title="Exportar información" subtitle="Exportación JSON/CSV aún no conectada" trailing={<Text style={styles.pending}>Pendiente</Text>} /></View><Pressable disabled={signingOut} onPress={() => void closeSession()} style={styles.logout}>{signingOut ? <ActivityIndicator color={BRAND.error} /> : <LogOut size={17} color={BRAND.error} />}<Text style={styles.logoutText}>{signingOut ? "Cerrando sesión…" : "Cerrar sesión"}</Text></Pressable><Text style={[styles.account, isDark && { color: BRAND.onDarkMutedText }]}>{user?.email ?? "Cuenta autenticada"}</Text><Text style={[styles.version, isDark && { color: BRAND.onDarkMutedText }]}>EUFORIA Beauty Studio · v1.0.0</Text></ScrollView></ScreenContainer></AuthGate>;
}
export default function SettingsScreen() { return <SettingsContent />; }

const styles = StyleSheet.create({ content: { paddingBottom: 34 }, heading: { paddingHorizontal: 20, marginTop: 10 }, eyebrow: { color: BRAND.primaryDark, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" }, title: { color: BRAND.wine, fontSize: 29, fontWeight: "800", marginTop: 4 }, section: { color: BRAND.muted, fontSize: 12, fontWeight: "800", marginHorizontal: 20, marginTop: 24, marginBottom: 9, textTransform: "uppercase", letterSpacing: 1 }, card: { backgroundColor: BRAND.surface, borderRadius: 24, marginHorizontal: 20, paddingHorizontal: 15, borderWidth: 1, borderColor: BRAND.border }, row: { flexDirection: "row", alignItems: "center", gap: 11, minHeight: 72, borderBottomColor: BRAND.border, borderBottomWidth: 1 }, rowIcon: { width: 35, height: 35, borderRadius: 12, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, rowCopy: { flex: 1 }, rowTitle: { color: BRAND.wine, fontSize: 14, fontWeight: "800" }, rowSubtitle: { color: BRAND.muted, fontSize: 11, marginTop: 3 }, themePill: { backgroundColor: BRAND.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }, themeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" }, locked: { backgroundColor: BRAND.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }, lockedText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" }, pending: { color: BRAND.muted, backgroundColor: BRAND.softPink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, fontSize: 10, fontWeight: "800" }, logout: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 20, marginTop: 25, borderRadius: 999, borderWidth: 1, borderColor: "#F2C8D0", backgroundColor: "#FFF1F2" }, logoutText: { color: BRAND.error, fontSize: 14, fontWeight: "800" }, account: { color: BRAND.muted, textAlign: "center", fontSize: 11, marginTop: 12 }, version: { color: BRAND.muted, textAlign: "center", fontSize: 11, marginTop: 16 } });
