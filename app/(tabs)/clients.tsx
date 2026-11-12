import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { Check, MessageCircle, Search, UserPlus, UsersRound, X } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { AdminClientCreateModal } from "@/components/admin-client-create-modal";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { appointmentMillis, loadBusinesses, type BusinessRecord } from "@/lib/appointments";
import { aprobarSolicitudEmpleado, rechazarSolicitudEmpleado, subscribeAdminClients, subscribeAdminEmployees, subscribePendingEmployeeRequests, type CustomerProfile, type EmployeeProfile, type PendingEmployeeRequest } from "@/lib/profiles";
import { profileRole } from "@/lib/roles";
import { useThemeContext } from "@/lib/theme-provider";
import { getWhatsAppUrl } from "@/lib/whatsapp";
import { formatCustomerBirthday } from "@/lib/customer-fields";

function ClientsContent() {
  const { user, profile } = useAuthSession();
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";
  const uid = user?.uid;
  const isAdmin = profileRole(profile) === "admin";
  const [clients, setClients] = useState<CustomerProfile[]>([]);
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [requests, setRequests] = useState<PendingEmployeeRequest[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(0);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [activeList, setActiveList] = useState<"clientes" | "empleados">("clientes");
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [employeesLoaded, setEmployeesLoaded] = useState(false);
  const [createClientVisible, setCreateClientVisible] = useState(false);

  useEffect(() => {
    const firstTick = setTimeout(() => setNow(Date.now()), 0);
    const minuteTick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearTimeout(firstTick); clearInterval(minuteTick); };
  }, []);

  useEffect(() => {
    if (!isAdmin || !uid) return;
    let active = true;
    let stopClients: (() => void) | undefined;
    let stopEmployees: (() => void) | undefined;
    let stopRequests: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (!active) return;
      try {
        stopClients = subscribeAdminClients((rows) => {
          if (!active) return;
          setClients(rows);
          setLoading(false);
        }, (reason) => {
          if (!active) return;
          console.warn("No se pudo cargar la lista de clientes.", reason);
          setError("No pudimos cargar los clientes. Intenta de nuevo.");
          setLoading(false);
        });
        stopRequests = subscribePendingEmployeeRequests((rows) => { if (active) { setRequests(rows); setRequestsLoaded(true); } }, (reason) => {
          console.warn("No se pudieron cargar las solicitudes del equipo.", reason);
          if (active) { setError("No pudimos cargar las solicitudes del equipo. Intenta de nuevo."); setRequestsLoaded(true); }
        });
        stopEmployees = subscribeAdminEmployees((rows) => { if (active) { setEmployees(rows); setEmployeesLoaded(true); } }, (reason) => {
          console.warn("No se pudo cargar la lista del equipo.", reason);
          if (active) { setError("No pudimos cargar el equipo. Intenta de nuevo."); setEmployeesLoaded(true); }
        });
        void loadBusinesses().then((rows) => {
          if (!active) return;
          setBusinesses(rows);
        }).catch((reason) => { console.warn("No se pudo cargar la lista de negocios.", reason); if (active) setError("No pudimos cargar los negocios. Intenta de nuevo."); });
      } catch (reason) {
        if (active) { setError(friendlyError(reason)); setLoading(false); }
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); stopClients?.(); stopEmployees?.(); stopRequests?.(); };
  }, [isAdmin, uid]);

  const customerProfiles = useMemo(() => {
    const pendingIds = new Set(requests.map((request) => request.id));
    return clients.filter((client) => !pendingIds.has(client.id));
  }, [clients, requests]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customerProfiles;
    return customerProfiles.filter((item) => [item.name, item.displayName, item.nombre, item.email, item.phone, item.telefono]
      .some((value) => String(value ?? "").toLowerCase().includes(term)));
  }, [customerProfiles, search]);
  const newClients = customerProfiles.filter((item) => {
    const created = appointmentMillis(item.createdAt);
    return created !== null && created >= now - 30 * 24 * 60 * 60 * 1000;
  }).length;

  const reviewRequest = async (request: PendingEmployeeRequest, action: "approve" | "reject") => {
    if (requestBusy) return;
    setRequestBusy(request.id);
    setNotice("");
    try {
      if (action === "approve") await aprobarSolicitudEmpleado({ uid: request.id });
      else await rechazarSolicitudEmpleado({ uid: request.id });
      setNotice(action === "approve" ? "Solicitud aceptada. La cuenta ya puede acceder como empleado." : "Solicitud rechazada. La cuenta conserva su perfil de cliente.");
    } catch (reason) {
      console.warn("No se pudo revisar la solicitud del equipo.", reason);
      setNotice(employeeDecisionErrorMessage(reason));
    } finally { setRequestBusy(null); }
  };

  const openWhatsApp = async (client: CustomerProfile) => {
    const phoneNumber = String(client.phone ?? client.telefono ?? "");
    const url = getWhatsAppUrl(phoneNumber);
    if (!url) {
      setNotice("Este perfil no tiene un número telefónico válido para WhatsApp.");
      return;
    }
    try { await Linking.openURL(url); }
    catch (reason) { console.warn("No se pudo abrir el chat de WhatsApp.", reason); setNotice("No pudimos abrir WhatsApp. Intenta de nuevo."); }
  };

  return (
    <AuthGate allowedRoles={["admin", "administrador"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.name ?? profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.titleRow}><View><Text style={[styles.eyebrow, isDark && { color: BRAND.onDarkText }]}>CLIENTES REGISTRADOS</Text><Text style={[styles.title, isDark && { color: BRAND.onDarkText }]}>Clientes y equipo</Text></View></View>
          <View style={styles.metrics}>
            <Metric label="Clientes" value={loading ? "…" : String(customerProfiles.length)} />
            <Metric label="Nuevos · 30 días" value={loading ? "…" : String(newClients)} />
            <Metric label="Empleados" value={String(employees.length)} />
          </View>
          <View style={styles.listTabs} accessibilityRole="tablist">
            <Pressable accessibilityRole="tab" accessibilityState={{ selected: activeList === "clientes" }} onPress={() => setActiveList("clientes")} style={[styles.listTab, activeList === "clientes" && styles.listTabActive]}>
              <Text style={[styles.listTabText, activeList === "clientes" && styles.listTabTextActive]}>Clientes</Text>
            </Pressable>
            <Pressable accessibilityRole="tab" accessibilityState={{ selected: activeList === "empleados" }} onPress={() => setActiveList("empleados")} style={[styles.listTab, activeList === "empleados" && styles.listTabActive]}>
              <Text style={[styles.listTabText, activeList === "empleados" && styles.listTabTextActive]}>Empleados</Text>
              {requests.length > 0 && <View style={[styles.requestBadge, activeList === "empleados" && styles.requestBadgeActive]}><Text style={[styles.requestBadgeText, activeList === "empleados" && styles.requestBadgeTextActive]}>{requests.length}</Text></View>}
            </Pressable>
          </View>
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, isDark && { color: BRAND.onDarkErrorText }]}>{error}</Text> : null}

          {activeList === "empleados" ? <>
            <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, isDark && { color: BRAND.onDarkText }]}>Solicitudes de empleado</Text><Text style={[styles.sectionCaption, isDark && { color: BRAND.onDarkMutedText }]}>Quienes se registren desde el acceso de empleado aparecerán aquí para revisión.</Text></View>
            {!requestsLoaded && !error ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={[styles.hint, isDark && { color: BRAND.onDarkMutedText }]}>Cargando solicitudes…</Text></View> : requests.length > 0 ? <View style={styles.requestList}>{requests.map((request) => <PendingRequestCard key={request.id} item={request} busy={requestBusy === request.id} onApprove={() => void reviewRequest(request, "approve")} onReject={() => void reviewRequest(request, "reject")} />)}</View> : !error ? <View style={styles.inlineEmpty}><UsersRound size={18} color={BRAND.primary} /><Text style={styles.inlineEmptyText}>No hay solicitudes pendientes. La persona debe elegir «Empleado» y registrarse desde el acceso del equipo.</Text></View> : null}
            <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, isDark && { color: BRAND.onDarkText }]}>Empleados aceptados</Text><Text style={[styles.sectionCaption, isDark && { color: BRAND.onDarkMutedText }]}>Solo aparecen aquí después de que administración acepte su solicitud.</Text></View>
            {!employeesLoaded && !error ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={[styles.hint, isDark && { color: BRAND.onDarkMutedText }]}>Cargando empleados…</Text></View> : employees.length === 0 ? !error && <View style={styles.inlineEmpty}><UsersRound size={18} color={BRAND.primary} /><Text style={styles.inlineEmptyText}>Aún no hay empleados aceptados.</Text></View> : employees.map((employee) => <EmployeeCard key={employee.id} item={employee} businessName={businesses.find((business) => business.id === employee.negocioId)?.nombre} />)}
          </> : <>
            <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, isDark && { color: BRAND.onDarkText }]}>Perfiles cliente</Text><Text style={[styles.sectionCaption, isDark && { color: BRAND.onDarkMutedText }]}>Perfiles de las personas que usan EUFORIA.</Text></View>
            <Pressable accessibilityRole="button" onPress={() => setCreateClientVisible(true)} style={styles.createClientButton}><UserPlus size={17} color="#FFFFFF" /><Text style={styles.createClientText}>Crear cliente</Text></Pressable>
            <View style={styles.search}><Search size={18} color={BRAND.muted} /><TextInput value={search} onChangeText={setSearch} placeholder="Buscar nombre, correo o teléfono" placeholderTextColor={BRAND.muted} style={styles.input} /></View>
            {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={[styles.hint, isDark && { color: BRAND.onDarkMutedText }]}>Cargando perfiles…</Text></View> : error ? null : filtered.length === 0 ? <View style={styles.empty}><UsersRound size={26} color={BRAND.primary} /><Text style={styles.emptyTitle}>{customerProfiles.length === 0 ? "Aún no hay perfiles cliente" : "No encontramos coincidencias"}</Text><Text style={styles.hint}>{customerProfiles.length === 0 ? "Aquí aparecerán las personas que se registren como clientes." : "Prueba otra búsqueda."}</Text></View> : filtered.map((client) => <ClientCard key={client.id} item={client} onWhatsApp={() => void openWhatsApp(client)} />)}
          </>}
        </ScrollView>
        <AdminClientCreateModal
          visible={createClientVisible}
          onClose={() => setCreateClientVisible(false)}
          onCreated={(email) => {
            setActiveList("clientes");
            setSearch("");
            setNotice(`Creamos el perfil para ${email}. La contraseña provisional está visible mientras esta ventana siga abierta.`);
          }}
        />
      </ScreenContainer>
    </AuthGate>
  );
}

