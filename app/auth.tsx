import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { ArrowLeft, ArrowRight, CreditCard, Eye, EyeOff, Fingerprint, LockKeyhole, Mail, Phone, Settings, UserRound } from "lucide-react-native";
import { BRAND } from "@/constants/brand";
import { useAuthSession } from "@/lib/auth-session";
import { enrollBiometricFor, isBiometricEnrolledFor, isBiometricLoginAvailable } from "@/lib/biometrics";
import { db, ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";
import { loadUserProfile } from "@/lib/profiles";
import { profileRole } from "@/lib/roles";
import { unregisterDeviceNotifications } from "@/lib/device-notifications";

type AuthMode = "login" | "register" | "recovery";
type AuthRole = "administrador" | "empleado" | "cliente";

function getAuthErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code ?? "";
  if (code.includes("invalid-email")) return "El correo electrónico no es válido.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Correo o contraseña incorrectos.";
  if (code.includes("email-already-in-use")) return "Este correo ya está registrado. Inicia sesión o recupera el acceso.";
  if (code.includes("weak-password")) return "La contraseña debe tener al menos 6 caracteres.";
  if (code.includes("permission-denied")) return "Firebase rechazó la lectura o escritura del perfil. Despliega las Rules compatibles con users y usuarios.";
  if (code.includes("network-request-failed")) return "No hay conexión. Comprueba tu internet e inténtalo de nuevo.";
  return "No se pudo completar la operación. Revisa Firebase e inténtalo de nuevo.";
}

