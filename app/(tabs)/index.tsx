import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { CalendarDays, Clock3, Scissors, TrendingUp, UsersRound } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { appointmentMillis, appointmentStatusLabel, subscribeAdminAppointments, type AppointmentRecord } from "@/lib/appointments";
import { isCompletedAppointmentStatus } from "@/lib/appointment-status";
import { formatCurrency } from "@/lib/formatCurrency";
import { hasProfileRole } from "@/lib/roles";
import { useThemeContext } from "@/lib/theme-provider";

function SummaryContent() {
  const { user, profile } = useAuthSession();
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";
  const uid = user?.uid;
  const isAdmin = hasProfileRole(profile, ["admin"]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const firstTick = setTimeout(() => setNow(Date.now()), 0);
    const minuteTick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearTimeout(firstTick); clearInterval(minuteTick); };
  }, []);

  useEffect(() => {
    if (!uid || !isAdmin) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (!active) return;
      try {
        unsubscribe = subscribeAdminAppointments((items) => {
          if (!active) return;
          setAppointments(items); setError(""); setLoading(false);
        }, (reason) => {
          if (!active) return;
          console.warn("No se pudo cargar el resumen de citas.", reason);
          setError("No pudimos cargar las citas. Intenta de nuevo."); setLoading(false);
        });
      } catch (reason) {
        if (!active) return;
        console.warn("No se pudo abrir el resumen de citas.", reason);
        setError("No pudimos cargar las citas. Intenta de nuevo.");
        setLoading(false);
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); unsubscribe?.(); };
  }, [uid, isAdmin]);

  const upcoming = useMemo(() => appointments
    .filter((item) => appointmentMillis(item.inicio) !== null && (appointmentMillis(item.inicio) as number) >= now && !["cancelada", "rechazada", "expirada"].includes(item.estado))
    .sort((a, b) => (appointmentMillis(a.inicio) ?? 0) - (appointmentMillis(b.inicio) ?? 0)), [appointments, now]);
  const pendingCount = appointments.filter((item) => ["hold", "pendiente_de_aprobacion"].includes(item.estado)).length;
  const completedRevenue = appointments.filter((item) => isCompletedAppointmentStatus(item.estado)).reduce((total, item) => total + (Number(item.precio) || 0), 0);
  const performance = useMemo(() => {
    const groups = new Map<string, { employee: string; service: string; count: number; actualTotal: number; estimated: number }>();
    appointments.filter((item) => isCompletedAppointmentStatus(item.estado) && Number(item.duracionRealMin) > 0).forEach((item) => {
      const key = `${item.empleadoUid ?? item.empleadoId ?? item.empleadoNombre ?? "sin-empleado"}:${item.servicioId}`;
      const row = groups.get(key) ?? { employee: String(item.empleadoNombre ?? "Empleado"), service: String(item.servicioNombre ?? "Servicio"), count: 0, actualTotal: 0, estimated: Number(item.duracionMin) || 0 };
      row.count += 1;
      row.actualTotal += Number(item.duracionRealMin);
      groups.set(key, row);
    });
    return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  }, [appointments]);

  return (
    <AuthGate allowedRoles={["admin", "administrador"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.name ?? profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.hero}>
            <View><Text style={[styles.eyebrow, isDark && styles.onDarkText]}>RESUMEN DE TU ESTUDIO</Text><Text style={[styles.headline, isDark && styles.onDarkText]}>Todo bajo control,</Text><Text style={[styles.headlineAccent, isDark && styles.onDarkText]}>un día a la vez.</Text></View>
            <View style={styles.datePill}><CalendarDays size={15} color={BRAND.primary} /><Text style={styles.dateText}>{now ? new Date(now).toLocaleDateString("es-HN", { timeZone: "America/Tegucigalpa", day: "numeric", month: "short" }) : "—"}</Text></View>
          </View>
          <View style={styles.metrics}>
            <Metric icon={<Clock3 size={19} color={BRAND.primary} />} label="Solicitudes" value={String(pendingCount)} detail="Pendientes de respuesta" />
            <Metric icon={<UsersRound size={19} color={BRAND.success} />} label="Citas próximas" value={String(upcoming.length)} detail="En agenda en vivo" />
          </View>
          <View style={styles.metrics}>
            <Metric icon={<TrendingUp size={19} color={BRAND.gold} />} label="Ingresos completados" value={formatCurrency(completedRevenue)} detail="Citas del periodo visible" />
            <Metric icon={<CalendarDays size={19} color={BRAND.wine} />} label="Registros" value={String(appointments.length)} detail="Últimos 30 días" />
          </View>
          <View style={styles.sectionRow}><Text style={[styles.sectionTitle, isDark && styles.onDarkText]}>Próximas citas</Text><Pressable onPress={() => router.push("/employee/schedule")}><Text style={[styles.link, isDark && styles.onDarkText]}>Ver agenda</Text></Pressable></View>
          {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={[styles.stateText, isDark && styles.onDarkMutedText]}>Actualizando en tiempo real…</Text></View> : error ? <View style={styles.state}><Text style={[styles.errorText, isDark && styles.onDarkErrorText]}>{error}</Text><Text style={[styles.stateText, isDark && styles.onDarkMutedText]}>Intenta de nuevo en unos momentos.</Text></View> : upcoming.length === 0 ? <Empty icon={<Clock3 size={23} color={BRAND.primary} />} title="No hay citas próximas" text="Las solicitudes reales aparecerán aquí cuando un cliente reserve." /> : upcoming.slice(0, 5).map((item) => <AppointmentTile key={item.id} item={item} />)}
          <Pressable accessibilityRole="button" onPress={() => router.push("../admin/services")} style={styles.serviceManager}><View style={styles.serviceIcon}><Scissors size={19} color={BRAND.primaryDark} /></View><View style={{ flex: 1 }}><Text style={styles.serviceManagerTitle}>Servicios y tiempos estimados</Text><Text style={styles.serviceManagerHint}>Configura precio y duración para calcular la disponibilidad</Text></View><Text style={styles.managerLink}>Abrir</Text></Pressable>
          <View style={styles.sectionRow}><Text style={[styles.sectionTitle, isDark && styles.onDarkText]}>Rendimiento del equipo</Text><Text style={[styles.period, isDark && styles.onDarkMutedText]}>Citas completadas · 30 días</Text></View>
          {performance.length === 0 ? <Empty icon={<TrendingUp size={22} color={BRAND.primary} />} title="Aún no hay tiempos reales" text="Cuando un empleado inicie y finalice un servicio, aquí verás los minutos reales por empleado y tipo de trabajo." /> : performance.map((item) => <View key={`${item.employee}:${item.service}`} style={styles.performanceCard}><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.performanceName}>{item.employee}</Text><Text numberOfLines={1} style={styles.performanceService}>{item.service}</Text></View><View style={styles.performanceNumbers}><Text style={styles.performanceAverage}>{formatMinutes(item.actualTotal / item.count)}</Text><Text style={styles.performanceDetail}>promedio real · {item.count} trabajo{item.count === 1 ? "" : "s"}</Text>{item.estimated > 0 ? <Text style={styles.performanceDetail}>Estimado: {formatMinutes(item.estimated)}</Text> : null}</View></View>)}
        </ScrollView>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function SummaryScreen() { return <SummaryContent />; }

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <View style={styles.metric}><View style={styles.metricIcon}>{icon}</View><Text style={styles.metricLabel}>{label}</Text><Text numberOfLines={1} style={styles.metricValue}>{value}</Text><Text style={styles.metricDetail}>{detail}</Text></View>;
}
function AppointmentTile({ item }: { item: AppointmentRecord }) {
  const date = appointmentMillis(item.inicio);
  const when = date ? new Date(date).toLocaleString("es-HN", { timeZone: "America/Tegucigalpa", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Fecha por confirmar";
  const client = String(item.clienteNombre || item.clienteEmail || "Cliente");
  return <View style={styles.appointment}><View style={styles.appointmentTop}><Text numberOfLines={1} style={styles.client}>{client}</Text><Text style={styles.status}>{appointmentStatusLabel(item.estado)}</Text></View><Text style={styles.service}>{String(item.servicioNombre ?? "Servicio")}{item.empleadoNombre ? ` · ${String(item.empleadoNombre)}` : ""}</Text><Text style={styles.date}>{when}</Text></View>;
}
function formatMinutes(value: number) { const total = Math.round(value); const hours = Math.floor(total / 60); const minutes = total % 60; return hours > 0 ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min`; }
function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <View style={styles.empty}>{icon}<Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  hero: { paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 5 },
  eyebrow: { color: BRAND.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  headline: { color: BRAND.wine, fontSize: 27, fontWeight: "800", marginTop: 5 },
  headlineAccent: { color: BRAND.primary, fontSize: 27, fontWeight: "800", marginTop: 1 },
  onDarkText: { color: BRAND.onDarkText },
  onDarkMutedText: { color: BRAND.onDarkMutedText },
  onDarkErrorText: { color: BRAND.onDarkErrorText },
  datePill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: BRAND.surface, borderRadius: 999, borderWidth: 1, borderColor: BRAND.border, paddingHorizontal: 10, paddingVertical: 8 },
  dateText: { color: BRAND.muted, fontSize: 10, fontWeight: "700" },
  metrics: { flexDirection: "row", gap: 12, paddingHorizontal: 20, marginTop: 14 },
  metric: { flex: 1, minHeight: 128, backgroundColor: BRAND.surface, borderRadius: 20, borderWidth: 1, borderColor: BRAND.border, padding: 13 },
  metricIcon: { width: 35, height: 35, borderRadius: 12, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" },
  metricLabel: { color: BRAND.muted, fontSize: 11, fontWeight: "700", marginTop: 9 },
  metricValue: { color: BRAND.wine, fontSize: 17, fontWeight: "800", marginTop: 3 },
  metricDetail: { color: BRAND.muted, fontSize: 10, marginTop: 3 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginTop: 24, marginBottom: 11 },
  sectionTitle: { color: BRAND.wine, fontSize: 16, fontWeight: "800" },
  link: { color: BRAND.primaryDark, fontSize: 12, fontWeight: "800" },
  managerLink: { color: BRAND.primaryDark, fontSize: 12, fontWeight: "800" },
  state: { alignItems: "center", gap: 8, padding: 24, marginHorizontal: 20 },
  stateText: { color: BRAND.muted, fontSize: 12, textAlign: "center" },
  errorText: { color: BRAND.error, fontSize: 13, textAlign: "center" },
  empty: { alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 22, marginHorizontal: 20, padding: 21, borderWidth: 1, borderColor: BRAND.border },
  emptyTitle: { color: BRAND.wine, fontSize: 14, fontWeight: "800", marginTop: 9, textAlign: "center" },
  emptyText: { color: BRAND.muted, fontSize: 12, textAlign: "center", lineHeight: 17, marginTop: 4 },
  appointment: { backgroundColor: BRAND.surface, borderRadius: 18, borderWidth: 1, borderColor: BRAND.border, padding: 14, marginHorizontal: 20, marginBottom: 9 },
  appointmentTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  client: { color: BRAND.wine, fontSize: 14, fontWeight: "800", flex: 1 },
  status: { color: BRAND.primaryDark, backgroundColor: BRAND.softPink, overflow: "hidden", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 10, fontWeight: "800" },
  service: { color: BRAND.wine, fontSize: 12, marginTop: 5 },
  date: { color: BRAND.muted, fontSize: 11, marginTop: 4, textTransform: "capitalize" },
  serviceManager: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, marginTop: 20, padding: 13, borderRadius: 18, backgroundColor: BRAND.softPink },
  serviceIcon: { width: 37, height: 37, borderRadius: 13, backgroundColor: BRAND.surface, alignItems: "center", justifyContent: "center" }, serviceManagerTitle: { color: BRAND.wine, fontSize: 12, fontWeight: "800" }, serviceManagerHint: { color: BRAND.muted, fontSize: 10, lineHeight: 14, marginTop: 3 }, period: { color: BRAND.muted, fontSize: 9 },
  performanceCard: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, marginBottom: 8, padding: 13, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, borderRadius: 17 }, performanceName: { color: BRAND.wine, fontSize: 12, fontWeight: "800" }, performanceService: { color: BRAND.muted, fontSize: 10, marginTop: 3 }, performanceNumbers: { alignItems: "flex-end" }, performanceAverage: { color: BRAND.primaryDark, fontSize: 14, fontWeight: "800" }, performanceDetail: { color: BRAND.muted, fontSize: 9, marginTop: 2 },
});
