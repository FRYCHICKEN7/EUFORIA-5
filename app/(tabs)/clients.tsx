import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { Search, UserPlus, UsersRound, X } from "lucide-react-native";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { appointmentMillis, loadBusinesses, type BusinessRecord } from "@/lib/appointments";
import { createEmployeeProfile, subscribeAdminClients, subscribeAdminEmployees, type CustomerProfile, type EmployeeProfile } from "@/lib/profiles";
import { profileRole } from "@/lib/roles";
import { useThemeContext } from "@/lib/theme-provider";

function ClientsContent() {
  const { user, profile } = useAuthSession();
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";
  const uid = user?.uid;
  const isAdmin = profileRole(profile) === "admin";
  const [clients, setClients] = useState<CustomerProfile[]>([]);
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(0);
  const [selectedClient, setSelectedClient] = useState<CustomerProfile | null>(null);
  const [businessId, setBusinessId] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [creating, setCreating] = useState(false);

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
    const timer = setTimeout(() => {
      if (!active) return;
      try {
        stopClients = subscribeAdminClients((rows) => {
          if (!active) return;
          setClients(rows);
          setLoading(false);
        }, (reason) => {
          if (!active) return;
          const code = (reason as Error & { code?: string }).code ?? "";
          setError(code === "permission-denied" ? "El perfil administrador no puede leer users/usuarios. Despliega las reglas compatibles con ambas colecciones." : reason.message);
          setLoading(false);
        });
        stopEmployees = subscribeAdminEmployees((rows) => { if (active) setEmployees(rows); }, (reason) => {
          const code = (reason as Error & { code?: string }).code ?? "";
          if (active) setError(code === "permission-denied" ? "No se pudo leer el directorio empleados; revisa las reglas desplegadas." : reason.message);
        });
        void loadBusinesses().then((rows) => {
          if (!active) return;
          setBusinesses(rows);
          setBusinessId((previous) => previous || rows[0]?.id || "");
        }).catch((reason) => { if (active) setError(friendlyError(reason)); });
      } catch (reason) {
        if (active) { setError(friendlyError(reason)); setLoading(false); }
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); stopClients?.(); stopEmployees?.(); };
  }, [isAdmin, uid]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((item) => [item.name, item.displayName, item.nombre, item.email, item.phone, item.telefono, item.identityNumber, item.id]
      .some((value) => String(value ?? "").toLowerCase().includes(term)));
  }, [clients, search]);
  const newClients = clients.filter((item) => {
    const created = appointmentMillis(item.createdAt);
    return created !== null && created >= now - 30 * 24 * 60 * 60 * 1000;
  }).length;

  const createEmployee = async () => {
    if (!selectedClient || !businessId || !employeeCode.trim()) {
      setNotice("Selecciona el negocio y escribe el código de empleado.");
      return;
    }
    setCreating(true);
    setNotice("");
    try {
      const result = await createEmployeeProfile({ uid: selectedClient.id, negocioId: businessId, Empleado: employeeCode.trim() });
      setNotice(`Perfil de ${selectedClient.name ?? selectedClient.displayName ?? "la persona"} creado con código ${result.codigo}. Ya puede entrar como empleado.`);
      setSelectedClient(null);
      setEmployeeCode("");
    } catch (reason) {
      setNotice(employeeError(reason));
    } finally {
      setCreating(false);
    }
  };

  return (
    <AuthGate allowedRoles={["admin", "administrador"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.name ?? profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.titleRow}><View><Text style={[styles.eyebrow, isDark && { color: BRAND.onDarkText }]}>PERFILES FIREBASE REALES</Text><Text style={[styles.title, isDark && { color: BRAND.onDarkText }]}>Clientes y equipo</Text></View></View>
          <View style={styles.metrics}>
            <Metric label="Clientes" value={loading ? "…" : String(clients.length)} />
            <Metric label="Nuevos · 30 días" value={loading ? "…" : String(newClients)} />
            <Metric label="Empleados" value={String(employees.length)} />
          </View>
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, isDark && { color: BRAND.onDarkErrorText }]}>{error}</Text> : null}

          <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, isDark && { color: BRAND.onDarkText }]}>Equipo autorizado</Text><Text style={[styles.sectionCaption, isDark && { color: BRAND.onDarkMutedText }]}>Activa a una persona después de que se registre como cliente.</Text></View>
          {employees.length === 0 ? <View style={styles.inlineEmpty}><UsersRound size={18} color={BRAND.primary} /><Text style={styles.inlineEmptyText}>Aún no hay perfiles de empleado. La cuenta nueva primero debe registrarse como cliente.</Text></View> : employees.map((employee) => <EmployeeCard key={employee.id} item={employee} businessName={businesses.find((business) => business.id === employee.negocioId)?.nombre} />)}

          <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, isDark && { color: BRAND.onDarkText }]}>Perfiles cliente</Text><Text style={[styles.sectionCaption, isDark && { color: BRAND.onDarkMutedText }]}>Datos de users/{"{uid}"} y usuarios/{"{uid}"}, unidos por el UID de Authentication.</Text></View>
          <View style={styles.search}><Search size={18} color={BRAND.muted} /><TextInput value={search} onChangeText={setSearch} placeholder="Buscar nombre, correo, teléfono o UID" placeholderTextColor={BRAND.muted} style={styles.input} /></View>
          {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={[styles.hint, isDark && { color: BRAND.onDarkMutedText }]}>Leyendo perfiles Firebase…</Text></View> : error ? null : filtered.length === 0 ? <View style={styles.empty}><UsersRound size={26} color={BRAND.primary} /><Text style={styles.emptyTitle}>{clients.length === 0 ? "Aún no hay perfiles cliente" : "No encontramos coincidencias"}</Text><Text style={styles.hint}>{clients.length === 0 ? "Al registrarse, cada persona queda guardada con el UID de Authentication y rol cliente." : "Prueba otra búsqueda."}</Text></View> : filtered.map((client) => <ClientCard key={client.id} item={client} onCreateEmployee={() => { setSelectedClient(client); setEmployeeCode(""); setNotice(""); }} />)}
        </ScrollView>
        <Modal visible={Boolean(selectedClient)} transparent animationType="slide" onRequestClose={() => setSelectedClient(null)}>
          <View style={styles.modalShade}><View style={styles.sheet}>
            <View style={styles.sheetTop}><View style={{ flex: 1 }}><Text style={styles.eyebrow}>PERFIL VINCULADO A AUTH</Text><Text style={styles.sheetTitle}>{selectedClient?.name ?? selectedClient?.displayName ?? selectedClient?.nombre ?? "Cliente"}</Text><Text numberOfLines={1} style={styles.uid}>UID: {selectedClient?.id}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={() => setSelectedClient(null)} style={styles.close}><X size={18} color={BRAND.wine} /></Pressable></View>
            <Text style={styles.fieldLabel}>Negocio activo</Text>
            {businesses.length === 0 ? <Text style={styles.inlineEmptyText}>No hay ningún negocio activo en Firebase.</Text> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.businessList}>{businesses.map((business) => <Pressable key={business.id} onPress={() => setBusinessId(business.id)} style={[styles.businessChip, businessId === business.id && styles.businessChipSelected]}><Text style={[styles.businessText, businessId === business.id && styles.businessTextSelected]}>{business.nombre}</Text></Pressable>)}</ScrollView>}
            <Text style={styles.fieldLabel}>Código de empleado (campo Empleado)</Text>
            <TextInput value={employeeCode} onChangeText={setEmployeeCode} placeholder="Ej.: 1" placeholderTextColor={BRAND.muted} autoCapitalize="characters" style={styles.modalInput} />
            <Text style={styles.modalHint}>Esto cambia el perfil cliente a empleado solo mediante Cloud Function; nunca se eleva desde el formulario público.</Text>
            <Pressable disabled={creating || !selectedClient || businesses.length === 0} onPress={() => void createEmployee()} style={[styles.primary, (creating || businesses.length === 0) && styles.disabled]}><Text style={styles.primaryText}>{creating ? "Creando perfil…" : "Crear perfil de empleado"}<Text style={{ fontWeight: "900" }}>  ›</Text></Text></Pressable>
          </View></View>
        </Modal>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function ClientsScreen() { return <ClientsContent />; }

