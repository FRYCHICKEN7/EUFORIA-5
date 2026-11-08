import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Fingerprint, LockKeyhole, Mail, Phone, Settings, UserRound } from "lucide-react-native";
import { BRAND } from "@/constants/brand";
import { useAuthSession } from "@/lib/auth-session";
import { enrollBiometricFor, isBiometricEnrolledFor, isBiometricLoginAvailable } from "@/lib/biometrics";
import { db, ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";
import { loadUserProfile, solicitarPerfilEmpleado } from "@/lib/profiles";
import { profileRole } from "@/lib/roles";
import { unregisterDeviceNotifications } from "@/lib/device-notifications";
import { BirthdayPicker } from "@/components/birthday-picker";
import { normalizeCustomerPhone } from "@/lib/customer-fields";

type AuthMode = "login" | "register" | "recovery";
type AuthRole = "administrador" | "empleado" | "cliente";

function getAuthErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code ?? "";
  if (code.includes("invalid-email")) return "El correo electrónico no es válido.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Correo o contraseña incorrectos.";
  if (code.includes("email-already-in-use")) return "Este correo ya está registrado. Inicia sesión o recupera el acceso.";
  if (code.includes("weak-password")) return "La contraseña debe tener al menos 6 caracteres.";
  if (code.includes("permission-denied")) return "No pudimos guardar tus datos. Intenta de nuevo.";
  if (code.includes("network-request-failed")) return "No hay conexión. Comprueba tu internet e inténtalo de nuevo.";
  return "No se pudo completar la operación. Intenta de nuevo.";
}

