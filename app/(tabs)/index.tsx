import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { CalendarDays, Clock3, TrendingUp, UsersRound } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { appointmentMillis, subscribeAdminAppointments, type AppointmentRecord } from "@/lib/appointments";
import { formatCurrency } from "@/lib/formatCurrency";

function SummaryContent() {
  const { user, profile } = useAuthSession();
  const uid = user?.uid;
  const isAdmin = profile?.rol === "admin" || profile?.rol === "administrador";
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
          setError(reason.message); setLoading(false);
        });
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "No se pudo abrir la agenda.");
        setLoading(false);
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); unsubscribe?.(); };
  }, [uid, isAdmin]);

  const upcoming = useMemo(() => appointments
    .filter((item) => appointmentMillis(item.inicio) !== null && (appointmentMillis(item.inicio) as number) >= now && !["cancelada", "rechazada", "expirada"].includes(item.estado))
    .sort((a, b) => (appointmentMillis(a.inicio) ?? 0) - (appointmentMillis(b.inicio) ?? 0)), [appointments, now]);
  const pendingCount = appointments.filter((item) => ["hold", "pendiente_de_aprobacion"].includes(item.estado)).length;
  const completedRevenue = appointments.filter((item) => item.estado === "completada").reduce((total, item) => total + (Number(item.precio) || 0), 0);

  return (
    <AuthGate allowedRoles={["admin", "administrador"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.hero}>
            <View><Text style={styles.eyebrow}>RESUMEN DE TU ESTUDIO</Text><Text style={styles.headline}>Todo bajo control,</Text><Text style={styles.headlineAccent}>un día a la vez.</Text></View>
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
          <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Próximas citas</Text><Pressable onPress={() => router.push("/employee/schedule")}><Text style={styles.link}>Ver agenda</Text></Pressable></View>
          {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={styles.stateText}>Actualizando en tiempo real…</Text></View> : error ? <View style={styles.state}><Text style={styles.errorText}>No se pudo leer la agenda: {error}</Text><Text style={styles.stateText}>Comprueba reglas e índices de Firestore.</Text></View> : upcoming.length === 0 ? <Empty icon={<Clock3 size={23} color={BRAND.primary} />} title="No hay citas próximas" text="Las solicitudes reales aparecerán aquí cuando un cliente reserve." /> : upcoming.slice(0, 5).map((item) => <AppointmentTile key={item.id} item={item} />)}
          <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Para avisar hoy</Text><Pressable onPress={() => router.push("/(tabs)/notify")}><Text style={styles.link}>Ver avisos</Text></Pressable></View>
          <Empty icon={<UsersRound size={22} color={BRAND.primary} />} title="Lista de avisos conectada próximamente" text="No se inventan nombres ni recordatorios hasta conectar los perfiles y las preferencias reales." />
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
  return <View style={styles.appointment}><View style={styles.appointmentTop}><Text numberOfLines={1} style={styles.client}>{client}</Text><Text style={styles.status}>{item.estado.replaceAll("_", " ")}</Text></View><Text style={styles.service}>{String(item.servicioNombre ?? "Servicio")}{item.empleadoNombre ? ` · ${String(item.empleadoNombre)}` : ""}</Text><Text style={styles.date}>{when}</Text></View>;
}
function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <View style={styles.empty}>{icon}<Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  hero: { paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 5 },
  eyebrow: { color: BRAND.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  headline: { color: BRAND.wine, fontSize: 27, fontWeight: "800", marginTop: 5 },
  headlineAccent: { color: BRAND.primary, fontSize: 27, fontWeight: "800", marginTop: 1 },
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
});