function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }

function ClientCard({ item, onCreateEmployee }: { item: CustomerProfile; onCreateEmployee: () => void }) {
  const displayName = String(item.name ?? item.displayName ?? item.nombre ?? "Cliente EUFORIA");
  const registered = appointmentMillis(item.createdAt);
  const dateLabel = registered ? new Date(registered).toLocaleDateString("es-HN", { timeZone: "America/Tegucigalpa", day: "numeric", month: "short", year: "numeric" }) : "Fecha no disponible";
  return (
    <View style={styles.card}>
      {item.profileImage ? <Image source={{ uri: item.profileImage }} style={styles.photo} contentFit="cover" /> : <View style={styles.avatar}><Text style={styles.initial}>{displayName.charAt(0).toUpperCase()}</Text></View>}
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.name}>{displayName}</Text>
        <Text numberOfLines={1} style={styles.details}>{item.email ?? "Sin correo"}</Text>
        <Text style={styles.details}>Tel. {item.phone ?? item.telefono ?? "No agregado"}{item.identityNumber ? ` · ID ${item.identityNumber}` : ""}</Text>
        <Text numberOfLines={1} style={styles.uid}>UID {item.id} · {String(item.role ?? item.rol ?? "cliente")}</Text>
        <Text style={styles.details}>Registro {dateLabel}</Text>
        <Pressable accessibilityRole="button" onPress={onCreateEmployee} style={styles.promote}><UserPlus size={15} color={BRAND.primaryDark} /><Text style={styles.promoteText}>Crear perfil de empleado</Text></Pressable>
      </View>
    </View>
  );
}

