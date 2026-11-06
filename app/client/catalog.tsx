import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CalendarDays, Check, Clock3, RefreshCw, Search, ShoppingBag, UserRound, X } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { appointmentMillis, appointmentStatusLabel, getAvailableEmployeeSlots, loadBusinesses, loadServices, reserveAppointment, subscribeClientAppointments, type AppointmentAvailability, type AppointmentRecord, type BusinessRecord, type EmployeeAvailability, type ServiceRecord } from "@/lib/appointments";
import { formatCurrency } from "@/lib/formatCurrency";
import { useThemeContext } from "@/lib/theme-provider";

function ClientCatalogContent() {
  const { user, profile } = useAuthSession();
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";
  const uid = user?.uid;
  const initialDate = defaultDate();
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [appointmentsError, setAppointmentsError] = useState(false);
  const [appointmentsRetry, setAppointmentsRetry] = useState(0);
  const [loadingBusinesses, setLoadingBusinesses] = useState(true);
  const [loadedBusinessId, setLoadedBusinessId] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedService, setSelectedService] = useState<ServiceRecord | null>(null);
  const [date, setDate] = useState(initialDate);
  const [dateInput, setDateInput] = useState(() => formatDateInput(initialDate));
  const [availability, setAvailability] = useState<AppointmentAvailability | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const [slotStart, setSlotStart] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const loadingServices = Boolean(businessId) && loadedBusinessId !== businessId;
  const currentBusiness = businesses.find((business) => business.id === businessId);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void loadBusinesses().then((items) => {
        if (!active) return;
        setBusinesses(items);
        setBusinessId(items[0]?.id ?? "");
      }).catch((reason) => { if (active) setError(friendlyError(reason)); }).finally(() => { if (active) setLoadingBusinesses(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let active = true;
    const timer = setTimeout(() => {
      void loadServices(businessId).then((items) => {
        if (!active) return;
        setServices(items);
        setError("");
        setLoadedBusinessId(businessId);
      }).catch((reason) => {
        if (!active) return;
        setError(friendlyError(reason));
        setLoadedBusinessId(businessId);
      });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [businessId]);

  useEffect(() => {
    if (!uid) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (!active) return;
      try { unsubscribe = subscribeClientAppointments(uid, (items) => { if (active) { setAppointments(items); setAppointmentsError(false); } }, (reason) => { console.warn("No se pudieron cargar las citas del cliente.", reason); if (active) { setAppointments([]); setAppointmentsError(true); } }); }
      catch (reason) { console.warn("No se pudo iniciar la consulta de citas.", reason); if (active) setAppointmentsError(true); }
    }, 0);
    return () => { active = false; clearTimeout(timer); unsubscribe?.(); };
  }, [uid, appointmentsRetry]);

  const selectedServiceId = selectedService?.id ?? "";
  const currentBusinessId = currentBusiness?.id ?? "";

  useEffect(() => {
    if (!selectedServiceId || !currentBusinessId) return;
    let active = true;
    const dateIsValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const timer = setTimeout(() => {
      setAvailability(null);
      setAvailabilityError("");
      setLoadingAvailability(true);
      if (!dateIsValid) {
        setAvailabilityError("Escribe una fecha completa.");
        setLoadingAvailability(false);
        return;
      }
      void getAvailableEmployeeSlots({ negocioId: currentBusinessId, servicioId: selectedServiceId, fecha: date }).then((result) => {
        if (!active) return;
        setAvailability(result);
        setEmployeeId((current) => result.empleados.some((item) => item.id === current) ? current : "");
        setSlotStart("");
      }).catch((reason) => { if (active) setAvailabilityError(availabilityMessage(reason)); }).finally(() => { if (active) setLoadingAvailability(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [selectedServiceId, currentBusinessId, date, refreshKey]);

  const filteredServices = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return services.filter((service) => !normalizedSearch || `${service.nombre} ${service.descripcion}`.toLowerCase().includes(normalizedSearch));
  }, [services, search]);
  const selectedEmployee = availability?.empleados.find((item) => item.id === employeeId) ?? null;

  const book = async () => {
    if (!user || !selectedService || !currentBusiness || !selectedEmployee || !slotStart) {
      setNotice("Elige un empleado y una hora libre para continuar.");
      return;
    }
    setSubmitting(true);
    setNotice("");
    try {
      const result = await reserveAppointment({ negocioId: currentBusiness.id, servicioId: selectedService.id, inicio: slotStart, empleadoId: selectedEmployee.id });
      setNotice(result.estado === "hold" || result.estado === "pendiente_de_aprobacion"
        ? "Solicitud enviada. El empleado recibió un aviso dentro de la app; al confirmarla aparecerá inmediatamente en Tus citas."
        : "Cita confirmada. Ya aparece en Tus citas.");
      setSelectedService(null);
      setAvailability(null);
      setEmployeeId("");
      setSlotStart("");
    } catch (reason) {
      const code = (reason as { code?: string })?.code ?? "";
      console.warn("No se pudo completar la solicitud de cita.", reason);
      setNotice(code.includes("already-exists") || code.includes("failed-precondition")
        ? "Ese horario acaba de ocuparse. Actualizamos las horas; elige otra disponible."
        : "No pudimos enviar tu solicitud. Intenta de nuevo.");
      setRefreshKey((value) => value + 1);
    } finally { setSubmitting(false); }
  };

  const openBooking = (service: ServiceRecord) => {
    const nextDate = defaultDate();
    setDate(nextDate);
    setDateInput(formatDateInput(nextDate));
    setAvailability(null);
    setEmployeeId("");
    setSlotStart("");
    setSelectedService(service);
    setNotice("");
  };

  return (
    <AuthGate allowedRoles={["cliente"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.name ?? profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.heading}><Text style={[styles.eyebrow, isDark && { color: BRAND.onDarkText }]}>SERVICIOS DE EUFORIA</Text><Text style={[styles.title, isDark && { color: BRAND.onDarkText }]}>Elige tu próximo servicio</Text><Text style={[styles.subtitle, isDark && { color: BRAND.onDarkMutedText }]}>Selecciona un servicio, un profesional y una hora libre.</Text></View>
          {businesses.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.businessList}>{businesses.map((item) => <Pressable key={item.id} onPress={() => { setServices([]); setLoadedBusinessId(""); setBusinessId(item.id); }} style={[styles.businessChip, businessId === item.id && styles.businessChipActive]}><Text style={[styles.businessChipText, businessId === item.id && styles.businessChipTextActive]}>{item.nombre}</Text></Pressable>)}</ScrollView>}
          <View style={styles.search}><Search size={18} color={BRAND.muted} /><TextInput value={search} onChangeText={setSearch} placeholder="Buscar servicio" placeholderTextColor={BRAND.muted} style={styles.input} /></View>
          {appointmentsError ? <View style={styles.appointmentRetry}><Text accessibilityRole="alert" style={styles.retryMessage}>No pudimos cargar tus citas, intenta de nuevo</Text><Pressable accessibilityRole="button" onPress={() => { setAppointmentsError(false); setAppointmentsRetry((value) => value + 1); }}><Text style={styles.retryAction}>Intentar de nuevo</Text></Pressable></View> : null}
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, isDark && { color: BRAND.onDarkErrorText }]}>{error}</Text> : null}
          {loadingBusinesses || loadingServices ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={[styles.stateText, isDark && { color: BRAND.onDarkMutedText }]}>Cargando nuestros servicios…</Text></View> : businesses.length === 0 ? <Empty icon={<ShoppingBag size={27} color={BRAND.primary} />} title="Estamos preparando nuestros servicios" text="Vuelve pronto para conocer todo lo que tenemos para ti." /> : filteredServices.length === 0 ? <Empty icon={<ShoppingBag size={27} color={BRAND.primary} />} title={services.length === 0 ? "Estamos preparando nuestros servicios" : "No encontramos ese servicio"} text={services.length === 0 ? "Vuelve pronto para conocer nuestros servicios." : "Prueba otra búsqueda."} /> : filteredServices.map((service) => <ServiceCard key={service.id} service={service} onBook={() => openBooking(service)} />)}

          <View style={styles.section}><Text style={[styles.sectionTitle, isDark && { color: BRAND.onDarkText }]}>Tus citas</Text><Text style={[styles.sectionHint, isDark && { color: BRAND.onDarkMutedText }]}>Se actualizan en tiempo real.</Text></View>
          {!appointmentsError && (appointments.length === 0 ? <Empty icon={<CalendarDays size={22} color={BRAND.primary} />} title="Todavía no tienes citas" text="Cuando solicites un servicio, lo verás aquí." /> : appointments.map((item) => <ClientAppointment key={item.id} item={item} />))}
        </ScrollView>
        <Modal visible={Boolean(selectedService)} transparent animationType="slide" onRequestClose={() => setSelectedService(null)}>
          <View style={styles.modalShade}><View style={styles.sheet}>
            <View style={styles.sheetHeader}><View style={{ flex: 1 }}><Text style={styles.sheetEyebrow}>SOLICITAR CITA</Text><Text style={styles.sheetTitle}>{selectedService?.nombre}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={() => setSelectedService(null)} style={styles.close}><X size={19} color={BRAND.wine} /></Pressable></View>
            <Text style={styles.sheetDetails}>{currentBusiness?.nombre}{selectedService?.precio !== null && selectedService?.precio !== undefined ? ` · ${formatCurrency(selectedService.precio)}` : ""}{selectedService?.duracionMin ? ` · ${formatDuration(selectedService.duracionMin)}` : ""}</Text>
            <Text style={styles.fieldLabel}>Fecha de la cita</Text><View style={styles.dateRow}><TextInput value={dateInput} onChangeText={(value) => { setDateInput(value); setDate(parseDateInput(value) ?? value); setSlotStart(""); }} placeholder="Día/mes/año" accessibilityLabel="Fecha de la cita, día, mes y año" keyboardType="numbers-and-punctuation" style={styles.dateInput} /><Pressable accessibilityRole="button" onPress={() => setRefreshKey((value) => value + 1)} style={styles.refresh}><RefreshCw size={16} color={BRAND.primaryDark} /></Pressable></View>
            <Text style={styles.fieldLabel}>Profesional con espacios libres</Text>
            {loadingAvailability ? <View style={styles.inlineState}><ActivityIndicator color={BRAND.primary} /><Text style={styles.inlineHint}>Buscando horas disponibles…</Text></View> : availabilityError ? <Text accessibilityRole="alert" style={styles.error}>{availabilityError}</Text> : !availability || availability.empleados.length === 0 ? <Text style={styles.emptyHint}>No hay profesionales disponibles para ese servicio y fecha. Cambia la fecha o inténtalo más tarde.</Text> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.employeeList}>{availability.empleados.map((employee) => <EmployeeChip key={employee.id} employee={employee} selected={employee.id === employeeId} onPress={() => { setEmployeeId(employee.id); setSlotStart(""); }} />)}</ScrollView>}
            {selectedEmployee && <><Text style={styles.fieldLabel}>Horarios disponibles · bloques de 15 min</Text>{selectedEmployee.slots.length === 0 ? <Text style={styles.emptyHint}>Este profesional ya no tiene horas libres para la duración de este servicio.</Text> : <ScrollView style={styles.slotScroll} contentContainerStyle={styles.slotList}>{selectedEmployee.slots.map((slot) => <Pressable key={slot.inicio} accessibilityRole="radio" accessibilityState={{ checked: slot.inicio === slotStart }} onPress={() => setSlotStart(slot.inicio)} style={[styles.slot, slot.inicio === slotStart && styles.slotActive]}><Text style={[styles.slotText, slot.inicio === slotStart && styles.slotTextActive]}>{slot.hora}</Text></Pressable>)}</ScrollView>}</>}
            {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
            <Pressable disabled={submitting || !employeeId || !slotStart || loadingAvailability} onPress={() => void book()} style={[styles.bookButton, (submitting || !employeeId || !slotStart || loadingAvailability) && styles.disabled]}><Text style={styles.bookText}>{submitting ? "Enviando…" : "Enviar solicitud"}</Text><Check size={18} color="#FFFFFF" /></Pressable>
            <Text style={styles.disclaimer}>Comprobaremos que la hora siga libre antes de enviar tu solicitud.</Text>
          </View></View>
        </Modal>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function ClientCatalogScreen() { return <ClientCatalogContent />; }

function ServiceCard({ service, onBook }: { service: ServiceRecord; onBook: () => void }) {
  const configured = service.precio !== null && service.duracionMin !== null && service.duracionMin > 0;
  return <View style={styles.serviceCard}><View style={styles.serviceIcon}><ShoppingBag size={20} color={BRAND.primary} /></View><View style={styles.serviceBody}><Text style={styles.serviceName}>{service.nombre}</Text>{service.descripcion ? <Text style={styles.description}>{service.descripcion}</Text> : null}<View style={styles.serviceMeta}><Text style={styles.price}>{service.precio === null ? "Precio por confirmar" : formatCurrency(service.precio)}</Text>{service.duracionMin ? <Text style={styles.duration}><Clock3 size={12} color={BRAND.muted} /> {formatDuration(service.duracionMin)}</Text> : null}</View></View><Pressable disabled={!configured} onPress={onBook} style={[styles.selectButton, !configured && styles.disabled]}><Text style={styles.selectText}>{configured ? "Agendar" : "No disponible"}</Text></Pressable></View>;
}
function EmployeeChip({ employee, selected, onPress }: { employee: EmployeeAvailability; selected: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.employeeChip, selected && styles.employeeChipActive]}>{employee.profileImage ? <Image source={{ uri: employee.profileImage }} style={styles.employeeImage} /> : <View style={styles.employeeIcon}><UserRound size={15} color={selected ? "#FFFFFF" : BRAND.primaryDark} /></View>}<Text style={[styles.employeeText, selected && styles.employeeTextActive]}>{employee.nombre}</Text><Text style={[styles.slotCount, selected && styles.employeeTextActive]}>{employee.slots.length} horas</Text></Pressable>; }
function ClientAppointment({ item }: { item: AppointmentRecord }) {
  const millis = appointmentMillis(item.inicio);
  const when = millis ? new Date(millis).toLocaleString("es-HN", { timeZone: "America/Tegucigalpa", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Fecha por confirmar";
  return <View style={styles.clientAppointment}><View style={styles.appointmentTop}><Text style={styles.clientService}>{String(item.servicioNombre ?? "Servicio")}</Text><Text style={styles.status}>{appointmentStatusLabel(item.estado)}</Text></View><Text style={styles.appointmentInfo}>{String(item.negocioNombre ?? "EUFORIA")} · {String(item.empleadoNombre ?? "Profesional por asignar")}</Text><Text style={styles.appointmentInfo}>{when} · {formatDuration(Number(item.duracionMin) || 0)}</Text></View>;
}
function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <View style={styles.empty}>{icon}<Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text></View>; }
function hondurasTimeParts(date: Date) { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Tegucigalpa", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value])); return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) }; }
function defaultDate() { const local = hondurasTimeParts(new Date()); const tomorrow = new Date(Date.UTC(local.year, local.month - 1, local.day + 1)); return `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`; }
function formatDateInput(iso: string) { const [year, month, day] = iso.split("-"); return `${day}/${month}/${year}`; }
function parseDateInput(value: string) { const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim()); if (!match) return null; const day = Number(match[1]); const month = Number(match[2]); const year = Number(match[3]); const parsed = new Date(year, month - 1, day); if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null; return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function formatDuration(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; return hours ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min`; }
function friendlyError(reason: unknown) { console.warn("No se pudo cargar el catálogo de servicios.", reason); return "No pudimos cargar nuestros servicios. Intenta de nuevo."; }
function availabilityMessage(reason: unknown) { console.warn("No se pudo consultar la disponibilidad.", reason); return "No pudimos consultar las horas disponibles. Intenta de nuevo."; }

const styles = StyleSheet.create({
  content: { paddingBottom: 34 }, heading: { paddingHorizontal: 20, marginTop: 8 }, eyebrow: { color: BRAND.primary, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" }, title: { color: BRAND.wine, fontSize: 27, lineHeight: 34, fontWeight: "800", marginTop: 6 }, subtitle: { color: BRAND.muted, fontSize: 13, lineHeight: 19, marginTop: 6 }, businessList: { gap: 8, paddingHorizontal: 20, paddingTop: 16 }, businessChip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border }, businessChipActive: { backgroundColor: BRAND.primary, borderColor: BRAND.primary }, businessChipText: { color: BRAND.wine, fontSize: 11, fontWeight: "700" }, businessChipTextActive: { color: "#FFFFFF" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 14, backgroundColor: BRAND.surface, borderRadius: 15, height: 45, paddingHorizontal: 13, borderWidth: 1, borderColor: BRAND.border }, input: { flex: 1, color: BRAND.wine, fontSize: 13 }, notice: { marginHorizontal: 20, marginTop: 9, color: BRAND.primaryDark, backgroundColor: BRAND.softPink, fontSize: 11, lineHeight: 16, padding: 10, borderRadius: 12 }, error: { marginHorizontal: 20, marginTop: 9, color: BRAND.error, fontSize: 11, lineHeight: 16 }, appointmentRetry: { marginHorizontal: 20, marginTop: 9, padding: 12, borderRadius: 14, backgroundColor: BRAND.softPink, gap: 6 }, retryMessage: { color: BRAND.error, fontSize: 12, lineHeight: 17 }, retryAction: { color: BRAND.primaryDark, fontSize: 12, fontWeight: "800" }, state: { alignItems: "center", gap: 8, padding: 25 }, stateText: { color: BRAND.muted, fontSize: 12 },
  serviceCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: BRAND.surface, borderRadius: 19, padding: 13, marginHorizontal: 20, marginTop: 9, borderWidth: 1, borderColor: BRAND.border }, serviceIcon: { width: 37, height: 37, borderRadius: 13, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, serviceBody: { flex: 1 }, serviceName: { color: BRAND.wine, fontSize: 13, fontWeight: "800" }, description: { color: BRAND.muted, fontSize: 10, lineHeight: 14, marginTop: 3 }, serviceMeta: { flexDirection: "row", gap: 9, alignItems: "center", marginTop: 6 }, price: { color: BRAND.primaryDark, fontSize: 11, fontWeight: "800" }, duration: { color: BRAND.muted, fontSize: 10, flexDirection: "row", alignItems: "center" }, selectButton: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: BRAND.primary }, selectText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" }, disabled: { opacity: .5 }, section: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 20, marginTop: 24, marginBottom: 8 }, sectionTitle: { color: BRAND.wine, fontSize: 16, fontWeight: "800" }, sectionHint: { color: BRAND.muted, fontSize: 10 }, empty: { alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 22, marginHorizontal: 20, marginTop: 8, padding: 21, borderWidth: 1, borderColor: BRAND.border }, emptyTitle: { color: BRAND.wine, fontSize: 14, fontWeight: "800", marginTop: 9, textAlign: "center" }, emptyText: { color: BRAND.muted, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 4 },
  clientAppointment: { backgroundColor: BRAND.surface, borderRadius: 17, borderWidth: 1, borderColor: BRAND.border, padding: 13, marginHorizontal: 20, marginBottom: 8 }, appointmentTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }, clientService: { color: BRAND.wine, fontSize: 12, fontWeight: "800", flex: 1 }, status: { color: BRAND.primaryDark, backgroundColor: BRAND.softPink, fontSize: 9, fontWeight: "800", textTransform: "capitalize", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden" }, appointmentInfo: { color: BRAND.muted, fontSize: 10, marginTop: 5 },
  modalShade: { flex: 1, backgroundColor: "rgba(40,15,26,.42)", justifyContent: "flex-end" }, sheet: { maxHeight: "88%", backgroundColor: BRAND.background, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingBottom: 26 }, sheetHeader: { flexDirection: "row", alignItems: "center", gap: 9 }, sheetEyebrow: { color: BRAND.primary, fontSize: 9, letterSpacing: 1.1, fontWeight: "800" }, sheetTitle: { color: BRAND.wine, fontSize: 18, fontWeight: "800", marginTop: 3 }, close: { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BRAND.border }, sheetDetails: { color: BRAND.muted, fontSize: 11, marginTop: 5 }, fieldLabel: { color: BRAND.wine, fontSize: 11, fontWeight: "800", marginTop: 13, marginBottom: 6 }, dateRow: { flexDirection: "row", gap: 8 }, dateInput: { flex: 1, height: 42, borderWidth: 1, borderColor: BRAND.border, borderRadius: 12, backgroundColor: BRAND.surface, color: BRAND.wine, paddingHorizontal: 11 }, refresh: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, borderColor: BRAND.border, backgroundColor: BRAND.surface, alignItems: "center", justifyContent: "center" }, employeeList: { gap: 8, paddingVertical: 3 }, employeeChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 9, borderWidth: 1, borderColor: BRAND.border, borderRadius: 14, backgroundColor: BRAND.surface }, employeeChipActive: { backgroundColor: BRAND.primary, borderColor: BRAND.primary }, employeeImage: { width: 26, height: 26, borderRadius: 13 }, employeeIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, employeeText: { color: BRAND.wine, fontSize: 10, fontWeight: "800" }, employeeTextActive: { color: "#FFFFFF" }, slotCount: { color: BRAND.muted, fontSize: 9 }, inlineState: { flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 9 }, inlineHint: { color: BRAND.muted, fontSize: 11 }, emptyHint: { color: BRAND.muted, fontSize: 11, lineHeight: 16, paddingVertical: 8 }, slotScroll: { maxHeight: 125 }, slotList: { flexDirection: "row", flexWrap: "wrap", gap: 7, paddingBottom: 3 }, slot: { minWidth: 61, height: 35, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BRAND.border, borderRadius: 999, backgroundColor: BRAND.surface }, slotActive: { backgroundColor: BRAND.primary, borderColor: BRAND.primary }, slotText: { color: BRAND.wine, fontSize: 11, fontWeight: "700" }, slotTextActive: { color: "#FFFFFF" }, bookButton: { minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: BRAND.primary, borderRadius: 999, marginTop: 13 }, bookText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, disclaimer: { color: BRAND.muted, fontSize: 9, lineHeight: 14, textAlign: "center", marginTop: 7 },
});