export default function AuthScreen() {
  const { user: activeUser, profile: activeProfile, loading: sessionLoading, isBiometricLocked, unlockSession, unlockWithBiometrics } = useAuthSession();
  const [mode, setMode] = useState<AuthMode>("login");
  const suppressAuthRedirect = useRef(false);
  const [role, setRole] = useState<AuthRole>("cliente");
  const [staffAccessVisible, setStaffAccessVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthdayDay, setBirthdayDay] = useState<number | null>(null);
  const [birthdayMonth, setBirthdayMonth] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingBiometric, setPendingBiometric] = useState<{ uid: string; destination: string } | null>(null);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricOfferMessage, setBiometricOfferMessage] = useState("");

  const activeRole = profileRole(activeProfile);
  const biometricRole: AuthRole = activeRole === "admin" ? "administrador" : activeRole === "empleado" ? "empleado" : "cliente";
  const selectedRole: AuthRole = isBiometricLocked ? biometricRole : role;
  useEffect(() => {
    if (suppressAuthRedirect.current || isBiometricLocked) return;
    if (sessionLoading || !activeUser?.uid || !activeRole) return;
    if (activeRole === "admin") router.replace("/(tabs)");
    else if (activeRole === "empleado") router.replace("/employee/schedule");
    else if (activeRole === "cliente") router.replace("/client/catalog");
  }, [sessionLoading, activeUser?.uid, activeRole, isBiometricLocked]);

  const submit = async () => {
    setMessage("");
    const normalizedEmail = (isBiometricLocked && !email ? activeUser?.email ?? "" : email).trim().toLowerCase();
    if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setMessage("Escribe un correo electrónico válido.");
      return;
    }
    if (mode === "register" && (name.trim().length < 2 || name.trim().length > 100)) {
      setMessage("Escribe un nombre completo de 2 a 100 caracteres.");
      return;
    }
    const normalizedPhone = mode === "register" ? normalizeCustomerPhone(phone) : null;
    if (mode === "register" && !normalizedPhone) {
      setMessage("Escribe un teléfono de ocho dígitos o un número internacional que comience con +.");
      return;
    }
    const configured = await ensureFirebaseConfigured();
    const auth = firebaseAuth;
    const store = db;
    if (!configured || !auth || !store) {
      setMessage("El servicio no está disponible ahora. Intenta de nuevo.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "recovery") {
        await sendPasswordResetEmail(auth, normalizedEmail);
        setMessage("Si existe una cuenta para ese correo, enviaremos las instrucciones de recuperación. Revisa también Spam.");
        return;
      }
      if (password.length < 6) {
        setMessage("La contraseña debe tener al menos 6 caracteres.");
        return;
      }
      if (mode === "register" && role === "administrador") {
        setMessage("El acceso de administración no admite registro desde la aplicación.");
        return;
      }

      if (mode === "register") suppressAuthRedirect.current = true;
      else suppressAuthRedirect.current = false;
      const credential = mode === "register"
        ? await createUserWithEmailAndPassword(auth, normalizedEmail, password)
        : await signInWithEmailAndPassword(auth, normalizedEmail, password);
      let profile = await loadUserProfile(credential.user.uid);

      if (mode === "register") {
        const profileData = {
          id: credential.user.uid,
          email: credential.user.email ?? normalizedEmail,
          name: name.trim(),
          displayName: name.trim(),
          profileImage: "",
          role: "cliente",
          rol: "cliente",
          createdAt: serverTimestamp(),
          phone: normalizedPhone!,
          aceptaRecordatoriosWhatsApp: true,
          ...(birthdayDay && birthdayMonth ? { birthdayDay, birthdayMonth } : {}),
        };
        const batch = writeBatch(store);
        batch.set(doc(store, "users", credential.user.uid), profileData);
        batch.set(doc(store, "usuarios", credential.user.uid), profileData);
        await batch.commit();
        profile = await loadUserProfile(credential.user.uid);
        if (role === "empleado") await solicitarPerfilEmpleado();
        await signOut(auth);
        setMode("login");
        setRole("cliente");
        setStaffAccessVisible(false);
        setMessage(role === "empleado"
          ? "Tu cuenta está lista y la solicitud para unirte al equipo quedó pendiente de revisión. Hasta que la acepten, podrás usarla como cliente."
          : "Tu cuenta de cliente está lista. Ya puedes iniciar sesión.");
        return;
      }

      if (!profile) {
        await signOut(auth);
        setMessage("No encontramos los datos de esta cuenta. Regístrate con tu teléfono o consulta con administración.");
        return;
      }

      const storedRole = profileRole(profile);
      const selectedRoleForLogin = isBiometricLocked ? biometricRole : role;
      const roleMatches = selectedRoleForLogin === "administrador"
        ? storedRole === "admin"
        : selectedRoleForLogin === "empleado"
          ? storedRole === "empleado"
          : storedRole === "cliente";
      if (!roleMatches) {
        const isPendingEmployee = selectedRoleForLogin === "empleado" && profile.estadoSolicitud === "pendiente";
        if (selectedRoleForLogin === "empleado" && storedRole === "cliente" && !isPendingEmployee) {
          try {
            await solicitarPerfilEmpleado();
            await signOut(auth);
            setMessage("Recibimos tu solicitud para unirte al equipo. Podrás entrar como empleado cuando administración la acepte.");
          } catch (reason) {
            console.warn("No se pudo enviar la solicitud de empleado.", reason);
            await signOut(auth);
            setMessage("No pudimos enviar la solicitud. Intenta de nuevo cuando tengas conexión.");
          }
          return;
        }
        await signOut(auth);
        setMessage(isPendingEmployee ? "Tu solicitud de acceso al equipo está pendiente. Administración debe revisarla antes de que puedas entrar como empleado." : storedRole === null
          ? "No pudimos validar el tipo de cuenta. Contacta con administración."
          : selectedRoleForLogin === "administrador"
            ? "Esta cuenta no tiene acceso de administración."
            : selectedRoleForLogin === "empleado"
              ? "Esta cuenta aún no tiene acceso de empleado. Solicita la activación a administración."
              : "Esta cuenta tiene un rol distinto. Selecciona el tipo de acceso correspondiente.");
        return;
      }
      unlockSession();
      const destination = selectedRoleForLogin === "administrador" ? "/(tabs)" : selectedRoleForLogin === "empleado" ? "/employee/schedule" : "/client/catalog";
      if (!(await isBiometricEnrolledFor(credential.user.uid)) && await isBiometricLoginAvailable()) {
        setPendingBiometric({ uid: credential.user.uid, destination });
        setBiometricOfferMessage("");
        return;
      }
      router.replace(destination);
    } catch (error) {
      console.warn("No se pudo completar el inicio de sesión.", (error as { code?: string })?.code);
      setMessage(getAuthErrorMessage(error));
      if (firebaseAuth?.currentUser) {
        try { await signOut(firebaseAuth); } catch { /* conserva el error original */ }
      }
      if (mode !== "register") suppressAuthRedirect.current = false;
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "recovery" ? "Recupera tu acceso." : mode === "login" ? "Vuelve a sentirte bien." : role === "empleado" ? "Solicita unirte al equipo." : "Empieza tu experiencia.";
  const subtitle = mode === "recovery"
    ? "Te enviaremos un enlace seguro para crear una nueva contraseña."
    : mode === "login"
      ? "Inicia sesión como cliente. El acceso del equipo está detrás del engranaje."
      : role === "empleado"
        ? "Completa tus datos. Tu acceso como empleado estará disponible cuando administración acepte la solicitud."
        : "Crea tu cuenta para consultar servicios y reservar tus citas.";

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <View style={styles.glow} />
      <View style={styles.content}>
        <Image source={require("../assets/images/icon.png")} style={styles.logo} contentFit="contain" />
        <Text style={styles.brand}>EUFORIA</Text>
        <Text style={styles.eyebrow}>{mode === "recovery" ? "RECUPERACIÓN SEGURA" : mode === "login" ? "TU ESPACIO DE BELLEZA" : "CREA TU CUENTA"}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {mode === "login" && !isBiometricLocked && <View style={styles.accessRow}>
            <Text style={styles.accessLabel}>{staffAccessVisible ? "Acceso de personal" : "Acceso de cliente"}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={staffAccessVisible ? "Ocultar acceso de administrador y empleado" : "Mostrar acceso de administrador y empleado"} onPress={() => { const next = !staffAccessVisible; setStaffAccessVisible(next); setRole(next ? "administrador" : "cliente"); }} style={styles.gearButton}>
            <Settings size={18} color={BRAND.primaryDark} />
          </Pressable>
        </View>}
        {mode === "login" && staffAccessVisible && !isBiometricLocked && (
          <View style={styles.roleSelector}>
            <RoleButton label="Administrador" active={role === "administrador"} onPress={() => setRole("administrador")} />
            <RoleButton label="Empleado" active={role === "empleado"} onPress={() => setRole("empleado")} />
          </View>
        )}
        {mode === "login" && staffAccessVisible && role === "empleado" && !isBiometricLocked && (
          <Pressable accessibilityRole="button" onPress={() => { setMode("register"); setMessage(""); }} style={styles.employeeRegister}>
            <Text style={styles.switchText}>¿Aún no tienes cuenta de empleado? <Text style={styles.switchAccent}>Regístrate aquí</Text></Text>
          </Pressable>
        )}
        {isBiometricLocked && <View style={styles.biometricCard}>
          <View style={styles.fingerprintIcon}><Fingerprint size={25} color={BRAND.primary} /></View>
          <Text style={styles.biometricTitle}>Sesión protegida</Text>
          <Text style={styles.biometricCopy}>{activeUser?.email ?? "Confirma tu identidad para continuar."}</Text>
          <Pressable accessibilityRole="button" disabled={loading || sessionLoading} onPress={() => { setLoading(true); void unlockWithBiometrics().then((ok) => { if (!ok) setMessage("No se pudo validar la huella. También puedes confirmar con tu contraseña."); }).finally(() => setLoading(false)); }} style={[styles.biometricButton, (loading || sessionLoading) && styles.disabled]}>
            <Fingerprint size={18} color="#FFFFFF" /><Text style={styles.primaryText}>{loading || sessionLoading ? "Verificando…" : "Desbloquear con huella"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={loading} onPress={() => { const auth = firebaseAuth; if (!auth) return; setLoading(true); void (async () => { if (activeUser?.uid) await unregisterDeviceNotifications(activeUser.uid); await signOut(auth); })().then(() => router.replace("/auth")).catch(() => setMessage("No se pudo cerrar la sesión. Comprueba la conexión e inténtalo otra vez.")).finally(() => setLoading(false)); }} style={styles.modalSkip}>
            <Text style={styles.linkText}>Cambiar de cuenta</Text>
          </Pressable>
        </View>}
        <View style={styles.form}>
          {mode === "register" && <Input icon={<UserRound size={18} color={BRAND.muted} />} value={name} onChangeText={setName} placeholder="Nombre completo" accessibilityLabel="Nombre completo" autoCapitalize="words" textContentType="name" />}
          <Input icon={<Mail size={18} color={BRAND.muted} />} value={isBiometricLocked && !email ? activeUser?.email ?? "" : email} onChangeText={setEmail} placeholder="Correo electrónico" accessibilityLabel="Correo electrónico" keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
          {mode === "register" && <Input icon={<Phone size={18} color={BRAND.muted} />} value={phone} onChangeText={setPhone} placeholder="Teléfono (obligatorio)" accessibilityLabel="Teléfono obligatorio" keyboardType="phone-pad" textContentType="telephoneNumber" />}
          {mode === "register" && <Text style={styles.fieldHint}>Ocho dígitos hondureños o número internacional con +.</Text>}
          {mode === "register" && <BirthdayPicker day={birthdayDay} month={birthdayMonth} onChange={(day, month) => { setBirthdayDay(day); setBirthdayMonth(month); }} />}
          {mode !== "recovery" && (
            <View style={styles.inputWrap}>
              <LockKeyhole size={18} color={BRAND.muted} />
              <TextInput value={password} onChangeText={setPassword} placeholder="Contraseña" placeholderTextColor={BRAND.muted} secureTextEntry={!showPassword} autoCapitalize="none" textContentType={mode === "register" ? "newPassword" : "password"} style={styles.input} accessibilityLabel="Contraseña" />
              <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onPress={() => setShowPassword((value) => !value)}>
                {showPassword ? <EyeOff size={18} color={BRAND.muted} /> : <Eye size={18} color={BRAND.muted} />}
              </Pressable>
            </View>
          )}
        </View>
        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        <Pressable accessibilityRole="button" disabled={loading || (isBiometricLocked && sessionLoading)} onPress={() => void submit()} style={[styles.primary, (loading || (isBiometricLocked && sessionLoading)) && styles.disabled]}>
          <Text style={styles.primaryText}>{loading ? "Procesando…" : isBiometricLocked && sessionLoading ? "Verificando sesión…" : mode === "recovery" ? "Enviar correo" : mode === "login" ? `Iniciar como ${selectedRole === "administrador" ? "administrador" : selectedRole === "empleado" ? "empleado" : "cliente"}` : role === "empleado" ? "Enviar solicitud" : "Crear cuenta cliente"}</Text>
          <ArrowRight size={18} color="#FFFFFF" />
        </Pressable>
        {mode === "login" && <Pressable onPress={() => { setMode("recovery"); setMessage(""); }} style={styles.forgot}><Text style={styles.linkText}>¿Olvidaste tu contraseña?</Text></Pressable>}
        {mode === "recovery" && <Pressable onPress={() => { setMode("login"); setMessage(""); }} style={styles.back}><ArrowLeft size={15} color={BRAND.primaryDark} /><Text style={styles.backText}>Volver a iniciar sesión</Text></Pressable>}
        {mode !== "recovery" && (
          <Pressable onPress={() => { setMode((value) => value === "login" ? "register" : "login"); setRole("cliente"); setStaffAccessVisible(false); setMessage(""); }} style={styles.switch}>
            <Text style={styles.switchText}>{mode === "login" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}<Text style={styles.switchAccent}>{mode === "login" ? "Regístrate" : "Inicia sesión"}</Text></Text>
          </Pressable>
        )}
        <Text style={styles.security}>{mode === "register" ? role === "empleado" ? "Tu perfil se mantiene como cliente hasta que administración revise la solicitud." : "El acceso de administración y empleado no se elige durante el registro de cliente." : "Inicia sesión con tu correo y contraseña."}</Text>
      </View>
      <Modal visible={Boolean(pendingBiometric)} transparent animationType="fade" onRequestClose={() => { const destination = pendingBiometric?.destination; setPendingBiometric(null); if (destination) router.replace(destination as never); }}>
        <View style={styles.modalShade}><View style={styles.modalCard}>
          <View style={styles.fingerprintIcon}><Fingerprint size={27} color={BRAND.primary} /></View>
          <Text style={styles.biometricTitle}>Activa el acceso con huella</Text>
          <Text style={styles.biometricCopy}>La biometría de este teléfono desbloqueará tu sesión EUFORIA guardada. No guardamos tu contraseña; si cierras sesión, volverás a entrar con correo y contraseña.</Text>
          {biometricOfferMessage ? <Text accessibilityRole="alert" style={styles.message}>{biometricOfferMessage}</Text> : null}
          <Pressable accessibilityRole="button" disabled={biometricBusy} onPress={() => {
            const pending = pendingBiometric;
            if (!pending) return;
            setBiometricBusy(true);
            void enrollBiometricFor(pending.uid).then((result) => {
              if (result.ok) { setPendingBiometric(null); router.replace(pending.destination as never); }
              else setBiometricOfferMessage(result.message ?? "No se activó la biometría.");
            }).catch(() => setBiometricOfferMessage("No se pudo configurar la huella en este dispositivo.")).finally(() => setBiometricBusy(false));
          }} style={[styles.primary, biometricBusy && styles.disabled]}>
            <Text style={styles.primaryText}>{biometricBusy ? "Verificando…" : "Activar huella"}</Text><Fingerprint size={18} color="#FFFFFF" />
          </Pressable>
          <Pressable accessibilityRole="button" disabled={biometricBusy} onPress={() => { const destination = pendingBiometric?.destination; setPendingBiometric(null); if (destination) router.replace(destination as never); }} style={styles.modalSkip}>
            <Text style={styles.linkText}>Ahora no</Text>
          </Pressable>
        </View></View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function RoleButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.roleButton, active && styles.roleButtonActive]}><Text style={[styles.roleText, active && styles.roleTextActive]}>{label}</Text></Pressable>;
}

