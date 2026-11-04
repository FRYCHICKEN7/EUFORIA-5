import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { ArrowLeft, Eye, EyeOff, LockKeyhole } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { ScreenContainer } from "@/components/screen-container";
import { BRAND } from "@/constants/brand";
import { ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";
import { useThemeContext } from "@/lib/theme-provider";

export default function ChangePasswordScreen() {
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setMessage("");
    if (next.length < 6) { setMessage("La nueva contraseña debe tener al menos 6 caracteres."); return; }
    if (next !== confirmation) { setMessage("Las contraseñas nuevas no coinciden."); return; }
    const configured = await ensureFirebaseConfigured();
    const user = firebaseAuth?.currentUser;
    if (!configured || !user || !user.email) { setMessage("Debes iniciar sesión para cambiar tu contraseña."); return; }
    try {
      setSaving(true);
      if (current) await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      await updatePassword(user, next);
      setMessage("Contraseña actualizada correctamente.");
      setCurrent(""); setNext(""); setConfirmation("");
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      setMessage(code.includes("wrong-password") || code.includes("invalid-credential") ? "La contraseña actual no es correcta." : code.includes("requires-recent-login") ? "Por seguridad, cierra sesión e inicia sesión de nuevo antes de cambiarla." : "No se pudo actualizar la contraseña.");
    } finally { setSaving(false); }
  };

  return <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background"><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}><AppHeader /><Pressable onPress={() => router.back()} style={styles.back}><ArrowLeft size={17} color={isDark ? BRAND.onDarkText : BRAND.primaryDark} /><Text style={[styles.backText, isDark && { color: BRAND.onDarkText }]}>Volver a Ajustes</Text></Pressable><View style={styles.heading}><Text style={[styles.eyebrow, isDark && { color: BRAND.onDarkText }]}>SEGURIDAD DE LA CUENTA</Text><Text style={[styles.title, isDark && { color: BRAND.onDarkText }]}>Cambiar contraseña</Text><Text style={[styles.subtitle, isDark && { color: BRAND.onDarkMutedText }]}>Usa una contraseña de al menos 6 caracteres. Firebase protege el cambio y no guardamos contraseñas en la app.</Text></View><View style={styles.card}><PasswordField label="Contraseña actual" value={current} onChangeText={setCurrent} visible={show} onToggle={() => setShow(value => !value)} optional /><PasswordField label="Nueva contraseña" value={next} onChangeText={setNext} visible={show} onToggle={() => setShow(value => !value)} /><PasswordField label="Confirmar nueva contraseña" value={confirmation} onChangeText={setConfirmation} visible={show} onToggle={() => setShow(value => !value)} /><Pressable onPress={save} disabled={saving} style={styles.primary}><Text style={styles.primaryText}>{saving ? "Guardando..." : "Actualizar contraseña"}</Text></Pressable>{message ? <Text style={[styles.message, message.includes("correctamente") && styles.success]}>{message}</Text> : null}</View></KeyboardAvoidingView></ScreenContainer>;
}

function PasswordField({ label, value, onChangeText, visible, onToggle, optional = false }: { label: string; value: string; onChangeText: (value: string) => void; visible: boolean; onToggle: () => void; optional?: boolean }) { return <View style={styles.field}><Text style={styles.label}>{label}{optional ? " (opcional si la sesión es reciente)" : ""}</Text><View style={styles.inputWrap}><LockKeyhole size={17} color={BRAND.muted} /><TextInput value={value} onChangeText={onChangeText} secureTextEntry={!visible} autoCapitalize="none" style={styles.input} /><Pressable onPress={onToggle}>{visible ? <EyeOff size={17} color={BRAND.muted} /> : <Eye size={17} color={BRAND.muted} />}</Pressable></View></View>; }

const styles = StyleSheet.create({ screen: { flex: 1 }, back: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 20, paddingTop: 4 }, backText: { color: BRAND.primaryDark, fontSize: 13, fontWeight: "800" }, heading: { paddingHorizontal: 20, marginTop: 24 }, eyebrow: { color: BRAND.primaryDark, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" }, title: { color: BRAND.wine, fontSize: 28, fontWeight: "800", marginTop: 5 }, subtitle: { color: BRAND.muted, fontSize: 13, lineHeight: 19, marginTop: 7 }, card: { backgroundColor: BRAND.surface, borderRadius: 24, margin: 20, padding: 16, gap: 14 }, field: { gap: 6 }, label: { color: BRAND.wine, fontSize: 12, fontWeight: "800" }, inputWrap: { minHeight: 50, borderWidth: 1, borderColor: BRAND.border, borderRadius: 16, backgroundColor: BRAND.background, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8 }, input: { flex: 1, color: BRAND.wine, fontSize: 15 }, primary: { minHeight: 50, borderRadius: 999, backgroundColor: BRAND.primary, alignItems: "center", justifyContent: "center", marginTop: 4 }, primaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" }, message: { color: BRAND.error, fontSize: 12, lineHeight: 17 }, success: { color: BRAND.success } });
