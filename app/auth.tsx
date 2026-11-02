import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Phone, UserRound } from "lucide-react-native";
import { BRAND } from "@/constants/brand";
import { useAuthSession } from "@/lib/auth-session";
import { db, ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";

type AuthMode = "login" | "register" | "recovery";
type AuthRole = "administrador" | "empleado" | "cliente";

function getAuthErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code ?? "";
  if (code.includes("invalid-email")) return "El correo electrónico no es válido.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Correo o contraseña incorrectos.";
  if (code.includes("email-already-in-use")) return "Este correo ya está registrado. Inicia sesión o recupera el acceso.";
  if (code.includes("weak-password")) return "La contraseña debe tener al menos 6 caracteres.";
  if (code.includes("permission-denied")) return "Firebase rechazó la lectura o creación del perfil. Revisa las reglas Firestore de EUFORIA.";
  if (code.includes("network-request-failed")) return "No hay conexión. Comprueba tu internet e inténtalo de nuevo.";
  return "No se pudo completar la operación. Revisa Firebase e inténtalo de nuevo.";
}

export default function AuthScreen() {
  const { user: activeUser, profile: activeProfile, loading: sessionLoading } = useAuthSession();
  const [mode, setMode] = useState<AuthMode>("login");
  const [role, setRole] = useState<AuthRole>("cliente");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const activeRole = String(activeProfile?.rol ?? "").trim().toLowerCase();
  useEffect(() => {
    if (sessionLoading || !activeUser?.uid || !activeRole) return;
    if (activeRole === "admin" || activeRole === "administrador") router.replace("/(tabs)");
    else if (activeRole === "empleado") router.replace("/employee/schedule");
    else if (activeRole === "cliente") router.replace("/client/catalog");
  }, [sessionLoading, activeUser?.uid, activeRole]);

  const submit = async () => {
    setMessage("");
    const normalizedEmail = email.trim().toLowerCase();
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
        setMessage("El registro público solo crea cuentas de cliente.");
        return;
      }

      const credential = mode === "register"
        ? await createUserWithEmailAndPassword(auth, normalizedEmail, password)
        : await signInWithEmailAndPassword(auth, normalizedEmail, password);
      const userRef = doc(store, "usuarios", credential.user.uid);
      let profileSnapshot = await getDoc(userRef);

      if (mode === "register" && !profileSnapshot.exists()) {
        await setDoc(userRef, {
          email: credential.user.email ?? normalizedEmail,
          rol: "cliente",
          createdAt: serverTimestamp(),
          displayName: name.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        });
        profileSnapshot = await getDoc(userRef);
      }
      // Repara un alta Auth previa sin perfil, manteniendo la creación segura como cliente.
      if (mode === "login" && role === "cliente" && !profileSnapshot.exists()) {
        await setDoc(userRef, {
          email: credential.user.email ?? normalizedEmail,
          rol: "cliente",
          createdAt: serverTimestamp(),
        });
        profileSnapshot = await getDoc(userRef);
      }
      if (!profileSnapshot.exists()) {
        await signOut(auth);
        setMessage("La cuenta no tiene perfil en usuarios/{uid}. El administrador debe asignar su rol desde Firebase Console.");
        return;
      }

      const storedRole = String(profileSnapshot.data().rol ?? "").trim().toLowerCase();
      const isAdmin = storedRole === "admin" || storedRole === "administrador";
      const isEmployee = storedRole === "empleado";
      const isClient = storedRole === "cliente";
      const roleMatches = role === "administrador" ? isAdmin : role === "empleado" ? isEmployee : isClient;
      if (!roleMatches) {
        await signOut(auth);
        setMessage(role === "administrador"
          ? "Esta cuenta no tiene rol de administrador. Verifica usuarios/{uid}.rol en Firestore."
          : role === "empleado"
            ? "Esta cuenta no tiene rol empleado. Solicita al administrador que verifique usuarios/{uid}.rol."
            : "Esta cuenta tiene un rol distinto. Selecciona el tipo de acceso correspondiente.");
        return;
      }
      router.replace(role === "administrador" ? "/(tabs)" : role === "empleado" ? "/employee/schedule" : "/client/catalog");
    } catch (error) {
      console.warn("Authentication/Firestore rechazó la operación.", (error as { code?: string })?.code);
      setMessage(getAuthErrorMessage(error));
      if (firebaseAuth?.currentUser) {
        try { await signOut(firebaseAuth); } catch { /* se conserva el error original */ }
      }
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "recovery" ? "Recupera tu acceso." : mode === "login" ? "Vuelve a sentirte bien." : "Empieza tu experiencia.";
  const subtitle = mode === "recovery"
    ? "Te enviaremos un enlace seguro para crear una nueva contraseña."
    : mode === "login"
      ? "Selecciona tu tipo de acceso e ingresa a EUFORIA."
      : "Regístrate como cliente para reservar y cuidar tus próximas visitas.";

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <View style={styles.glow} />
      <View style={styles.content}>
        <Image source={require("../assets/images/icon.png")} style={styles.logo} contentFit="contain" />
        <Text style={styles.brand}>EUFORIA</Text>
        <Text style={styles.eyebrow}>{mode === "recovery" ? "RECUPERACIÓN SEGURA" : mode === "login" ? "TU ESPACIO DE BELLEZA" : "CREA TU CUENTA"}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {mode === "login" && (
          <View style={styles.roleSelector}>
            <Pressable accessibilityRole="button" onPress={() => setRole("cliente")} style={[styles.roleButton, role === "cliente" && styles.roleButtonActive]}>
              <Text style={[styles.roleText, role === "cliente" && styles.roleTextActive]}>Cliente</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setRole("administrador")} style={[styles.roleButton, role === "administrador" && styles.roleButtonActive]}>
              <Text style={[styles.roleText, role === "administrador" && styles.roleTextActive]}>Administrador</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setRole("empleado")} style={[styles.roleButton, role === "empleado" && styles.roleButtonActive]}>
              <Text style={[styles.roleText, role === "empleado" && styles.roleTextActive]}>Empleado</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.form}>
          {mode === "register" && <View style={styles.inputWrap}><UserRound size={18} color={BRAND.muted} /><TextInput value={name} onChangeText={setName} placeholder="Nombre completo" placeholderTextColor={BRAND.muted} autoCapitalize="words" autoCorrect={false} textContentType="name" style={styles.input} accessibilityLabel="Nombre completo" /></View>}
          <View style={styles.inputWrap}>
            <Mail size={18} color={BRAND.muted} />
            <TextInput value={email} onChangeText={setEmail} placeholder="Correo electrónico" placeholderTextColor={BRAND.muted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" style={styles.input} accessibilityLabel="Correo electrónico" />
          </View>
          {mode === "register" && <View style={styles.inputWrap}><Phone size={18} color={BRAND.muted} /><TextInput value={phone} onChangeText={setPhone} placeholder="Teléfono (opcional)" placeholderTextColor={BRAND.muted} keyboardType="phone-pad" textContentType="telephoneNumber" style={styles.input} accessibilityLabel="Teléfono opcional" /></View>}
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
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => void submit()} style={[styles.primary, loading && styles.disabled]}>
          <Text style={styles.primaryText}>{loading ? "Procesando…" : mode === "recovery" ? "Enviar correo" : mode === "login" ? `Iniciar como ${role === "administrador" ? "administrador" : role === "empleado" ? "empleado" : "cliente"}` : "Crear cuenta"}</Text>
          <ArrowRight size={18} color="#FFFFFF" />
        </Pressable>
        {mode === "login" && <Pressable onPress={() => { setMode("recovery"); setMessage(""); }} style={styles.forgot}><Text style={styles.linkText}>¿Olvidaste tu contraseña?</Text></Pressable>}
        {mode === "recovery" && <Pressable onPress={() => { setMode("login"); setMessage(""); }} style={styles.back}><ArrowLeft size={15} color={BRAND.primaryDark} /><Text style={styles.backText}>Volver a iniciar sesión</Text></Pressable>}
        {mode !== "recovery" && (
          <Pressable onPress={() => { setMode((value) => value === "login" ? "register" : "login"); setRole("cliente"); setMessage(""); }} style={styles.switch}>
            <Text style={styles.switchText}>{mode === "login" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}<Text style={styles.switchAccent}>{mode === "login" ? "Regístrate" : "Inicia sesión"}</Text></Text>
          </Pressable>
        )}
        <Text style={styles.security}>Tus datos se validan con Firebase Authentication.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BRAND.background },
  glow: { position: "absolute", width: 280, height: 280, borderRadius: 140, backgroundColor: BRAND.softPink, top: -100, right: -80 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 62, alignItems: "center" },
  logo: { width: 82, height: 82, borderRadius: 41, backgroundColor: BRAND.surface },
  brand: { color: BRAND.wine, fontSize: 21, fontWeight: "900", letterSpacing: 3, marginTop: 11 },
  eyebrow: { color: BRAND.primaryDark, fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginTop: 35 },
  title: { color: BRAND.wine, fontSize: 30, lineHeight: 36, fontWeight: "800", textAlign: "center", marginTop: 8 },
  subtitle: { color: BRAND.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8, maxWidth: 320 },
  roleSelector: { width: "100%", flexDirection: "row", gap: 8, marginTop: 18, padding: 4, borderRadius: 999, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border },
  roleButton: { flex: 1, minHeight: 42, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  roleButtonActive: { backgroundColor: BRAND.primary },
  roleText: { color: BRAND.primaryDark, fontSize: 13, fontWeight: "800" },
  roleTextActive: { color: "#FFFFFF" },
  form: { width: "100%", gap: 12, marginTop: 15 },
  inputWrap: { minHeight: 54, borderWidth: 1, borderColor: BRAND.border, backgroundColor: BRAND.surface, borderRadius: 18, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 9 },
  input: { flex: 1, color: BRAND.wine, fontSize: 16 },
  message: { width: "100%", color: BRAND.error, fontSize: 13, lineHeight: 18, marginTop: 12 },
  primary: { width: "100%", minHeight: 54, borderRadius: 999, backgroundColor: BRAND.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginTop: 18 },
  disabled: { opacity: 0.65 },
  primaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  forgot: { marginTop: 15, paddingVertical: 7 },
  linkText: { color: BRAND.primaryDark, fontSize: 14, fontWeight: "800" },
  back: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 15, paddingVertical: 7 },
  backText: { color: BRAND.primaryDark, fontSize: 14, fontWeight: "800" },
  switch: { marginTop: 12, paddingVertical: 6 },
  switchText: { color: BRAND.muted, fontSize: 14 },
  switchAccent: { color: BRAND.primaryDark, fontWeight: "800" },
  security: { color: BRAND.muted, fontSize: 11, marginTop: "auto", marginBottom: 24 },
});