function Input({ icon, accessibilityLabel, ...props }: { icon: React.ReactNode; accessibilityLabel: string } & React.ComponentProps<typeof TextInput>) {
  return <View style={styles.inputWrap}>{icon}<TextInput {...props} placeholderTextColor={BRAND.muted} style={styles.input} accessibilityLabel={accessibilityLabel} autoCorrect={false} /></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BRAND.background },
  glow: { position: "absolute", width: 280, height: 280, borderRadius: 140, backgroundColor: BRAND.softPink, top: -100, right: -80 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 62, alignItems: "center" },
  logo: { width: 82, height: 82, borderRadius: 41, backgroundColor: BRAND.surface },
  brand: { color: BRAND.wine, fontSize: 21, fontWeight: "900", letterSpacing: 3, marginTop: 11 },
  eyebrow: { color: BRAND.primaryDark, fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginTop: 25 },
  title: { color: BRAND.wine, fontSize: 30, lineHeight: 36, fontWeight: "800", textAlign: "center", marginTop: 8 },
  subtitle: { color: BRAND.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8, maxWidth: 320 },
  accessRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 17, paddingHorizontal: 3 },
  accessLabel: { color: BRAND.wine, fontSize: 12, fontWeight: "800" },
  gearButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: BRAND.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BRAND.border },
  roleSelector: { width: "100%", flexDirection: "row", gap: 8, marginTop: 18, padding: 4, borderRadius: 999, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border },
  roleButton: { flex: 1, minHeight: 42, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  roleButtonActive: { backgroundColor: BRAND.primary },
  roleText: { color: BRAND.primaryDark, fontSize: 13, fontWeight: "800" },
  roleTextActive: { color: "#FFFFFF" },
  form: { width: "100%", gap: 10, marginTop: 15 },
  inputWrap: { minHeight: 54, borderWidth: 1, borderColor: BRAND.border, backgroundColor: BRAND.surface, borderRadius: 18, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 9 },
  input: { flex: 1, color: BRAND.wine, fontSize: 16 },
  fieldHint: { color: BRAND.muted, fontSize: 11, lineHeight: 16, marginTop: -5, paddingHorizontal: 6 },
  biometricCard: { width: "100%", alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 20, padding: 15, marginTop: 15, borderWidth: 1, borderColor: BRAND.border },
  fingerprintIcon: { width: 47, height: 47, borderRadius: 16, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" },
  biometricTitle: { color: BRAND.wine, fontSize: 15, fontWeight: "800", marginTop: 9, textAlign: "center" },
  biometricCopy: { color: BRAND.muted, fontSize: 12, lineHeight: 17, marginTop: 5, textAlign: "center" },
  biometricButton: { width: "100%", minHeight: 44, borderRadius: 999, backgroundColor: BRAND.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7, marginTop: 12 },
  message: { width: "100%", color: BRAND.error, fontSize: 13, lineHeight: 18, marginTop: 12 },
  primary: { width: "100%", minHeight: 54, borderRadius: 999, backgroundColor: BRAND.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginTop: 16 },
  disabled: { opacity: 0.65 },
  primaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  forgot: { marginTop: 15, paddingVertical: 7 },
  linkText: { color: BRAND.primaryDark, fontSize: 14, fontWeight: "800" },
  back: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 15, paddingVertical: 7 },
  backText: { color: BRAND.primaryDark, fontSize: 14, fontWeight: "800" },
  switch: { marginTop: 12, paddingVertical: 6 },
  employeeRegister: { width: "100%", alignItems: "center", marginTop: 11, paddingVertical: 8 },
  switchText: { color: BRAND.muted, fontSize: 14 },
  switchAccent: { color: BRAND.primaryDark, fontWeight: "800" },
  security: { color: BRAND.muted, fontSize: 11, textAlign: "center", lineHeight: 16, marginTop: "auto", marginBottom: 24 },
  modalShade: { flex: 1, backgroundColor: "rgba(40, 15, 26, 0.48)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 390, backgroundColor: BRAND.background, borderRadius: 24, padding: 22, alignItems: "center" },
  modalSkip: { marginTop: 12, paddingVertical: 8 },
});