function EmployeeCard({ item, businessName }: { item: EmployeeProfile; businessName?: string }) {
  const name = String(item.name ?? "Empleado EUFORIA");
  return <View style={styles.employeeCard}><View style={styles.avatarSmall}><Text style={styles.initial}>{name.charAt(0).toUpperCase()}</Text></View><View style={styles.copy}><Text style={styles.name}>{name} · {String(item.Empleado ?? "Sin código")}</Text><Text style={styles.details}>{item.email ?? "Sin correo"}{businessName ? ` · ${businessName}` : ""}</Text><Text style={styles.details}>{item.activo === false ? "Inactivo" : item.disponible ? "Disponible para citas" : "No disponible para citas"}</Text><Text numberOfLines={1} style={styles.uid}>UID {item.id}</Text></View></View>;
}

function friendlyError(reason: unknown) {
  const code = (reason as { code?: string })?.code ?? "";
  if (code.includes("permission-denied")) return "Firebase rechazó la lectura. Despliega las reglas del nuevo esquema users/usuarios/empleados y vuelve a iniciar sesión.";
  return reason instanceof Error ? reason.message : "No se pudo leer Firebase.";
}
function employeeError(reason: unknown) {
  const code = (reason as { code?: string })?.code ?? "";
  if (code.includes("permission-denied")) return "Solo una cuenta admin puede crear perfiles. Revisa el UID/rol admin y las Functions desplegadas.";
  if (code.includes("failed-precondition")) return reason instanceof Error ? reason.message : "La persona debe tener perfil cliente completo y el negocio debe estar activo.";
  if (code.includes("already-exists")) return reason instanceof Error ? reason.message : "La cuenta o código ya está asignado.";
  return "No se pudo crear el perfil. Comprueba que las Cloud Functions estén desplegadas y revisa el código/cuenta.";
}

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  titleRow: { paddingHorizontal: 20, marginTop: 10 },
  eyebrow: { color: BRAND.primary, fontSize: 10, letterSpacing: 1.3, fontWeight: "800" },
  title: { color: BRAND.wine, fontSize: 28, fontWeight: "800", marginTop: 5 },
  metrics: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 16 },
  metric: { flex: 1, backgroundColor: BRAND.surface, borderRadius: 17, padding: 12, borderWidth: 1, borderColor: BRAND.border },
  metricLabel: { color: BRAND.muted, fontSize: 10, fontWeight: "700" }, metricValue: { color: BRAND.wine, fontSize: 22, fontWeight: "800", marginTop: 3 },
  notice: { color: BRAND.primaryDark, backgroundColor: BRAND.softPink, fontSize: 12, lineHeight: 18, padding: 12, borderRadius: 15, marginHorizontal: 20, marginTop: 12 },
  error: { color: BRAND.error, fontSize: 12, lineHeight: 18, marginHorizontal: 20, marginTop: 12 },
  sectionHeader: { marginHorizontal: 20, marginTop: 22, marginBottom: 9 }, sectionTitle: { color: BRAND.wine, fontSize: 16, fontWeight: "800" }, sectionCaption: { color: BRAND.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  inlineEmpty: { flexDirection: "row", gap: 9, alignItems: "center", marginHorizontal: 20, padding: 13, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, borderRadius: 16 }, inlineEmptyText: { flex: 1, color: BRAND.muted, fontSize: 11, lineHeight: 16 },
  search: { flexDirection: "row", alignItems: "center", gap: 9, height: 48, backgroundColor: BRAND.surface, borderRadius: 17, marginHorizontal: 20, marginBottom: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: BRAND.border }, input: { flex: 1, color: BRAND.wine, fontSize: 13 },
  state: { alignItems: "center", gap: 9, padding: 28 }, hint: { color: BRAND.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  empty: { alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 24, padding: 26, marginHorizontal: 20, borderWidth: 1, borderColor: BRAND.border }, emptyTitle: { color: BRAND.wine, fontSize: 15, fontWeight: "800", marginTop: 9, textAlign: "center" },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 11, backgroundColor: BRAND.surface, borderRadius: 18, padding: 13, marginHorizontal: 20, marginBottom: 8, borderWidth: 1, borderColor: BRAND.border }, photo: { width: 46, height: 46, borderRadius: 23, backgroundColor: BRAND.softPink }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, avatarSmall: { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, initial: { color: BRAND.primaryDark, fontSize: 15, fontWeight: "800" }, copy: { flex: 1 }, name: { color: BRAND.wine, fontSize: 13, fontWeight: "800" }, details: { color: BRAND.muted, fontSize: 10, lineHeight: 15, marginTop: 2 }, uid: { color: BRAND.muted, fontSize: 9, marginTop: 3 }, promote: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: BRAND.softPink }, promoteText: { color: BRAND.primaryDark, fontSize: 10, fontWeight: "800" },
  employeeCard: { flexDirection: "row", gap: 9, alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 17, padding: 11, marginHorizontal: 20, marginBottom: 7, borderWidth: 1, borderColor: BRAND.border },
  modalShade: { flex: 1, backgroundColor: "rgba(40, 15, 26, .4)", justifyContent: "flex-end" }, sheet: { padding: 21, paddingBottom: 30, backgroundColor: BRAND.background, borderTopLeftRadius: 27, borderTopRightRadius: 27 }, sheetTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, sheetTitle: { color: BRAND.wine, fontSize: 20, fontWeight: "800", marginTop: 4 }, close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border },
  fieldLabel: { color: BRAND.wine, fontSize: 12, fontWeight: "800", marginTop: 17, marginBottom: 7 }, businessList: { gap: 8 }, businessChip: { backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999 }, businessChipSelected: { backgroundColor: BRAND.primary, borderColor: BRAND.primary }, businessText: { color: BRAND.wine, fontSize: 11, fontWeight: "700" }, businessTextSelected: { color: "#FFFFFF" }, modalInput: { height: 49, borderWidth: 1, borderColor: BRAND.border, borderRadius: 15, backgroundColor: BRAND.surface, paddingHorizontal: 13, color: BRAND.wine, fontSize: 15 }, modalHint: { color: BRAND.muted, fontSize: 11, lineHeight: 16, marginTop: 8 }, primary: { minHeight: 49, borderRadius: 999, backgroundColor: BRAND.primary, alignItems: "center", justifyContent: "center", marginTop: 17 }, primaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" }, disabled: { opacity: .55 },
});
