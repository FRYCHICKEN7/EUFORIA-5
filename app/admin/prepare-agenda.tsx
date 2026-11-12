import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft, CalendarDays, Check, Clock3 } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { ScreenContainer } from "@/components/screen-container";
import { BRAND } from "@/constants/brand";
import { useAuthSession } from "@/lib/auth-session";
import { AppointmentPlanError } from "@/lib/appointment-migration";
import { prepareExistingBusinessAppointments } from "@/lib/appointment-preparation";
import { loadBusinesses, type BusinessRecord } from "@/lib/appointments";
import { useThemeContext } from "@/lib/theme-provider";

function PreparationContent() {
  const { profile, user } = useAuthSession();
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void loadBusinesses().then((items) => {
      if (!active) return;
      setBusinesses(items);
      setSelectedBusinessId((current) => items.some((item) => item.id === current) ? current : items.length === 1 ? items[0].id : "");
      setError("");
    }).catch((reason) => {
      console.warn("No se pudieron cargar los negocios para preparar la agenda.", reason);
      if (active) setError("No pudimos cargar los negocios. Revisa tu conexión e inténtalo de nuevo.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const selectedBusiness = businesses.find((item) => item.id === selectedBusinessId);

  const prepareAgenda = async () => {
    if (!selectedBusiness || preparing) return;
    setPreparing(true);
    setMessage("");
    setBusinesses((current) => current.map((item) => item.id === selectedBusiness.id
      ? { ...item, reservasSparkPreparadas: false }
      : item));
    try {
      const result = await prepareExistingBusinessAppointments(selectedBusiness.id);
      setBusinesses((current) => current.map((item) => item.id === selectedBusiness.id
        ? { ...item, reservasSparkPreparadas: true }
        : item));
      setMessage(`Agenda lista. Se revisaron ${result.citasRevisadas} citas y se prepararon ${result.espaciosPreparados} espacios de horario.`);
    } catch (reason) {
      console.warn("No se pudo preparar la agenda.", reason);
      const detail = reason instanceof AppointmentPlanError
        ? reason.message
        : reason instanceof Error && ["Solo administración", "Inicia sesión", "Elige un negocio", "El negocio dejó", "La agenda ya se está"].some((prefix) => reason.message.startsWith(prefix))
          ? reason.message
          : "No pudimos terminar la preparación.";
      setBusinesses((current) => current.map((item) => item.id === selectedBusiness.id
        ? { ...item, reservasSparkPreparadas: false }
        : item));
      setMessage(`${detail} Las reservas siguen cerradas.`);
    } finally { setPreparing(false); }
  };

  return (
    <AuthGate allowedRoles={["admin", "administrador"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
            <ArrowLeft size={17} color={BRAND.primaryDark} /><Text style={styles.backText}>Volver a Ajustes</Text>
          </Pressable>
          <View style={styles.heading}>
            <Text style={[styles.eyebrow, isDark && { color: BRAND.onDarkText }]}>AGENDA DEL NEGOCIO</Text>
            <Text style={[styles.title, isDark && { color: BRAND.onDarkText }]}>Preparar agenda</Text>
            <Text style={[styles.subtitle, isDark && { color: BRAND.onDarkMutedText }]}>Antes de recibir nuevas solicitudes, prepara aquí las citas que ya están registradas.</Text>
          </View>

          <View style={styles.infoCard}>
            <Clock3 size={19} color={BRAND.primary} />
            <Text style={styles.infoText}>Mientras se prepara, las nuevas reservas permanecen cerradas. Si hay citas superpuestas o datos incompletos, el proceso se detiene y no abre la agenda.</Text>
          </View>

          {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={styles.stateText}>Cargando negocios…</Text></View> : error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : businesses.length === 0 ? (
            <View style={styles.empty}><CalendarDays size={26} color={BRAND.primary} /><Text style={styles.emptyTitle}>No hay un negocio activo</Text><Text style={styles.emptyText}>Activa el negocio antes de preparar sus horarios.</Text></View>
          ) : (
            <>
              {businesses.length > 1 && <View style={styles.businessList}>{businesses.map((business) => {
                const selected = business.id === selectedBusinessId;
                return <Pressable key={business.id} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { setSelectedBusinessId(business.id); setMessage(""); }} style={[styles.businessChoice, selected && styles.businessChoiceSelected]}><View style={{ flex: 1 }}><Text style={styles.businessName}>{business.nombre}</Text><Text style={styles.businessStatus}>{business.reservasSparkPreparadas ? "Agenda lista" : "Agenda pendiente"}</Text></View>{selected && <Check size={17} color={BRAND.primaryDark} />}</Pressable>;
              })}</View>}

              {selectedBusiness && <View style={styles.card}>
                <Text style={styles.businessName}>{selectedBusiness.nombre}</Text>
                <Text style={styles.statusText}>{selectedBusiness.reservasSparkPreparadas ? "La agenda está lista para recibir nuevas solicitudes." : "Hay que preparar los horarios antes de abrir nuevas reservas."}</Text>
                <Text style={styles.detailText}>La preparación conserva las citas activas, quita horarios antiguos que ya no corresponden y se puede repetir si agregaste citas después.</Text>
                <Pressable accessibilityRole="button" disabled={preparing} onPress={() => void prepareAgenda()} style={[styles.primaryButton, preparing && styles.disabled]}>
                  {preparing ? <ActivityIndicator color="#FFFFFF" /> : <CalendarDays size={17} color="#FFFFFF" />}
                  <Text style={styles.primaryText}>{preparing ? "Preparando agenda…" : selectedBusiness.reservasSparkPreparadas ? "Actualizar preparación" : "Preparar agenda"}</Text>
                </Pressable>
              </View>}
            </>
          )}

          {message ? <Text accessibilityRole="alert" style={[styles.message, message.includes("sigue cerrada") && styles.messageError]}>{message}</Text> : null}
        </ScrollView>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function PrepareAgendaScreen() { return <PreparationContent />; }

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingTop: 8 },
  backText: { color: BRAND.primaryDark, fontSize: 12, fontWeight: "800" },
  heading: { paddingHorizontal: 20, marginTop: 16 },
  eyebrow: { color: BRAND.primaryDark, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" },
  title: { color: BRAND.wine, fontSize: 27, fontWeight: "800", marginTop: 5 },
  subtitle: { color: BRAND.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  infoCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginHorizontal: 20, marginTop: 18, padding: 14, borderRadius: 18, backgroundColor: BRAND.softPink, borderWidth: 1, borderColor: BRAND.border },
  infoText: { flex: 1, color: BRAND.wine, fontSize: 12, lineHeight: 18 },
  state: { alignItems: "center", gap: 9, padding: 26, marginHorizontal: 20 },
  stateText: { color: BRAND.muted, fontSize: 12 },
  error: { color: BRAND.error, fontSize: 12, lineHeight: 18, marginHorizontal: 20, marginTop: 18 },
  empty: { alignItems: "center", marginHorizontal: 20, marginTop: 20, padding: 24, borderRadius: 22, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border },
  emptyTitle: { color: BRAND.wine, fontSize: 16, fontWeight: "800", marginTop: 10 },
  emptyText: { color: BRAND.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 5 },
  businessList: { gap: 8, marginHorizontal: 20, marginTop: 17 },
  businessChoice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 13, borderRadius: 15, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border },
  businessChoiceSelected: { borderColor: BRAND.primary, backgroundColor: BRAND.softPink },
  businessName: { color: BRAND.wine, fontSize: 15, fontWeight: "800" },
  businessStatus: { color: BRAND.muted, fontSize: 11, marginTop: 3 },
  card: { marginHorizontal: 20, marginTop: 17, padding: 17, borderRadius: 22, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border },
  statusText: { color: BRAND.primaryDark, fontSize: 12, lineHeight: 18, fontWeight: "700", marginTop: 8 },
  detailText: { color: BRAND.muted, fontSize: 11, lineHeight: 17, marginTop: 9 },
  primaryButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: 16, borderRadius: 999, backgroundColor: BRAND.primary, paddingHorizontal: 14 },
  primaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  message: { marginHorizontal: 20, marginTop: 13, color: BRAND.success, fontSize: 12, fontWeight: "700", lineHeight: 18 },
  messageError: { color: BRAND.error },
});
