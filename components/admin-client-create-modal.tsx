import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Check, LockKeyhole, Mail, Phone, UserRound, X } from "lucide-react-native";
import { BirthdayPicker } from "@/components/birthday-picker";
import { BRAND } from "@/constants/brand";
import { createAdminClientAccount } from "@/lib/profiles";
import { normalizeCustomerPhone } from "@/lib/customer-fields";

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (email: string) => void;
};

export function AdminClientCreateModal({ visible, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [birthdayDay, setBirthdayDay] = useState<number | null>(null);
  const [birthdayMonth, setBirthdayMonth] = useState<number | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);
  const [message, setMessage] = useState("");
  const [createdEmail, setCreatedEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setEmail("");
    setPhone("");
    setTemporaryPassword("");
    setPasswordConfirmation("");
    setBirthdayDay(null);
    setBirthdayMonth(null);
    setShowPasswords(false);
    setMessage("");
    setCreatedEmail("");
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const create = async () => {
    if (saving || createdEmail) return;
    setMessage("");
    const trimmedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = normalizeCustomerPhone(phone);
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      setMessage("Escribe un nombre de 2 a 100 caracteres.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setMessage("Escribe un correo electrónico válido.");
      return;
    }
    if (!normalizedPhone) {
      setMessage("Escribe un teléfono hondureño de 8 dígitos o uno internacional con +.");
      return;
    }
    if (temporaryPassword.length < 8 || temporaryPassword.length > 128) {
      setMessage("La contraseña provisional debe tener al menos 8 caracteres.");
      return;
    }
    if (temporaryPassword !== passwordConfirmation) {
      setMessage("Las contraseñas no coinciden.");
      return;
    }

    setSaving(true);
    try {
      const result = await createAdminClientAccount({
        name: trimmedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        temporaryPassword,
        ...(birthdayDay && birthdayMonth ? { birthdayDay, birthdayMonth } : {}),
      });
      setCreatedEmail(result.email);
      setShowPasswords(true);
      onCreated(result.email);
    } catch (reason) {
      const code = (reason as { code?: string }).code ?? "";
      console.warn("No se pudo crear el perfil de cliente.", code);
      setMessage(code.includes("already-exists")
        ? "Este correo ya tiene una cuenta. Usa otro correo o solicita acceso a administración."
        : code.includes("permission-denied")
          ? "No tienes permiso para crear esta cuenta."
          : "No pudimos crear el perfil. Revisa los datos e inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
      <View style={styles.shade}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>NUEVO PERFIL</Text>
              <Text style={styles.title}>{createdEmail ? "Cuenta creada" : "Crear cliente"}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" disabled={saving} onPress={close} style={styles.close}>
              <X size={19} color={BRAND.wine} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>{createdEmail ? "Entrega la contraseña provisional de forma privada. El cliente deberá cambiarla al iniciar sesión por primera vez." : "La persona tendrá que elegir una contraseña nueva al iniciar sesión por primera vez."}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.form}>
            <Text style={styles.label}>Nombre completo</Text>
            <View style={styles.inputWrap}><UserRound size={17} color={BRAND.muted} /><TextInput value={name} onChangeText={setName} editable={!createdEmail && !saving} placeholder="Nombre del cliente" placeholderTextColor={BRAND.muted} autoCapitalize="words" textContentType="name" style={styles.input} /></View>

            <Text style={styles.label}>Correo electrónico</Text>
            <View style={styles.inputWrap}><Mail size={17} color={BRAND.muted} /><TextInput value={email} onChangeText={setEmail} editable={!createdEmail && !saving} placeholder="correo@ejemplo.com" placeholderTextColor={BRAND.muted} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" style={styles.input} /></View>

            <Text style={styles.label}>Teléfono</Text>
            <View style={styles.inputWrap}><Phone size={17} color={BRAND.muted} /><TextInput value={phone} onChangeText={setPhone} editable={!createdEmail && !saving} placeholder="8 dígitos o +código de país" placeholderTextColor={BRAND.muted} keyboardType="phone-pad" textContentType="telephoneNumber" style={styles.input} /></View>
            <Text style={styles.hint}>Número hondureño de 8 dígitos o formato internacional con +.</Text>

            <Text style={styles.label}>Contraseña provisional</Text>
            <PasswordInput value={temporaryPassword} onChangeText={setTemporaryPassword} visible={showPasswords} editable={!createdEmail && !saving} placeholder="Al menos 8 caracteres" />
            {!createdEmail && <>
              <Text style={styles.label}>Confirmar contraseña</Text>
              <PasswordInput value={passwordConfirmation} onChangeText={setPasswordConfirmation} visible={showPasswords} editable={!saving} placeholder="Repite la contraseña" />
            </>}
            {!createdEmail && <Pressable accessibilityRole="button" onPress={() => setShowPasswords((value) => !value)} style={styles.showPassword}><Text style={styles.showPasswordText}>{showPasswords ? "Ocultar contraseñas" : "Mostrar contraseñas"}</Text></Pressable>}

            {!createdEmail && <BirthdayPicker day={birthdayDay} month={birthdayMonth} onChange={(day, month) => { setBirthdayDay(day); setBirthdayMonth(month); }} />}

            {createdEmail ? <View style={styles.successBox}>
              <View style={styles.successTitleRow}><Check size={17} color={BRAND.success} /><Text style={styles.successTitle}>Perfil creado para {createdEmail}</Text></View>
              <Text style={styles.successText}>Contraseña provisional para entregar al cliente:</Text>
              <Text selectable style={styles.passwordReceipt}>{temporaryPassword}</Text>
              <Text style={styles.successText}>No se guarda en el perfil. Solo aparece mientras esta ventana siga abierta.</Text>
              <Pressable accessibilityRole="button" onPress={close} style={styles.done}><Text style={styles.doneText}>Listo</Text></Pressable>
            </View> : <>
              {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" disabled={saving} onPress={close} style={styles.cancel}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={saving} onPress={() => void create()} style={[styles.submit, saving && styles.disabled]}>
                  <Text style={styles.submitText}>{saving ? "Creando…" : "Crear cuenta"}</Text>
                </Pressable>
              </View>
            </>}
          </ScrollView>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

function PasswordInput({ value, onChangeText, visible, editable, placeholder }: { value: string; onChangeText: (value: string) => void; visible: boolean; editable: boolean; placeholder: string }) {
  return <View style={styles.inputWrap}><LockKeyhole size={17} color={BRAND.muted} /><TextInput value={value} onChangeText={onChangeText} editable={editable} placeholder={placeholder} placeholderTextColor={BRAND.muted} secureTextEntry={!visible} autoCapitalize="none" style={styles.input} /></View>;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1, justifyContent: "flex-end" },
  shade: { flex: 1, backgroundColor: "rgba(40,15,26,.48)", justifyContent: "flex-end" },
  sheet: { maxHeight: "92%", backgroundColor: BRAND.background, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingBottom: 26 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerCopy: { flex: 1 },
  eyebrow: { color: BRAND.primaryDark, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: BRAND.wine, fontSize: 22, fontWeight: "800", marginTop: 3 },
  close: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: BRAND.border, backgroundColor: BRAND.surface, alignItems: "center", justifyContent: "center" },
  subtitle: { color: BRAND.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  form: { gap: 8, paddingTop: 14, paddingBottom: 7 },
  label: { color: BRAND.wine, fontSize: 11, fontWeight: "800", marginTop: 5 },
  inputWrap: { minHeight: 48, borderWidth: 1, borderColor: BRAND.border, backgroundColor: BRAND.surface, borderRadius: 15, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, color: BRAND.wine, fontSize: 14 },
  hint: { color: BRAND.muted, fontSize: 10, lineHeight: 14, marginTop: -3 },
  showPassword: { alignSelf: "flex-end", paddingVertical: 3 },
  showPasswordText: { color: BRAND.primaryDark, fontSize: 11, fontWeight: "800" },
  error: { color: BRAND.error, fontSize: 12, lineHeight: 17, marginTop: 4 },
  actions: { flexDirection: "row", gap: 9, marginTop: 8 },
  cancel: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: BRAND.border, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: BRAND.surface },
  cancelText: { color: BRAND.primaryDark, fontSize: 13, fontWeight: "800" },
  submit: { flex: 1, minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: BRAND.primary },
  submitText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  successBox: { backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, borderRadius: 17, padding: 14, gap: 8, marginTop: 5 },
  successTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  successTitle: { flex: 1, color: BRAND.wine, fontSize: 12, fontWeight: "800" },
  successText: { color: BRAND.muted, fontSize: 11, lineHeight: 16 },
  passwordReceipt: { color: BRAND.wine, backgroundColor: BRAND.softPink, borderRadius: 12, padding: 11, fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  done: { minHeight: 45, borderRadius: 999, backgroundColor: BRAND.primary, alignItems: "center", justifyContent: "center", marginTop: 4 },
  doneText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
});
