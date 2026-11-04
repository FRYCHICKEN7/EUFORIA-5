import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Check, Clock3 } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { loadEmployeeAvailability, saveEmployeeAvailability, type WeeklyAvailabilityDay } from "@/lib/profiles";
import { profileRole } from "@/lib/roles";

const WEEK = [
  { id: 1, label: "Lunes" }, { id: 2, label: "Martes" }, { id: 3, label: "Miércoles" },
  { id: 4, label: "Jueves" }, { id: 5, label: "Viernes" }, { id: 6, label: "Sábado" }, { id: 0, label: "Domingo" },
];
const DEFAULT_WEEK: WeeklyAvailabilityDay[] = Array.from({ length: 7 }, (_, dia) => ({ dia, activo: false, inicio: "08:00", fin: "17:00" }));

function AvailabilityContent() {
  const { user, profile } = useAuthSession();
  const uid = user?.uid;
  const isEmployee = profileRole(profile) === "empleado";
  const [businessName, setBusinessName] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [available, setAvailable] = useState(false);
  const [days, setDays] = useState(DEFAULT_WEEK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!uid || !isEmployee) return;
    let active = true;
    const timer = setTimeout(() => {
      void loadEmployeeAvailability(uid).then((data) => {
        if (!active) return;
        setBusinessId(data.negocioId);
        setAvailable(data.disponible);
        setDays(data.dias);
      }).catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudo cargar tu horario.");
      }).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [uid, isEmployee]);

  useEffect(() => {
    if (!businessId) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(async () => {
      try {
        const { loadBusinesses } = await import("@/lib/appointments");
        const businesses = await loadBusinesses();
        if (active) setBusinessName(businesses.find((item) => item.id === businessId)?.nombre ?? businessId);
      } catch { if (active) setBusinessName(businessId); }
    }, 0);
    return () => { active = false; clearTimeout(timer); unsubscribe?.(); };
  }, [businessId]);

  const toggleDay = (dayId: number) => setDays((current) => current.map((item) => item.dia === dayId ? { ...item, activo: !item.activo } : item));
  const changeTime = (dayId: number, field: "inicio" | "fin", value: string) => setDays((current) => current.map((item) => item.dia === dayId ? { ...item, [field]: value } : item));

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await saveEmployeeAvailability({ disponible: available, dias: days });
      setMessage(result.disponible ? "Horario guardado. Ya apareces como disponible en las franjas que caben." : "Horario guardado. Tu perfil no aparecerá disponible para nuevas reservas.");
    } catch (reason) {
      const code = (reason as { code?: string })?.code ?? "";
      setError(code.includes("permission-denied") ? "No se autorizó este cambio. Solo el empleado aprobado puede editar su propio horario." : reason instanceof Error ? reason.message : "No se pudo guardar el horario. Comprueba Cloud Functions.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthGate allowedRoles={["empleado"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.name ?? profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.heading}><Text style={styles.eyebrow}>TU AGENDA</Text><Text style={styles.title}>Disponibilidad</Text><Text style={styles.subtitle}>Define cuándo puede elegirte un cliente. Horas locales de Honduras.</Text></View>
          <View style={styles.business}><Text style={styles.businessLabel}>Negocio asignado</Text><Text style={styles.businessName}>{businessName || businessId || "Cargando…"}</Text></View>
          <View style={styles.availableCard}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: available }} onPress={() => setAvailable((value) => !value)} style={[styles.check, available && styles.checkSelected]}><Check size={17} color={available ? "#FFFFFF" : BRAND.muted} /></Pressable>
            <View style={styles.availableCopy}><Text style={styles.availableTitle}>Disponible para citas</Text><Text style={styles.availableHint}>{available ? "Tu perfil puede mostrarse a clientes dentro de tus turnos libres." : "Desactivado: los clientes no podrán seleccionarte."}</Text></View>
          </View>
          <View style={styles.note}><Clock3 size={17} color={BRAND.primaryDark} /><Text style={styles.noteText}>Cada servicio debe caber completo antes de terminar tu turno. Los cruces con citas existentes no se ofrecen.</Text></View>
          <Text style={styles.sectionTitle}>Horario semanal</Text>
          {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={styles.stateText}>Cargando tu horario guardado…</Text></View> : WEEK.map(({ id, label }) => {
            const day = days.find((item) => item.dia === id) ?? DEFAULT_WEEK[id];
            return <View key={id} style={[styles.dayCard, !day.activo && styles.dayDisabled]}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: day.activo }} onPress={() => toggleDay(id)} style={[styles.dayCheck, day.activo && styles.dayCheckActive]}><Check size={14} color={day.activo ? "#FFFFFF" : BRAND.muted} /></Pressable>
              <Text style={styles.dayName}>{label}</Text>
              {day.activo ? <View style={styles.timeGroup}><TextInput accessibilityLabel={`${label}: hora de inicio`} value={day.inicio} onChangeText={(value) => changeTime(id, "inicio", value)} keyboardType="numbers-and-punctuation" maxLength={5} style={styles.timeInput} /><Text style={styles.to}>a</Text><TextInput accessibilityLabel={`${label}: hora de fin`} value={day.fin} onChangeText={(value) => changeTime(id, "fin", value)} keyboardType="numbers-and-punctuation" maxLength={5} style={styles.timeInput} /></View> : <Text style={styles.dayOff}>Descanso</Text>}
            </View>;
          })}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
          <Pressable disabled={loading || saving} onPress={() => void save()} style={[styles.saveButton, (loading || saving) && styles.disabled]}><Text style={styles.saveText}>{saving ? "Guardando…" : "Guardar horario y disponibilidad"}</Text></Pressable>
          <Text style={styles.footer}>El horario inicial sugerido es 08:00 a 17:00; se guarda solo cuando presionas el botón.</Text>
        </ScrollView>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function EmployeeAvailabilityScreen() { return <AvailabilityContent />; }

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  heading: { paddingHorizontal: 20, marginTop: 8 }, eyebrow: { color: BRAND.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.3 }, title: { color: BRAND.wine, fontSize: 28, fontWeight: "800", marginTop: 5 }, subtitle: { color: BRAND.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  business: { marginHorizontal: 20, marginTop: 15, padding: 13, borderRadius: 16, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border }, businessLabel: { color: BRAND.muted, fontSize: 10, fontWeight: "700" }, businessName: { color: BRAND.wine, fontSize: 14, fontWeight: "800", marginTop: 4 },
  availableCard: { flexDirection: "row", gap: 11, alignItems: "center", marginHorizontal: 20, marginTop: 11, padding: 14, borderRadius: 18, backgroundColor: BRAND.softPink }, check: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border }, checkSelected: { backgroundColor: BRAND.primary, borderColor: BRAND.primary }, availableCopy: { flex: 1 }, availableTitle: { color: BRAND.wine, fontSize: 13, fontWeight: "800" }, availableHint: { color: BRAND.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  note: { flexDirection: "row", gap: 8, alignItems: "center", marginHorizontal: 20, marginTop: 11, padding: 12, borderRadius: 14, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border }, noteText: { flex: 1, color: BRAND.muted, fontSize: 10, lineHeight: 15 }, sectionTitle: { color: BRAND.wine, fontSize: 16, fontWeight: "800", marginHorizontal: 20, marginTop: 22, marginBottom: 10 },
  dayCard: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 9, marginHorizontal: 20, marginBottom: 7, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 15, borderWidth: 1, borderColor: BRAND.border, backgroundColor: BRAND.surface }, dayDisabled: { backgroundColor: "#FFF9FA" }, dayCheck: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BRAND.border }, dayCheckActive: { backgroundColor: BRAND.primary, borderColor: BRAND.primary }, dayName: { width: 77, color: BRAND.wine, fontSize: 12, fontWeight: "800" }, timeGroup: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 }, timeInput: { flex: 1, minWidth: 55, height: 36, textAlign: "center", borderRadius: 10, borderWidth: 1, borderColor: BRAND.border, color: BRAND.wine, backgroundColor: BRAND.background, fontSize: 12, fontWeight: "700" }, to: { color: BRAND.muted, fontSize: 10 }, dayOff: { flex: 1, color: BRAND.muted, fontSize: 11, textAlign: "right" },
  state: { flexDirection: "row", gap: 9, justifyContent: "center", alignItems: "center", padding: 20 }, stateText: { color: BRAND.muted, fontSize: 12 }, error: { color: BRAND.error, fontSize: 12, lineHeight: 17, marginHorizontal: 20, marginTop: 12 }, message: { color: BRAND.primaryDark, fontSize: 12, lineHeight: 17, marginHorizontal: 20, marginTop: 12 }, saveButton: { minHeight: 50, marginHorizontal: 20, marginTop: 16, borderRadius: 999, backgroundColor: BRAND.primary, alignItems: "center", justifyContent: "center" }, saveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" }, disabled: { opacity: .55 }, footer: { color: BRAND.muted, fontSize: 10, lineHeight: 15, textAlign: "center", marginHorizontal: 20, marginTop: 10 },
});