export default function AuthScreen() {
  const { user: activeUser, profile: activeProfile, loading: sessionLoading, isBiometricLocked, unlockSession, unlockWithBiometrics } = useAuthSession();
  const [mode, setMode] = useState<AuthMode>("login");
  const [role, setRole] = useState<AuthRole>("cliente");
  const [staffAccessVisible, setStaffAccessVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [identityNumber, setIdentityNumber] = useState("");
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
    if (isBiometricLocked) return;
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
    if (mode === "register" && phone.trim().length > 20) {
      setMessage("El teléfono no puede tener más de 20 caracteres.");
      return;
    }
    if (mode === "register" && identityNumber.trim().length > 40) {
      setMessage("El número de identidad no puede tener más de 40 caracteres.");
      return;
    }
    const configured = await ensureFirebaseConfigured();
    const auth = firebaseAuth;
    const store = db;
    if (!configured || !auth || !store) {
      setMessage("Firebase no está configurado en este entorno.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "recovery") {
        await sendPasswordResetEmail(auth, normalizedEmail);
        setMessage("Si existe una cuenta para ese correo, Firebase enviará instrucciones de recuperación. Revisa también Spam.");
        return;
      }
      if (password.length < 6) {
        setMessage("La contraseña debe tener al menos 6 caracteres.");
        return;
      }
      if (mode === "register" && role !== "cliente") {
        setMessage("El registro público siempre crea un perfil cliente. Administración puede aprobar después su perfil de empleado.");
        return;
      }

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
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(identityNumber.trim() ? { identityNumber: identityNumber.trim() } : {}),
        };
        const batch = writeBatch(store);
        batch.set(doc(store, "users", credential.user.uid), profileData);
        batch.set(doc(store, "usuarios", credential.user.uid), profileData);
        await batch.commit();
        profile = await loadUserProfile(credential.user.uid);
      }

      // Solo repara cuentas cliente sin perfil; nunca crea ni eleva cuentas privilegiadas.
      if (mode === "login" && role === "cliente" && !profile) {
        const profileData = {
          id: credential.user.uid,
          email: credential.user.email ?? normalizedEmail,
          role: "cliente",
          rol: "cliente",
          createdAt: serverTimestamp(),
        };
        const batch = writeBatch(store);
        batch.set(doc(store, "users", credential.user.uid), profileData);
        batch.set(doc(store, "usuarios", credential.user.uid), profileData);
        await batch.commit();
        profile = await loadUserProfile(credential.user.uid);
      }
      if (!profile) {
        await signOut(auth);
        setMessage(`No existe un perfil vinculado al UID ${credential.user.uid}. Comprueba users, usuarios o empleados en Firestore.`);
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
        await signOut(auth);
        setMessage(storedRole === null
          ? "Los perfiles encontrados tienen un rol inválido o contradictorio. Pide a administración que los reconcilie."
          : selectedRoleForLogin === "administrador"
            ? "Esta cuenta no tiene rol de administrador en su perfil vinculado al UID de Authentication."
            : selectedRoleForLogin === "empleado"
              ? "Esta cuenta no tiene perfil aprobado de empleado. Regístrate como cliente y solicita la activación al administrador."
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
      console.warn("Authentication/Firestore rechazó la operación.", (error as { code?: string })?.code);
      setMessage(getAuthErrorMessage(error));
      if (firebaseAuth?.currentUser) {
        try { await signOut(firebaseAuth); } catch { /* conserva el error original */ }
      }
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "recovery" ? "Recupera tu acceso." : mode === "login" ? "Vuelve a sentirte bien." : "Empieza tu experiencia.";
  const subtitle = mode === "recovery"
    ? "Te enviaremos un enlace seguro para crear una nueva contraseña."
    : mode === "login"
      ? "Inicia sesión como cliente. El acceso del equipo está detrás del engranaje."
      : "Regístrate como cliente; si eres parte del equipo, administración activará tu perfil de empleado.";

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
          {mode === "register" && <Input icon={<Phone size={18} color={BRAND.muted} />} value={phone} onChangeText={setPhone} placeholder="Teléfono (opcional)" accessibilityLabel="Teléfono opcional" keyboardType="phone-pad" textContentType="telephoneNumber" />}
          {mode === "register" && <Input icon={<CreditCard size={18} color={BRAND.muted} />} value={identityNumber} onChangeText={setIdentityNumber} placeholder="Identidad (opcional)" accessibilityLabel="Número de identidad opcional" autoCapitalize="characters" />}
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
          <Text style={styles.primaryText}>{loading ? "Procesando…" : isBiometricLocked && sessionLoading ? "Verificando sesión…" : mode === "recovery" ? "Enviar correo" : mode === "login" ? `Iniciar como ${selectedRole === "administrador" ? "administrador" : selectedRole === "empleado" ? "empleado" : "cliente"}` : "Crear cuenta cliente"}</Text>
          <ArrowRight size={18} color="#FFFFFF" />
        </Pressable>
        {mode === "login" && <Pressable onPress={() => { setMode("recovery"); setMessage(""); }} style={styles.forgot}><Text style={styles.linkText}>¿Olvidaste tu contraseña?</Text></Pressable>}
        {mode === "recovery" && <Pressable onPress={() => { setMode("login"); setMessage(""); }} style={styles.back}><ArrowLeft size={15} color={BRAND.primaryDark} /><Text style={styles.backText}>Volver a iniciar sesión</Text></Pressable>}
        {mode !== "recovery" && (
          <Pressable onPress={() => { setMode((value) => value === "login" ? "register" : "login"); setRole("cliente"); setStaffAccessVisible(false); setMessage(""); }} style={styles.switch}>
            <Text style={styles.switchText}>{mode === "login" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}<Text style={styles.switchAccent}>{mode === "login" ? "Regístrate" : "Inicia sesión"}</Text></Text>
          </Pressable>
        )}
        <Text style={styles.security}>{mode === "register" ? "El registro crea un perfil cliente. Administración aprueba el acceso de empleado." : "Tus datos se validan con Firebase Authentication."}</Text>
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
  switchText: { color: BRAND.muted, fontSize: 14 },
  switchAccent: { color: BRAND.primaryDark, fontWeight: "800" },
  security: { color: BRAND.muted, fontSize: 11, textAlign: "center", lineHeight: 16, marginTop: "auto", marginBottom: 24 },
  modalShade: { flex: 1, backgroundColor: "rgba(40, 15, 26, 0.48)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 390, backgroundColor: BRAND.background, borderRadius: 24, padding: 22, alignItems: "center" },
  modalSkip: { marginTop: 12, paddingVertical: 8 },
});
