import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { ArrowLeft, Eye, EyeOff, LockKeyhole } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { ScreenContainer } from "@/components/screen-container";
import { BRAND } from "@/constants/brand";
import { useAuthSession } from "@/lib/auth-session";
import { completeProvisionalCustomerPasswordChange } from "@/lib/profiles";
import { ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";
import { useThemeContext } from "@/lib/theme-provider";

export default function ChangePasswordScreen() {
  const { colorScheme } = useThemeContext();
  const { profile, user } = useAuthSession();
  const isDark = colorScheme === "dark";
  const requiresInitialChange = profile?.mustChangePassword === true;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [initialChangeSubmitted, setInitialChangeSubmitted] = useState(false);
  const [passwordMayAlreadyBeChanged, setPasswordMayAlreadyBeChanged] = useState(false);

  useEffect(() => {
    if (initialChangeSubmitted && profile?.mustChangePassword === false) {
      router.replace("/client/catalog");
    }
  }, [initialChangeSubmitted, profile?.mustChangePassword]);

  const save = async () => {
    setMessage("");
    const minimumLength = requiresInitialChange ? 8 : 6;
    if (next.length < minimumLength) {
      setMessage(`La nueva contraseña debe tener al menos ${minimumLength} caracteres.`);
      return;
    }
    if (requiresInitialChange && next === current && !passwordMayAlreadyBeChanged) {
      setMessage("La contraseña nueva debe ser distinta a la provisional.");
      return;
    }
    if (next !== confirmation) {
      setMessage("Las contraseñas nuevas no coinciden.");
      return;
    }
    const configured = await ensureFirebaseConfigured();
    const auth = firebaseAuth;
    const signedInUser = auth?.currentUser;
    if (!configured || !auth || !signedInUser?.email || !user) {
      setMessage("Debes iniciar sesión para cambiar tu contraseña.");
      return;
    }

    try {
      setSaving(true);
      if (requiresInitialChange) {
        if (!current) {
          setMessage("Escribe la contraseña provisional que te entregó administración.");
          return;
        }
        await reauthenticateWithCredential(signedInUser, EmailAuthProvider.credential(signedInUser.email, current));
        await completeProvisionalCustomerPasswordChange(next);
        setCurrent("");
        setNext("");
        setConfirmation("");
        setPasswordMayAlreadyBeChanged(false);
        setInitialChangeSubmitted(true);
        setMessage("Contraseña actualizada. Estamos preparando tu cuenta.");
      } else {
        if (current) await reauthenticateWithCredential(signedInUser, EmailAuthProvider.credential(signedInUser.email, current));
        await updatePassword(signedInUser, next);
        setMessage("Contraseña actualizada correctamente.");
        setCurrent("");
        setNext("");
        setConfirmation("");
      }
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      const mayHaveChangedPassword = code.includes("password-updated-profile-pending");
      if (mayHaveChangedPassword) setPasswordMayAlreadyBeChanged(true);
      setMessage(mayHaveChangedPassword
        ? "La contraseña pudo actualizarse, pero falta terminar. Si lo intentas de nuevo, escribe como actual la última contraseña que elegiste."
        : code.includes("wrong-password") || code.includes("invalid-credential")
        ? "La contraseña actual no es correcta."
        : code.includes("requires-recent-login")
          ? "Por seguridad, vuelve a confirmar tu contraseña provisional e inténtalo de nuevo."
          : "No se pudo actualizar la contraseña. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background"><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
    <AppHeader />
    {!requiresInitialChange && <Pressable onPress={() => router.back()} style={styles.back}><ArrowLeft size={17} color={isDark ? BRAND.onDarkText : BRAND.primaryDark} /><Text style={[styles.backText, isDark && { color: BRAND.onDarkText }]}>Volver</Text></Pressable>}
    <View style={styles.heading}>
      <Text style={[styles.eyebrow, isDark && { color: BRAND.onDarkText }]}>SEGURIDAD DE LA CUENTA</Text>
      <Text style={[styles.title, isDark && { color: BRAND.onDarkText }]}>{requiresInitialChange ? "Crea tu contraseña personal" : "Cambiar contraseña"}</Text>
      <Text style={[styles.subtitle, isDark && { color: BRAND.onDarkMutedText }]}>{requiresInitialChange ? "Escribe la contraseña actual que te entregaron y elige una nueva para continuar." : "Puedes cambiar tu contraseña cuando lo necesites. Nunca la guardamos en este teléfono."}</Text>
    </View>
    {initialChangeSubmitted && profile?.mustChangePassword !== false
      ? <View style={styles.waiting}><ActivityIndicator color={BRAND.primary} /><Text style={styles.waitingText}>Guardamos el cambio. Un momento, por favor.</Text></View>
      : <View style={styles.card}>
        <PasswordField label="Contraseña actual" value={current} onChangeText={setCurrent} visible={show} onToggle={() => setShow(value => !value)} optional={!requiresInitialChange} />
        <PasswordField label="Nueva contraseña" value={next} onChangeText={setNext} visible={show} onToggle={() => setShow(value => !value)} />
        <PasswordField label="Confirmar nueva contraseña" value={confirmation} onChangeText={setConfirmation} visible={show} onToggle={() => setShow(value => !value)} />
        <Pressable accessibilityRole="button" onPress={() => setShow(value => !value)} style={styles.showPassword}><Text style={styles.showPasswordText}>{show ? "Ocultar contraseñas" : "Mostrar contraseñas"}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={save} disabled={saving} style={[styles.primary, saving && styles.disabled]}><Text style={styles.primaryText}>{saving ? "Guardando…" : requiresInitialChange ? "Guardar y continuar" : "Actualizar contraseña"}</Text></Pressable>
        {message ? <Text accessibilityRole="alert" style={[styles.message, message.includes("actualizada") && styles.success]}>{message}</Text> : null}
      </View>}
  </KeyboardAvoidingView></ScreenContainer>;
}

function PasswordField({ label, value, onChangeText, visible, onToggle, optional = false }: { label: string; value: string; onChangeText: (value: string) => void; visible: boolean; onToggle: () => void; optional?: boolean }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}{optional ? " (opcional si la sesión es reciente)" : ""}</Text>
    <View style={styles.inputWrap}><LockKeyhole size={17} color={BRAND.muted} /><TextInput value={value} onChangeText={onChangeText} secureTextEntry={!visible} autoCapitalize="none" style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel={visible ? "Ocultar contraseña" : "Mostrar contraseña"} onPress={onToggle}>{visible ? <EyeOff size={17} color={BRAND.muted} /> : <Eye size={17} color={BRAND.muted} />}</Pressable></View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 20, paddingTop: 4 },
  backText: { color: BRAND.primaryDark, fontSize: 13, fontWeight: "800" },
  heading: { paddingHorizontal: 20, marginTop: 24 },
  eyebrow: { color: BRAND.primaryDark, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" },
  title: { color: BRAND.wine, fontSize: 28, fontWeight: "800", marginTop: 5 },
  subtitle: { color: BRAND.muted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  card: { backgroundColor: BRAND.surface, borderRadius: 24, margin: 20, padding: 16, gap: 14 },
  field: { gap: 6 },
  label: { color: BRAND.wine, fontSize: 12, fontWeight: "800" },
  inputWrap: { minHeight: 50, borderWidth: 1, borderColor: BRAND.border, borderRadius: 16, backgroundColor: BRAND.background, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, color: BRAND.wine, fontSize: 15 },
  showPassword: { alignSelf: "flex-end", paddingVertical: 3 },
  showPasswordText: { color: BRAND.primaryDark, fontSize: 11, fontWeight: "800" },
  primary: { minHeight: 50, borderRadius: 999, backgroundColor: BRAND.primary, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  message: { color: BRAND.error, fontSize: 12, lineHeight: 17 },
  success: { color: BRAND.success },
  waiting: { alignItems: "center", gap: 10, padding: 30 },
  waitingText: { color: BRAND.muted, fontSize: 13, textAlign: "center" },
});
