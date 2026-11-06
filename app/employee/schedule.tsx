import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BellRing, CalendarDays, Check, Play, Settings2, X } from "lucide-react-native";
import { router } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { appointmentMillis, appointmentStatusLabel, decideAppointment, finishService, startService, subscribeAdminAppointments, subscribeEmployeeAppointments, type AppointmentRecord } from "@/lib/appointments";
import { markNotificationRead, subscribeNotifications, type AppNotification } from "@/lib/profiles";
import { profileRole } from "@/lib/roles";
import { useThemeContext } from "@/lib/theme-provider";

function ScheduleContent() {
  const { user, profile } = useAuthSession();
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";
  const uid = user?.uid;
  const role = profileRole(profile) ?? "";
  const isAdmin = role === "admin";
  const isEmployee = role === "empleado";
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!uid || (!isAdmin && !isEmployee)) return;
    let active = true;
    let stopAppointments: (() => void) | undefined;
    let stopNotifications: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (!active) return;
      try {
        const receiveAppointments = (items: AppointmentRecord[]) => {
          if (!active) return;
          setAppointments(items);
          setError("");
          setLoading(false);
        };
        const receiveError = (reason: Error) => { console.warn("No se pudo cargar la agenda.", reason); if (active) { setError("No pudimos cargar la agenda. Intenta de nuevo."); setLoading(false); } };
        stopAppointments = isAdmin
          ? subscribeAdminAppointments(receiveAppointments, receiveError)
          : subscribeEmployeeAppointments(uid, receiveAppointments, receiveError);
        if (isEmployee) stopNotifications = subscribeNotifications(uid, (items) => { if (active) setNotifications(items); }, receiveError);
      } catch (reason) {
        if (active) {
          console.warn("No se pudo abrir la agenda.", reason);
          setError("No pudimos cargar la agenda. Intenta de nuevo.");
          setLoading(false);
        }
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); stopAppointments?.(); stopNotifications?.(); };
  }, [uid, isAdmin, isEmployee]);

  const sorted = useMemo(() => [...appointments].sort((a, b) => (appointmentMillis(a.inicio) ?? 0) - (appointmentMillis(b.inicio) ?? 0)), [appointments]);
  const pending = sorted.filter((item) => ["hold", "pendiente_de_aprobacion"].includes(item.estado));
  const unread = notifications.filter((item) => item.leida !== true);

  const decide = async (item: AppointmentRecord, action: "aprobarCita" | "rechazarCita") => {
    setBusyId(item.id);
    setMessage("");
    try {
      await decideAppointment(action, item.id);
      setMessage(action === "aprobarCita" ? "Cita confirmada; el cliente ya la ve en su agenda." : "Solicitud rechazada y cliente avisado.");
    } catch (reason) {
      const code = (reason as { code?: string })?.code ?? "";
      console.warn("No se pudo actualizar la cita.", reason);
      setMessage(code.includes("permission-denied") ? "No tienes autorización para actualizar esta cita." : code.includes("deadline-exceeded") ? "La solicitud venció antes de confirmarse." : "No pudimos actualizar la cita. Intenta de nuevo.");
    } finally { setBusyId(""); }
  };

  const changeServiceState = async (item: AppointmentRecord, action: "start" | "finish") => {
    setBusyId(item.id);
    setMessage("");
    try {
      if (action === "start") await startService(item.id);
      else {
        const result = await finishService(item.id);
        setMessage(`Servicio finalizado. Tiempo registrado: ${formatMinutes(result.duracionRealMin)}.`);
      }
      if (action === "start") setMessage("Inicio de servicio registrado.");
    } catch (reason) {
      const code = (reason as { code?: string })?.code ?? "";
      console.warn("No se pudo cambiar el estado del servicio.", reason);
      setMessage(code.includes("permission-denied") ? "Solo la persona asignada puede marcar el inicio o el final." : "No pudimos actualizar el servicio. Intenta de nuevo.");
    } finally { setBusyId(""); }
  };

  const markRead = async (id: string) => {
    try { await markNotificationRead(id); }
    catch (reason) { console.warn("No se pudo marcar el aviso como leído.", reason); setMessage("No pudimos actualizar el aviso. Intenta de nuevo."); }
  };

  return (
    <AuthGate allowedRoles={["admin", "administrador", "empleado"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.name ?? profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.headingRow}><View style={{ flex: 1 }}><Text style={[styles.eyebrow, isDark && { color: BRAND.onDarkText }]}>{isAdmin ? "CONTROL DE CITAS" : "AGENDA DE TU TURNO"}</Text><Text style={[styles.title, isDark && { color: BRAND.onDarkText }]}>{isAdmin ? "Solicitudes y citas" : "Mi agenda"}</Text><Text style={[styles.subtitle, isDark && { color: BRAND.onDarkMutedText }]}>La lista se actualiza en tiempo real cuando un cliente solicita o el equipo responde.</Text></View>{isEmployee && <Pressable accessibilityRole="button" onPress={() => router.push("./availability")} style={styles.iconButton}><Settings2 size={19} color={BRAND.primaryDark} /></Pressable>}</View>
          {isEmployee && <Pressable accessibilityRole="button" onPress={() => router.push("./availability")} style={styles.availabilityLink}><CalendarDays size={17} color={BRAND.primary} /><Text style={styles.availabilityText}>Editar mi disponibilidad semanal</Text></Pressable>}
          <View style={styles.counter}><CalendarDays size={18} color={BRAND.primary} /><Text style={styles.counterText}>{pending.length} solicitud{pending.length === 1 ? " pendiente" : "es pendientes"}</Text></View>
          {isEmployee && unread.length > 0 && <View style={styles.noticePanel}><View style={styles.noticeHeader}><BellRing size={16} color={BRAND.primary} /><Text style={styles.noticeTitle}>Avisos nuevos · {unread.length}</Text></View>{unread.slice(0, 3).map((notice) => <Pressable key={notice.id} onPress={() => void markRead(notice.id)} style={styles.noticeRow}><View style={{ flex: 1 }}><Text style={styles.noticeText}>{String(notice.titulo ?? "Aviso")}</Text><Text style={styles.noticeBody}>{String(notice.cuerpo ?? "")} · Toca para marcar leído</Text></View><Check size={16} color={BRAND.primaryDark} /></Pressable>)}</View>}
          {message ? <Text accessibilityRole="alert" style={[styles.message, isDark && { color: BRAND.onDarkText }]}>{message}</Text> : null}
          {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={[styles.stateText, isDark && { color: BRAND.onDarkMutedText }]}>Actualizando tu agenda…</Text></View> : error ? <View style={styles.state}><Text style={[styles.errorText, isDark && { color: BRAND.onDarkErrorText }]}>{error}</Text><Text style={[styles.stateText, isDark && { color: BRAND.onDarkMutedText }]}>Intenta de nuevo en unos momentos.</Text></View> : sorted.length === 0 ? <View style={styles.empty}><CalendarDays size={28} color={BRAND.primary} /><Text style={styles.emptyTitle}>No hay citas todavía</Text><Text style={styles.emptyText}>Cuando un cliente reserve, aparecerá aquí sin actualizar la pantalla.</Text></View> : sorted.map((item) => <AppointmentCard key={item.id} item={item} currentUid={uid ?? ""} busy={busyId === item.id} isAdmin={isAdmin} isEmployee={isEmployee} onDecide={decide} onChangeState={changeServiceState} />)}
          <Text style={[styles.footer, isDark && { color: BRAND.onDarkMutedText }]}>Los avisos de citas y servicios aparecerán aquí al instante.</Text>
        </ScrollView>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function EmployeeScheduleScreen() { return <ScheduleContent />; }

function AppointmentCard({ item, currentUid, busy, isAdmin, isEmployee, onDecide, onChangeState }: { item: AppointmentRecord; currentUid: string; busy: boolean; isAdmin: boolean; isEmployee: boolean; onDecide: (item: AppointmentRecord, action: "aprobarCita" | "rechazarCita") => void; onChangeState: (item: AppointmentRecord, action: "start" | "finish") => void }) {
  const millis = appointmentMillis(item.inicio);
  const when = millis ? new Date(millis).toLocaleString("es-HN", { timeZone: "America/Tegucigalpa", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }) : "Fecha por confirmar";
  const clientName = String(item.clienteNombre || item.clienteEmail || "Cliente");
  const assignedEmployee = isEmployee && item.empleadoUid === currentUid;
  const canDecide = ["hold", "pendiente_de_aprobacion"].includes(item.estado) && (isAdmin || assignedEmployee);
  const canStart = assignedEmployee && item.estado === "confirmada";
  const canFinish = assignedEmployee && item.estado === "en_curso";
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}><Text numberOfLines={1} style={styles.client}>{clientName}</Text><Text style={styles.badge}>{appointmentStatusLabel(item.estado)}</Text></View>
      <Text style={styles.service}>{String(item.servicioNombre ?? "Servicio")}{item.empleadoNombre ? ` · ${String(item.empleadoNombre)}` : ""}</Text>
      {item.clienteTelefono ? <Text style={styles.contact}>Tel. {String(item.clienteTelefono)}</Text> : null}
      <Text style={styles.date}>{when}</Text>
      <Text style={styles.meta}>Estimado: {formatMinutes(Number(item.duracionMin) || 0)}{Number.isFinite(Number(item.precio)) ? ` · L. ${Number(item.precio).toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}</Text>
      {Number(item.duracionRealMin) > 0 && <Text style={styles.realDuration}>Tiempo real: {formatMinutes(Number(item.duracionRealMin))}</Text>}
      {canDecide && <View style={styles.actions}><Pressable disabled={busy} onPress={() => onDecide(item, "aprobarCita")} style={[styles.approve, busy && styles.disabled]}><Check size={16} color="#FFFFFF" /><Text style={styles.actionText}>{busy ? "Guardando…" : "Confirmar"}</Text></Pressable><Pressable disabled={busy} onPress={() => onDecide(item, "rechazarCita")} style={[styles.reject, busy && styles.disabled]}><X size={16} color={BRAND.error} /><Text style={styles.rejectText}>Rechazar</Text></Pressable></View>}
      {canStart && <Pressable disabled={busy} onPress={() => onChangeState(item, "start")} style={[styles.startButton, busy && styles.disabled]}><Play size={16} color="#FFFFFF" /><Text style={styles.actionText}>{busy ? "Guardando…" : "Inicio de servicio"}</Text></Pressable>}
      {canFinish && <Pressable disabled={busy} onPress={() => onChangeState(item, "finish")} style={[styles.finishButton, busy && styles.disabled]}><Check size={16} color="#FFFFFF" /><Text style={styles.actionText}>{busy ? "Guardando…" : "Servicio finalizado"}</Text></Pressable>}
    </View>
  );
}

function formatMinutes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const totalMinutes = Math.round(value);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min`;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 35 }, headingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, marginTop: 10 }, eyebrow: { color: BRAND.primary, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" }, title: { color: BRAND.wine, fontSize: 27, fontWeight: "800", marginTop: 5 }, subtitle: { color: BRAND.muted, fontSize: 13, lineHeight: 19, marginTop: 5 }, iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, availabilityLink: { flexDirection: "row", gap: 8, alignItems: "center", marginHorizontal: 20, marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border }, availabilityText: { color: BRAND.primaryDark, fontSize: 12, fontWeight: "800" },
  counter: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 15, padding: 12, backgroundColor: BRAND.softPink, borderRadius: 14 }, counterText: { color: BRAND.wine, fontSize: 13, fontWeight: "800" }, noticePanel: { marginHorizontal: 20, marginTop: 10, padding: 12, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, borderRadius: 16 }, noticeHeader: { flexDirection: "row", alignItems: "center", gap: 7 }, noticeTitle: { color: BRAND.wine, fontSize: 12, fontWeight: "800" }, noticeRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: BRAND.border }, noticeText: { color: BRAND.wine, fontSize: 11, fontWeight: "700" }, noticeBody: { color: BRAND.muted, fontSize: 10, lineHeight: 14, marginTop: 2 }, message: { marginHorizontal: 20, marginTop: 10, color: BRAND.primaryDark, fontSize: 12, lineHeight: 17 },
  state: { alignItems: "center", gap: 8, padding: 26, marginHorizontal: 20 }, stateText: { color: BRAND.muted, fontSize: 12, textAlign: "center" }, errorText: { color: BRAND.error, fontSize: 13, textAlign: "center" }, empty: { alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 24, padding: 28, marginHorizontal: 20, marginTop: 22, borderWidth: 1, borderColor: BRAND.border }, emptyTitle: { color: BRAND.wine, fontSize: 16, fontWeight: "800", marginTop: 10 }, emptyText: { color: BRAND.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 5 },
  card: { backgroundColor: BRAND.surface, borderRadius: 21, marginHorizontal: 20, marginTop: 11, padding: 15, borderWidth: 1, borderColor: BRAND.border }, cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, client: { color: BRAND.wine, fontSize: 15, fontWeight: "800", flex: 1 }, badge: { color: BRAND.primaryDark, backgroundColor: BRAND.softPink, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 10, fontWeight: "800", overflow: "hidden", textTransform: "capitalize" }, service: { color: BRAND.wine, fontSize: 13, marginTop: 7 }, contact: { color: BRAND.muted, fontSize: 12, marginTop: 4 }, date: { color: BRAND.muted, fontSize: 12, marginTop: 4, textTransform: "capitalize" }, meta: { color: BRAND.wine, fontSize: 11, fontWeight: "700", marginTop: 8 }, realDuration: { color: BRAND.success, fontSize: 11, fontWeight: "800", marginTop: 4 }, actions: { flexDirection: "row", gap: 9, marginTop: 13 }, approve: { flex: 1, minHeight: 43, borderRadius: 999, backgroundColor: BRAND.success, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, reject: { flex: 1, minHeight: 43, borderRadius: 999, backgroundColor: "#FFF1F2", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, startButton: { minHeight: 44, borderRadius: 999, backgroundColor: BRAND.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 }, finishButton: { minHeight: 44, borderRadius: 999, backgroundColor: BRAND.success, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 }, actionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, rejectText: { color: BRAND.error, fontSize: 12, fontWeight: "800" }, disabled: { opacity: 0.55 }, footer: { color: BRAND.muted, fontSize: 10, lineHeight: 15, textAlign: "center", margin: 20, marginTop: 18 },
});
