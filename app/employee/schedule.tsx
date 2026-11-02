import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CalendarDays, Check, X } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { appointmentMillis, decideAppointment, subscribeAdminAppointments, subscribeEmployeeAppointments, type AppointmentRecord } from "@/lib/appointments";

function ScheduleContent() {
  const { user, profile } = useAuthSession();
  const uid = user?.uid;
  const role = String(profile?.rol ?? "").toLowerCase();
  const isAdmin = role === "admin" || role === "administrador";
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!uid || (!isAdmin && role !== "empleado")) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (!active) return;
      try {
        const receiveItems = (items: AppointmentRecord[]) => { if (active) { setAppointments(items); setError(""); setLoading(false); } };
        const receiveError = (reason: Error) => { if (active) { setError(reason.message); setLoading(false); } };
        unsubscribe = isAdmin
          ? subscribeAdminAppointments(receiveItems, receiveError)
          : subscribeEmployeeAppointments(uid, receiveItems, receiveError);
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "No se pudo abrir la agenda.");
        setLoading(false);
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); unsubscribe?.(); };
  }, [uid, isAdmin, role]);

  const sorted = useMemo(() => [...appointments].sort((a, b) => (appointmentMillis(a.inicio) ?? 0) - (appointmentMillis(b.inicio) ?? 0)), [appointments]);
  const pending = sorted.filter((item) => ["hold", "pendiente_de_aprobacion"].includes(item.estado));

  const decide = async (item: AppointmentRecord, action: "aprobarCita" | "rechazarCita") => {
    setBusyId(item.id);
    setMessage("");
    try {
      await decideAppointment(action, item.id);
      setMessage(action === "aprobarCita" ? "Cita confirmada." : "Solicitud rechazada.");
    } catch (reason) {
      const code = (reason as { code?: string })?.code ?? "";
      setMessage(code.includes("permission-denied") ? "Tu perfil no tiene autorización para decidir esta cita." : code.includes("deadline-exceeded") ? "La reserva temporal venció antes de aprobarse." : "No se pudo actualizar la cita. Revisa la conexión y las Functions desplegadas.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <AuthGate allowedRoles={["admin", "administrador", "empleado"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.heading}><Text style={styles.eyebrow}>AGENDA EN TIEMPO REAL</Text><Text style={styles.title}>Solicitudes y citas</Text><Text style={styles.subtitle}>La lista se actualiza automáticamente cuando se crea o decide una reserva.</Text></View>
          <View style={styles.counter}><CalendarDays size={18} color={BRAND.primary} /><Text style={styles.counterText}>{pending.length} solicitud{pending.length === 1 ? " pendiente" : "es pendientes"}</Text></View>
          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
          {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={styles.stateText}>Escuchando cambios de Firestore…</Text></View> : error ? <View style={styles.state}><Text style={styles.errorText}>No se pudo leer la agenda: {error}</Text><Text style={styles.stateText}>Confirma que las reglas y los índices del proyecto Firebase estén aplicados.</Text></View> : sorted.length === 0 ? <View style={styles.empty}><CalendarDays size={28} color={BRAND.primary} /><Text style={styles.emptyTitle}>No hay citas todavía</Text><Text style={styles.emptyText}>Cuando un cliente reserve, aparecerá aquí sin actualizar la pantalla.</Text></View> : sorted.map((item) => <AppointmentCard key={item.id} item={item} busy={busyId === item.id} canDecide={pending.includes(item)} onDecide={decide} />)}
        </ScrollView>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function EmployeeScheduleScreen() { return <ScheduleContent />; }

function AppointmentCard({ item, busy, canDecide, onDecide }: { item: AppointmentRecord; busy: boolean; canDecide: boolean; onDecide: (item: AppointmentRecord, action: "aprobarCita" | "rechazarCita") => void }) {
  const millis = appointmentMillis(item.inicio);
  const when = millis ? new Date(millis).toLocaleString("es-HN", { timeZone: "America/Tegucigalpa", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }) : "Fecha por confirmar";
  const clientName = String(item.clienteNombre || item.clienteEmail || "Cliente");
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}><Text numberOfLines={1} style={styles.client}>{clientName}</Text><Text style={styles.badge}>{item.estado.replaceAll("_", " ")}</Text></View>
      <Text style={styles.service}>{String(item.servicioNombre ?? "Servicio")}{item.empleadoNombre ? ` · ${String(item.empleadoNombre)}` : ""}</Text>
      {item.clienteTelefono ? <Text style={styles.contact}>Tel. {String(item.clienteTelefono)}</Text> : null}
      <Text style={styles.date}>{when}</Text>
      {Number.isFinite(Number(item.precio)) ? <Text style={styles.price}>L. {Number(item.precio).toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text> : null}
      {canDecide && <View style={styles.actions}><Pressable disabled={busy} onPress={() => onDecide(item, "aprobarCita")} style={[styles.approve, busy && styles.disabled]}><Check size={16} color="#FFFFFF" /><Text style={styles.actionText}>{busy ? "Guardando…" : "Aprobar"}</Text></Pressable><Pressable disabled={busy} onPress={() => onDecide(item, "rechazarCita")} style={[styles.reject, busy && styles.disabled]}><X size={16} color={BRAND.error} /><Text style={styles.rejectText}>Rechazar</Text></Pressable></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 }, heading: { paddingHorizontal: 20, marginTop: 10 }, eyebrow: { color: BRAND.primary, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" }, title: { color: BRAND.wine, fontSize: 28, fontWeight: "800", marginTop: 5 }, subtitle: { color: BRAND.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  counter: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 18, padding: 12, backgroundColor: BRAND.softPink, borderRadius: 14 }, counterText: { color: BRAND.wine, fontSize: 13, fontWeight: "800" },
  message: { marginHorizontal: 20, marginTop: 10, color: BRAND.primaryDark, fontSize: 13 }, state: { alignItems: "center", gap: 8, padding: 26, marginHorizontal: 20 }, stateText: { color: BRAND.muted, fontSize: 12, textAlign: "center" }, errorText: { color: BRAND.error, fontSize: 13, textAlign: "center" },
  empty: { alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 24, padding: 28, marginHorizontal: 20, marginTop: 22, borderWidth: 1, borderColor: BRAND.border }, emptyTitle: { color: BRAND.wine, fontSize: 16, fontWeight: "800", marginTop: 10 }, emptyText: { color: BRAND.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 5 },
  card: { backgroundColor: BRAND.surface, borderRadius: 22, marginHorizontal: 20, marginTop: 12, padding: 16, borderWidth: 1, borderColor: BRAND.border }, cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, client: { color: BRAND.wine, fontSize: 15, fontWeight: "800", flex: 1 }, badge: { color: BRAND.primaryDark, backgroundColor: BRAND.softPink, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 10, fontWeight: "800", overflow: "hidden", textTransform: "capitalize" }, service: { color: BRAND.wine, fontSize: 13, marginTop: 7 }, contact: { color: BRAND.muted, fontSize: 12, marginTop: 4 }, date: { color: BRAND.muted, fontSize: 12, marginTop: 4, textTransform: "capitalize" }, price: { color: BRAND.wine, fontSize: 13, fontWeight: "800", marginTop: 8 }, actions: { flexDirection: "row", gap: 9, marginTop: 13 }, approve: { flex: 1, minHeight: 43, borderRadius: 999, backgroundColor: BRAND.success, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, reject: { flex: 1, minHeight: 43, borderRadius: 999, backgroundColor: "#FFF1F2", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, actionText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" }, rejectText: { color: BRAND.error, fontSize: 13, fontWeight: "800" }, disabled: { opacity: 0.55 },
});
