import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CalendarDays, Check, Clock3, Search, ShoppingBag, X } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { appointmentMillis, loadBusinesses, loadPublicEmployees, loadServices, reserveAppointment, subscribeClientAppointments, type AppointmentRecord, type BusinessRecord, type EmployeeRecord, type ServiceRecord } from "@/lib/appointments";
import { formatCurrency } from "@/lib/formatCurrency";

function ClientCatalogContent() {
  const { user, profile } = useAuthSession();
  const uid = user?.uid;
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [loadingBusinesses, setLoadingBusinesses] = useState(true);
  const [loadedBusinessId, setLoadedBusinessId] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedService, setSelectedService] = useState<ServiceRecord | null>(null);
  const [date, setDate] = useState(defaultDate());
  const [time, setTime] = useState("10:00");
  const [employeeId, setEmployeeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const loadingServices = Boolean(businessId) && loadedBusinessId !== businessId;

  useEffect(() => {
    let active = true;
    void loadBusinesses().then((items) => {
      if (!active) return;
      setBusinesses(items);
      setBusinessId(items[0]?.id ?? "");
    }).catch((reason) => {
      if (active) setError(friendlyError(reason));
    }).finally(() => { if (active) setLoadingBusinesses(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let active = true;
    Promise.all([loadServices(businessId), loadPublicEmployees(businessId)]).then(([serviceItems, employeeItems]) => {
      if (!active) return;
      setServices(serviceItems);
      setEmployees(employeeItems);
      setEmployeeId("");
      setError("");
      setLoadedBusinessId(businessId);
    }).catch((reason) => {
      if (!active) return;
      setError(friendlyError(reason));
      setLoadedBusinessId(businessId);
    });
    return () => { active = false; };
  }, [businessId]);

  useEffect(() => {
    if (!uid) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (!active) return;
      try {
        unsubscribe = subscribeClientAppointments(uid, (items) => { if (active) setAppointments(items); }, (reason) => { if (active) setError(friendlyError(reason)); });
      } catch (reason) {
        if (active) setError(friendlyError(reason));
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); unsubscribe?.(); };
  }, [uid]);

  const currentBusiness = businesses.find((business) => business.id === businessId);
  const filteredServices = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return services.filter((service) => !normalizedSearch || `${service.nombre} ${service.descripcion}`.toLowerCase().includes(normalizedSearch));
  }, [services, search]);
  const bookingConfigured = Boolean(currentBusiness?.modoNegocio);
  const needsEmployee = currentBusiness?.modoNegocio === "multiEmpleado";

  const book = async () => {
    if (!user || !selectedService || !currentBusiness) return;
    if (!currentBusiness.modoNegocio) { setNotice("El administrador debe configurar modoNegocio antes de habilitar reservas."); return; }
    const start = parseLocalDateTime(date.trim(), time.trim());
    if (!start) { setNotice("Revisa la fecha (AAAA-MM-DD) y la hora (HH:MM). "); return; }
    if (start.getTime() <= Date.now()) { setNotice("Selecciona una hora futura."); return; }
    if (needsEmployee && !employeeId) { setNotice("Selecciona a la profesional para continuar."); return; }
    setSubmitting(true);
    setNotice("");
    try {
      const result = await reserveAppointment({ negocioId: currentBusiness.id, servicioId: selectedService.id, inicio: start.toISOString(), ...(needsEmployee ? { empleadoId: employeeId } : {}) });
      setNotice(result.estado === "hold"
        ? "Solicitud enviada. La franja queda reservada 30 minutos mientras el equipo responde."
        : "Cita confirmada. Ya aparece en Tus citas.");
      setSelectedService(null);
    } catch (reason) {
      const code = (reason as { code?: string })?.code ?? "";
      setNotice(code.includes("already-exists") ? "Ese horario acaba de ocuparse. Elige otra hora." : code.includes("permission-denied") ? "No se autorizó la reserva. Revisa tu perfil y las reglas/Functions de Firebase." : code.includes("failed-precondition") ? friendlyError(reason) : "No se pudo enviar la solicitud. Verifica conexión y Functions desplegadas.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthGate allowedRoles={["cliente"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.heading}><Text style={styles.eyebrow}>SERVICIOS DE EUFORIA</Text><Text style={styles.title}>Elige cómo quieres sentirte</Text><Text style={styles.subtitle}>Consulta servicios reales y solicita tu próximo espacio.</Text></View>
          {businesses.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.businessList}>{businesses.map((item) => <Pressable key={item.id} onPress={() => { setServices([]); setEmployees([]); setEmployeeId(""); setLoadedBusinessId(""); setBusinessId(item.id); }} style={[styles.businessChip, businessId === item.id && styles.businessChipActive]}><Text style={[styles.businessChipText, businessId === item.id && styles.businessChipTextActive]}>{item.nombre}</Text></Pressable>)}</ScrollView>}
          <View style={styles.search}><Search size={18} color={BRAND.muted} /><TextInput value={search} onChangeText={setSearch} placeholder="Buscar servicio" placeholderTextColor={BRAND.muted} style={styles.input} /></View>
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          {currentBusiness && !currentBusiness.modoNegocio ? <Text accessibilityRole="alert" style={styles.error}>Este negocio aún no está listo para reservas. Contacta al administrador.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {loadingBusinesses || loadingServices ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={styles.stateText}>Cargando el catálogo real…</Text></View> : businesses.length === 0 ? <Empty icon={<ShoppingBag size={27} color={BRAND.primary} />} title="Aún no hay negocios configurados" text="El administrador debe publicar el negocio en Firestore para habilitar las reservas." /> : filteredServices.length === 0 ? <Empty icon={<ShoppingBag size={27} color={BRAND.primary} />} title={services.length === 0 ? "No hay servicios publicados" : "No encontramos ese servicio"} text={services.length === 0 ? "Los servicios, duración y precios reales aparecerán aquí cuando el administrador los configure en Firebase." : "Prueba otra búsqueda."} /> : filteredServices.map((service) => <ServiceCard key={service.id} service={service} bookingConfigured={bookingConfigured} onBook={() => { setDate(defaultDate()); setTime("10:00"); setSelectedService(service); setNotice(""); }} />)}

          <View style={styles.section}><Text style={styles.sectionTitle}>Tus citas</Text><Text style={styles.sectionHint}>Se actualizan en tiempo real.</Text></View>
          {appointments.length === 0 ? <Empty icon={<CalendarDays size={22} color={BRAND.primary} />} title="Todavía no tienes citas" text="Cuando reserves un servicio, lo verás aquí." /> : appointments.map((item) => <ClientAppointment key={item.id} item={item} />)}
        </ScrollView>
        <Modal visible={Boolean(selectedService)} transparent animationType="slide" onRequestClose={() => setSelectedService(null)}>
          <View style={styles.modalShade}><View style={styles.sheet}>
            <View style={styles.sheetHeader}><View><Text style={styles.sheetEyebrow}>SOLICITAR CITA</Text><Text style={styles.sheetTitle}>{selectedService?.nombre}</Text></View><Pressable onPress={() => setSelectedService(null)} style={styles.close}><X size={19} color={BRAND.wine} /></Pressable></View>
            <Text style={styles.sheetDetails}>{currentBusiness?.nombre}{selectedService?.precio !== null && selectedService?.precio !== undefined ? ` · ${formatCurrency(selectedService.precio)}` : ""}{selectedService?.duracionMin ? ` · ${selectedService.duracionMin} min` : ""}</Text>
            <Text style={styles.fieldLabel}>Fecha (AAAA-MM-DD)</Text><TextInput value={date} onChangeText={setDate} placeholder="2026-12-31" keyboardType="numbers-and-punctuation" style={styles.field} />
            <Text style={styles.fieldLabel}>Hora (24 h)</Text><TextInput value={time} onChangeText={setTime} placeholder="10:00" keyboardType="numbers-and-punctuation" style={styles.field} />
            {needsEmployee && <><Text style={styles.fieldLabel}>Profesional</Text>{employees.length === 0 ? <Text style={styles.emptyHint}>No hay profesionales públicas disponibles. Contacta al salón.</Text> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.employeeList}>{employees.map((employee) => <Pressable key={employee.id} onPress={() => setEmployeeId(employee.id)} style={[styles.employeeChip, employeeId === employee.id && styles.employeeChipActive]}><Text style={[styles.employeeText, employeeId === employee.id && styles.employeeTextActive]}>{employee.nombre}</Text></Pressable>)}</ScrollView>}</>}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            <Pressable disabled={submitting || (needsEmployee && employees.length === 0)} onPress={() => void book()} style={[styles.bookButton, (submitting || (needsEmployee && employees.length === 0)) && styles.disabled]}><Text style={styles.bookText}>{submitting ? "Enviando…" : "Confirmar solicitud"}</Text><Check size={18} color="#FFFFFF" /></Pressable>
            <Text style={styles.disclaimer}>El horario se valida en el servidor para evitar cruces de citas.</Text>
          </View></View>
        </Modal>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function ClientCatalogScreen() { return <ClientCatalogContent />; }

function ServiceCard({ service, bookingConfigured, onBook }: { service: ServiceRecord; bookingConfigured: boolean; onBook: () => void }) {
  const configured = bookingConfigured && service.precio !== null && service.duracionMin !== null;
  return <View style={styles.serviceCard}><View style={styles.serviceIcon}><ShoppingBag size={20} color={BRAND.primary} /></View><View style={styles.serviceBody}><Text style={styles.serviceName}>{service.nombre}</Text>{service.descripcion ? <Text style={styles.description}>{service.descripcion}</Text> : null}<View style={styles.serviceMeta}><Text style={styles.price}>{service.precio === null ? "Precio por confirmar" : formatCurrency(service.precio)}</Text>{service.duracionMin ? <Text style={styles.duration}><Clock3 size={12} color={BRAND.muted} /> {service.duracionMin} min</Text> : null}</View></View><Pressable disabled={!configured} onPress={onBook} style={[styles.selectButton, !configured && styles.disabled]}><Text style={styles.selectText}>{configured ? "Agendar" : "No disponible"}</Text></Pressable></View>;
}
function ClientAppointment({ item }: { item: AppointmentRecord }) {
  const millis = appointmentMillis(item.inicio);
  const when = millis ? new Date(millis).toLocaleString("es-HN", { timeZone: "America/Tegucigalpa", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Fecha por confirmar";
  return <View style={styles.clientAppointment}><View style={styles.appointmentTop}><Text style={styles.clientService}>{String(item.servicioNombre ?? "Servicio")}</Text><Text style={styles.status}>{item.estado.replaceAll("_", " ")}</Text></View><Text style={styles.appointmentInfo}>{String(item.negocioNombre ?? "EUFORIA")} · {when}</Text></View>;
}
function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <View style={styles.empty}>{icon}<Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text></View>;
}
function hondurasTimeParts(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Tegucigalpa", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}
function defaultDate() { const local = hondurasTimeParts(new Date()); const tomorrow = new Date(Date.UTC(local.year, local.month - 1, local.day + 1)); return `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`; }
function parseLocalDateTime(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const year = Number(d[1]); const month = Number(d[2]); const day = Number(d[3]); const hour = Number(t[1]); const minute = Number(t[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const result = new Date(Date.UTC(year, month - 1, day, hour + 6, minute, 0, 0));
  const local = hondurasTimeParts(result);
  if (local.year !== year || local.month !== month || local.day !== day || local.hour !== hour || local.minute !== minute) return null;
  return result;
}
function friendlyError(reason: unknown) {
  const code = (reason as { code?: string })?.code ?? "";
  if (code.includes("permission-denied")) return "Firebase rechazó la lectura. Comprueba las reglas publicadas y el rol del perfil.";
  return reason instanceof Error ? reason.message : "No se pudo cargar la información de Firebase.";
}

const styles = StyleSheet.create({
  content: { paddingBottom: 34 }, heading: { paddingHorizontal: 20, marginTop: 8 }, eyebrow: { color: BRAND.primary, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" }, title: { color: BRAND.wine, fontSize: 27, lineHeight: 34, fontWeight: "800", marginTop: 6 }, subtitle: { color: BRAND.muted, fontSize: 13, marginTop: 6 },
  businessList: { gap: 8, paddingHorizontal: 20, paddingTop: 16 }, businessChip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border }, businessChipActive: { backgroundColor: BRAND.primary, borderColor: BRAND.primary }, businessChipText: { color: BRAND.wine, fontSize: 12, fontWeight: "700" }, businessChipTextActive: { color: "#FFFFFF" },
  search: { flexDirection: "row", alignItems: "center", gap: 9, height: 50, backgroundColor: BRAND.surface, borderRadius: 18, margin: 20, paddingHorizontal: 15, borderColor: BRAND.border, borderWidth: 1 }, input: { flex: 1, color: BRAND.wine, fontSize: 14 }, notice: { color: BRAND.primaryDark, backgroundColor: BRAND.softPink, borderRadius: 13, padding: 11, marginHorizontal: 20, marginBottom: 10, fontSize: 12, lineHeight: 17 }, error: { color: BRAND.error, marginHorizontal: 20, marginBottom: 10, fontSize: 12, lineHeight: 17 }, state: { alignItems: "center", gap: 8, padding: 25 }, stateText: { color: BRAND.muted, fontSize: 12 },
  empty: { alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 24, marginHorizontal: 20, padding: 25, borderWidth: 1, borderColor: BRAND.border }, emptyTitle: { color: BRAND.wine, fontSize: 15, fontWeight: "800", marginTop: 10, textAlign: "center" }, emptyText: { color: BRAND.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 5 },
  serviceCard: { backgroundColor: BRAND.surface, borderRadius: 22, marginHorizontal: 20, marginBottom: 10, padding: 14, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: BRAND.border }, serviceIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, serviceBody: { flex: 1 }, serviceName: { color: BRAND.wine, fontSize: 14, fontWeight: "800" }, description: { color: BRAND.muted, fontSize: 11, lineHeight: 15, marginTop: 3 }, serviceMeta: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 }, price: { color: BRAND.primaryDark, fontSize: 12, fontWeight: "800" }, duration: { color: BRAND.muted, fontSize: 11, flexDirection: "row", alignItems: "center" }, selectButton: { backgroundColor: BRAND.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 }, selectText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" }, disabled: { opacity: 0.5 },
  section: { paddingHorizontal: 20, marginTop: 23, marginBottom: 10 }, sectionTitle: { color: BRAND.wine, fontSize: 17, fontWeight: "800" }, sectionHint: { color: BRAND.muted, fontSize: 11, marginTop: 3 }, clientAppointment: { backgroundColor: BRAND.surface, borderRadius: 18, padding: 13, marginHorizontal: 20, marginBottom: 8, borderWidth: 1, borderColor: BRAND.border }, appointmentTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 7 }, clientService: { color: BRAND.wine, fontSize: 13, fontWeight: "800", flex: 1 }, status: { color: BRAND.primaryDark, backgroundColor: BRAND.softPink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: "800", overflow: "hidden", textTransform: "capitalize" }, appointmentInfo: { color: BRAND.muted, fontSize: 11, marginTop: 6, textTransform: "capitalize" },
  modalShade: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(35,10,20,0.35)" }, sheet: { backgroundColor: BRAND.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 30, maxHeight: "92%" }, sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, sheetEyebrow: { color: BRAND.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 }, sheetTitle: { color: BRAND.wine, fontSize: 22, fontWeight: "800", marginTop: 4 }, close: { width: 38, height: 38, borderRadius: 19, backgroundColor: BRAND.surface, alignItems: "center", justifyContent: "center" }, sheetDetails: { color: BRAND.muted, fontSize: 12, marginTop: 6, marginBottom: 16 }, fieldLabel: { color: BRAND.wine, fontSize: 12, fontWeight: "800", marginTop: 10, marginBottom: 6 }, field: { minHeight: 48, backgroundColor: BRAND.surface, borderRadius: 14, borderWidth: 1, borderColor: BRAND.border, paddingHorizontal: 13, color: BRAND.wine, fontSize: 16 }, employeeList: { gap: 8 }, employeeChip: { borderRadius: 999, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, paddingHorizontal: 13, paddingVertical: 9 }, employeeChipActive: { backgroundColor: BRAND.primary, borderColor: BRAND.primary }, employeeText: { color: BRAND.wine, fontSize: 12, fontWeight: "700" }, employeeTextActive: { color: "#FFFFFF" }, emptyHint: { color: BRAND.error, fontSize: 12, marginTop: 3 }, bookButton: { minHeight: 52, backgroundColor: BRAND.primary, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18 }, bookText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" }, disclaimer: { color: BRAND.muted, textAlign: "center", fontSize: 10, marginTop: 10 },
});