export default function ClientsScreen() { return <ClientsContent />; }

function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }

function ClientCard({ item, onWhatsApp }: { item: CustomerProfile; onWhatsApp: () => void }) {
  const displayName = String(item.name ?? item.displayName ?? item.nombre ?? "Cliente EUFORIA");
  const canOpenWhatsApp = Boolean(getWhatsAppUrl(String(item.phone ?? item.telefono ?? "")));
  const registered = appointmentMillis(item.createdAt);
  const dateLabel = registered ? new Date(registered).toLocaleDateString("es-HN", { timeZone: "America/Tegucigalpa", day: "numeric", month: "short", year: "numeric" }) : "Fecha no disponible";
  return (
    <View style={styles.card}>
      {item.profileImage ? <Image source={{ uri: item.profileImage }} style={styles.photo} contentFit="cover" /> : <View style={styles.avatar}><Text style={styles.initial}>{displayName.charAt(0).toUpperCase()}</Text></View>}
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.name}>{displayName}</Text>
        <Text numberOfLines={1} style={styles.details}>{item.email ?? "Sin correo"}</Text>
        <Text style={styles.details}>Tel. {item.phone ?? item.telefono ?? "No agregado"}</Text>
        {formatCustomerBirthday(item.birthdayDay, item.birthdayMonth) ? <Text style={styles.details}>Cumpleaños: {formatCustomerBirthday(item.birthdayDay, item.birthdayMonth)}</Text> : null}
        <Text style={styles.details}>Registro {dateLabel}</Text>
        <View style={styles.cardActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={canOpenWhatsApp ? `Abrir WhatsApp para ${displayName}` : "Cliente sin teléfono válido"} disabled={!canOpenWhatsApp} onPress={onWhatsApp} style={[styles.whatsappButton, !canOpenWhatsApp && styles.disabled]}><MessageCircle size={15} color={canOpenWhatsApp ? "#187A4E" : BRAND.muted} /><Text style={[styles.whatsappText, !canOpenWhatsApp && { color: BRAND.muted }]}>{canOpenWhatsApp ? "WhatsApp" : "Sin teléfono"}</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

function PendingRequestCard({ item, busy, onApprove, onReject }: { item: PendingEmployeeRequest; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const name = String(item.name ?? item.displayName ?? item.nombre ?? "Persona sin nombre");
  return <View style={styles.requestCard}><View style={styles.copy}><Text style={styles.name}>{name}</Text><Text style={styles.details}>{item.email ?? "Sin correo"}</Text><Text style={styles.details}>Tel. {item.phone ?? item.telefono ?? "No agregado"}</Text><Text style={styles.pendingLabel}>Solicitud pendiente</Text><View style={styles.requestActions}><Pressable accessibilityRole="button" accessibilityLabel={`Aceptar solicitud de ${name}`} disabled={busy} onPress={onApprove} style={[styles.acceptButton, busy && styles.disabled]}><Check size={15} color="#FFFFFF"/><Text style={styles.actionText}>Aceptar</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Rechazar solicitud de ${name}`} disabled={busy} onPress={onReject} style={[styles.rejectButton, busy && styles.disabled]}><X size={15} color="#FFFFFF"/><Text style={styles.actionText}>Rechazar</Text></Pressable></View></View></View>;
}

function EmployeeCard({ item, businessName }: { item: EmployeeProfile; businessName?: string }) {
  const name = String(item.name ?? "Empleado EUFORIA");
  return <View style={styles.employeeCard}><View style={styles.avatarSmall}><Text style={styles.initial}>{name.charAt(0).toUpperCase()}</Text></View><View style={styles.copy}><Text style={styles.name}>{name} · {String(item.Empleado ?? "Sin código")}</Text><Text style={styles.details}>{item.email ?? "Sin correo"}{businessName ? ` · ${businessName}` : ""}</Text><Text style={styles.details}>{item.activo === false ? "Inactivo" : item.disponible ? "Disponible para citas" : "No disponible para citas"}</Text></View></View>;
}

function friendlyError(reason: unknown) {
  console.warn("No se pudo cargar la información de clientes y equipo.", reason);
  return "No pudimos cargar la información. Intenta de nuevo.";
}

function employeeDecisionErrorMessage(reason: unknown) {
  const code = String((reason as { code?: unknown } | null)?.code ?? "").replace(/^functions\//, "");
  const serverMessage = String((reason as { message?: unknown } | null)?.message ?? "").toLowerCase();
  if (code === "not-found") return "No encontramos la solicitud. Actualiza la pantalla y revisa de nuevo.";
  if (code === "unauthenticated") return "Tu sesión terminó. Vuelve a ingresar como administración e inténtalo de nuevo.";
  if (code === "permission-denied") return "Esta cuenta no tiene permiso para aprobar solicitudes.";
  if (code === "failed-precondition" && serverMessage.includes("más de un negocio activo")) return "Hay más de un negocio activo. Deja solo uno activo en Ajustes y vuelve a aceptar la solicitud.";
  if (code === "failed-precondition" && serverMessage.includes("negocio activo cambió")) return "El negocio activo cambió. Actualiza la pantalla y vuelve a intentarlo.";
  if (code === "failed-precondition" && serverMessage.includes("nombre, correo y teléfono")) return "Completa el nombre, el correo y el teléfono de esta cuenta antes de aceptarla.";
  if (code === "failed-precondition") return "No se pudo aprobar porque la solicitud o los datos de la cuenta cambiaron. Actualiza la pantalla y revisa el perfil.";
  if (code === "already-exists") return "Esta persona ya tiene un perfil de empleado. Actualiza la pantalla.";
  if (code === "unavailable" || code === "deadline-exceeded") return "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";
  return "No pudimos guardar la decisión. Actualiza la pantalla e inténtalo de nuevo.";
}

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  titleRow: { paddingHorizontal: 20, marginTop: 10 },
  eyebrow: { color: BRAND.primary, fontSize: 10, letterSpacing: 1.3, fontWeight: "800" },
  title: { color: BRAND.wine, fontSize: 28, fontWeight: "800", marginTop: 5 },
  metrics: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 16 },
  metric: { flex: 1, backgroundColor: BRAND.surface, borderRadius: 17, padding: 12, borderWidth: 1, borderColor: BRAND.border },
  listTabs: { flexDirection: "row", gap: 8, marginHorizontal: 20, marginTop: 14, padding: 4, borderRadius: 16, borderWidth: 1, borderColor: BRAND.border, backgroundColor: BRAND.surface },
  listTab: { flex: 1, minHeight: 42, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  listTabActive: { backgroundColor: BRAND.primary },
  listTabText: { color: BRAND.wine, fontSize: 13, fontWeight: "800" },
  listTabTextActive: { color: "#FFFFFF" },
  requestBadge: { minWidth: 19, height: 19, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, backgroundColor: BRAND.softPink },
  requestBadgeActive: { backgroundColor: "#FFFFFF" },
  requestBadgeText: { color: BRAND.wine, fontSize: 10, fontWeight: "900" },
  requestBadgeTextActive: { color: BRAND.primaryDark },
  metricLabel: { color: BRAND.muted, fontSize: 10, fontWeight: "700" }, metricValue: { color: BRAND.wine, fontSize: 22, fontWeight: "800", marginTop: 3 },
  notice: { color: BRAND.primaryDark, backgroundColor: BRAND.softPink, fontSize: 12, lineHeight: 18, padding: 12, borderRadius: 15, marginHorizontal: 20, marginTop: 12 },
  error: { color: BRAND.error, fontSize: 12, lineHeight: 18, marginHorizontal: 20, marginTop: 12 },
  sectionHeader: { marginHorizontal: 20, marginTop: 22, marginBottom: 9 }, sectionTitle: { color: BRAND.wine, fontSize: 16, fontWeight: "800" }, sectionCaption: { color: BRAND.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  inlineEmpty: { flexDirection: "row", gap: 9, alignItems: "center", marginHorizontal: 20, padding: 13, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, borderRadius: 16 }, inlineEmptyText: { flex: 1, color: BRAND.muted, fontSize: 11, lineHeight: 16 },
  search: { flexDirection: "row", alignItems: "center", gap: 9, height: 48, backgroundColor: BRAND.surface, borderRadius: 17, marginHorizontal: 20, marginBottom: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: BRAND.border }, input: { flex: 1, color: BRAND.wine, fontSize: 13 },
  state: { alignItems: "center", gap: 9, padding: 28 }, hint: { color: BRAND.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  empty: { alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 24, padding: 26, marginHorizontal: 20, borderWidth: 1, borderColor: BRAND.border }, emptyTitle: { color: BRAND.wine, fontSize: 15, fontWeight: "800", marginTop: 9, textAlign: "center" },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 11, backgroundColor: BRAND.surface, borderRadius: 18, padding: 13, marginHorizontal: 20, marginBottom: 8, borderWidth: 1, borderColor: BRAND.border }, photo: { width: 46, height: 46, borderRadius: 23, backgroundColor: BRAND.softPink }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, avatarSmall: { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, initial: { color: BRAND.primaryDark, fontSize: 15, fontWeight: "800" }, copy: { flex: 1 }, name: { color: BRAND.wine, fontSize: 13, fontWeight: "800" }, details: { color: BRAND.muted, fontSize: 10, lineHeight: 15, marginTop: 2 }, cardActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 }, whatsappButton: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: "#EAF6EF" }, whatsappText: { color: "#187A4E", fontSize: 10, fontWeight: "800" },
  requestList: { gap: 8 }, requestCard: { flexDirection: "row", backgroundColor: BRAND.surface, borderRadius: 18, padding: 14, marginHorizontal: 20, marginBottom: 8, borderWidth: 1, borderColor: BRAND.border }, pendingLabel: { color: BRAND.primaryDark, fontSize: 11, fontWeight: "800", marginTop: 5 }, requestActions: { flexDirection: "row", gap: 9, marginTop: 10 }, acceptButton: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: BRAND.primaryDark, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 }, rejectButton: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: BRAND.wine, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 }, actionText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  employeeCard: { flexDirection: "row", gap: 9, alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 17, padding: 11, marginHorizontal: 20, marginBottom: 7, borderWidth: 1, borderColor: BRAND.border },
  createClientButton: { minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: BRAND.primary, borderRadius: 999, marginHorizontal: 20, marginBottom: 12 },
  createClientText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  disabled: { opacity: .55 },
});
