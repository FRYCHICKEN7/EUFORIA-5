import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Clock3, Pencil, Plus, Scissors } from "lucide-react-native";
import { router } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { loadBusinesses, loadServices, saveService, type BusinessRecord, type ServiceRecord } from "@/lib/appointments";

function ServicesContent() {
  const { user, profile } = useAuthSession();
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("30");
  const [active, setActive] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => {
      void loadBusinesses().then((items) => {
        if (!mounted) return;
        setBusinesses(items);
        setBusinessId((current) => current || items[0]?.id || "");
        if (items.length === 0) setLoading(false);
      }).catch((reason) => { if (mounted) { setError(serviceError(reason)); setLoading(false); } });
    }, 0);
    return () => { mounted = false; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let mounted = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void loadServices(businessId, true).then((items) => {
        if (mounted) setServices(items);
      }).catch((reason) => { if (mounted) setError(serviceError(reason)); }).finally(() => { if (mounted) setLoading(false); });
    }, 0);
    return () => { mounted = false; clearTimeout(timer); };
  }, [businessId]);

  const resetForm = () => {
    setServiceId(""); setName(""); setDescription(""); setPrice(""); setHours("0"); setMinutes("30"); setActive(true); setMessage(""); setError("");
  };

  const editService = (service: ServiceRecord) => {
    setServiceId(service.id);
    setName(service.nombre);
    setDescription(service.descripcion);
    setPrice(service.precio === null ? "" : String(service.precio));
    const duration = service.duracionMin ?? 0;
    setHours(String(Math.floor(duration / 60)));
    setMinutes(String(duration % 60));
    setActive(service.activo);
    setMessage(""); setError("");
  };

  const save = async () => {
    setError(""); setMessage("");
    const numericPrice = Number(price.replace(",", "."));
    const totalMinutes = Number(hours) * 60 + Number(minutes);
    if (!businessId) { setError("Activa un negocio en Firebase antes de guardar servicios."); return; }
    if (!name.trim()) { setError("Escribe el nombre del servicio."); return; }
    if (!Number.isFinite(numericPrice) || numericPrice < 0) { setError("Escribe un precio numérico válido en lempiras."); return; }
    if (!Number.isInteger(totalMinutes) || totalMinutes < 5 || totalMinutes > 480 || Number(minutes) > 59 || Number(minutes) < 0) { setError("La duración debe ser de 5 a 480 minutos; minutos entre 0 y 59."); return; }
    setSaving(true);
    try {
      const wasEditing = Boolean(serviceId);
      await saveService({ businessId, id: serviceId || undefined, nombre: name.trim(), descripcion: description.trim(), precio: numericPrice, duracionMin: totalMinutes, activo: active });
      const items = await loadServices(businessId, true);
      setServices(items);
      resetForm();
      setMessage(wasEditing ? "Servicio actualizado." : "Servicio creado.");
    } catch (reason) {
      setError(serviceError(reason));
    } finally { setSaving(false); }
  };

  const estimatedTime = `${Number(hours) || 0} h ${String(Number(minutes) || 0).padStart(2, "0")} min`;
  return (
    <AuthGate allowedRoles={["admin", "administrador"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.name ?? profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.heading}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Volver</Text></Pressable><Text style={styles.eyebrow}>CATÁLOGO EUFORIA</Text><Text style={styles.title}>Servicios y tiempos</Text><Text style={styles.subtitle}>La duración estimada define qué franjas caben en el turno y es la referencia para medir el tiempo real.</Text></View>
          <View style={styles.businessBox}><Text style={styles.label}>Negocio</Text>{businesses.length === 0 ? <Text style={styles.hint}>No hay negocios activos configurados en Firebase.</Text> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.businessChips}>{businesses.map((business) => <Pressable key={business.id} onPress={() => setBusinessId(business.id)} style={[styles.chip, businessId === business.id && styles.chipActive]}><Text style={[styles.chipText, businessId === business.id && styles.chipTextActive]}>{business.nombre}</Text></Pressable>)}</ScrollView>}</View>
          <View style={styles.formCard}><View style={styles.formHeading}><View style={styles.iconCircle}>{serviceId ? <Pencil size={18} color={BRAND.primaryDark} /> : <Plus size={18} color={BRAND.primaryDark} />}</View><View><Text style={styles.formTitle}>{serviceId ? "Editar servicio" : "Nuevo servicio"}</Text><Text style={styles.formHint}>Duración guardada como minutos enteros.</Text></View></View>
            <Text style={styles.label}>Nombre del trabajo</Text><TextInput value={name} onChangeText={setName} placeholder="Ej.: Corte de Cabello Hombre" placeholderTextColor={BRAND.muted} style={styles.input} />
            <Text style={styles.label}>Descripción (opcional)</Text><TextInput value={description} onChangeText={setDescription} placeholder="Detalle breve para clientes" placeholderTextColor={BRAND.muted} style={[styles.input, styles.multiline]} multiline />
            <Text style={styles.label}>Precio · lempiras</Text><View style={styles.moneyInput}><Text style={styles.currency}>L.</Text><TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="120.00" placeholderTextColor={BRAND.muted} style={styles.moneyText} /></View>
            <Text style={styles.label}>Tiempo estimado</Text><View style={styles.durationRow}><View style={styles.durationField}><TextInput value={hours} onChangeText={setHours} keyboardType="number-pad" maxLength={2} style={styles.durationInput} /><Text style={styles.durationSuffix}>horas</Text></View><View style={styles.durationField}><TextInput value={minutes} onChangeText={setMinutes} keyboardType="number-pad" maxLength={2} style={styles.durationInput} /><Text style={styles.durationSuffix}>min</Text></View><Text style={styles.durationPreview}>{estimatedTime}</Text></View>
            <Text style={styles.conversion}>Ejemplo: 1 h 30 min se guarda como `duracionMin: 90`.</Text>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: active }} onPress={() => setActive((value) => !value)} style={styles.activeRow}><View style={[styles.checkbox, active && styles.checkboxActive]}>{active ? <Text style={styles.checkmark}>✓</Text> : null}</View><Text style={styles.activeText}>{active ? "Activo para reservas" : "Inactivo: no aparece a clientes"}</Text></Pressable>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
            <Pressable disabled={saving} onPress={() => void save()} style={[styles.saveButton, saving && styles.disabled]}><Text style={styles.saveText}>{saving ? "Guardando…" : serviceId ? "Guardar cambios" : "Guardar servicio"}</Text></Pressable>
            {serviceId ? <Pressable onPress={resetForm} style={styles.cancel}><Text style={styles.cancelText}>Cancelar edición</Text></Pressable> : null}
          </View>
          <View style={styles.listHeader}><Text style={styles.sectionTitle}>Servicios guardados</Text><Text style={styles.hint}>{services.length} registros</Text></View>
          {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={styles.hint}>Cargando catálogo…</Text></View> : services.length === 0 ? <View style={styles.empty}><Scissors size={24} color={BRAND.primary} /><Text style={styles.emptyText}>No hay servicios configurados. Crea el primer registro real arriba.</Text></View> : services.map((service) => <Pressable key={service.id} onPress={() => editService(service)} style={styles.serviceCard}><View style={styles.serviceIcon}><Scissors size={17} color={BRAND.primaryDark} /></View><View style={styles.serviceCopy}><Text style={styles.serviceName}>{service.nombre}</Text><View style={styles.serviceMeta}><Text style={styles.hint}>{service.precio === null ? "Precio pendiente" : `L. ${service.precio.toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</Text><Clock3 size={12} color={BRAND.muted} /><Text style={styles.hint}>{service.duracionMin ? formatDuration(service.duracionMin) : "Duración pendiente"}</Text></View><Text style={[styles.stateTag, service.activo ? styles.activeTag : styles.inactiveTag]}>{service.activo ? "Activo" : "Inactivo"}</Text></View><Pencil size={16} color={BRAND.muted} /></Pressable>)}
        </ScrollView>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function AdminServicesScreen() { return <ServicesContent />; }
function formatDuration(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; return hours ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min`; }
function serviceError(reason: unknown) { const code = (reason as { code?: string })?.code ?? ""; if (code.includes("permission-denied")) return "No tienes permiso para editar servicios; inicia como administrador y despliega las Rules actualizadas."; return reason instanceof Error ? reason.message : "No se pudo leer o guardar el servicio."; }

const styles = StyleSheet.create({
  content: { paddingBottom: 34 }, heading: { paddingHorizontal: 20, marginTop: 7 }, back: { color: BRAND.primaryDark, fontSize: 12, fontWeight: "800", marginBottom: 12 }, eyebrow: { color: BRAND.primary, fontSize: 10, letterSpacing: 1.25, fontWeight: "800" }, title: { color: BRAND.wine, fontSize: 27, fontWeight: "800", marginTop: 4 }, subtitle: { color: BRAND.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  businessBox: { backgroundColor: BRAND.surface, marginHorizontal: 20, marginTop: 14, padding: 13, borderRadius: 17, borderWidth: 1, borderColor: BRAND.border }, label: { color: BRAND.wine, fontSize: 11, fontWeight: "800", marginTop: 12, marginBottom: 6 }, businessChips: { gap: 7 }, chip: { borderWidth: 1, borderColor: BRAND.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: BRAND.background }, chipActive: { backgroundColor: BRAND.primary, borderColor: BRAND.primary }, chipText: { color: BRAND.wine, fontSize: 11, fontWeight: "700" }, chipTextActive: { color: "#FFFFFF" },
  formCard: { backgroundColor: BRAND.surface, marginHorizontal: 20, marginTop: 12, padding: 15, borderRadius: 20, borderWidth: 1, borderColor: BRAND.border }, formHeading: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 2 }, iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, formTitle: { color: BRAND.wine, fontSize: 15, fontWeight: "800" }, formHint: { color: BRAND.muted, fontSize: 10, marginTop: 2 }, input: { height: 44, borderWidth: 1, borderColor: BRAND.border, borderRadius: 13, paddingHorizontal: 12, color: BRAND.wine, fontSize: 13, backgroundColor: BRAND.background }, multiline: { height: 68, textAlignVertical: "top", paddingTop: 10 }, moneyInput: { height: 44, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: BRAND.border, borderRadius: 13, backgroundColor: BRAND.background, paddingHorizontal: 12 }, currency: { color: BRAND.primaryDark, fontSize: 14, fontWeight: "800" }, moneyText: { flex: 1, height: "100%", color: BRAND.wine, fontSize: 13, paddingLeft: 8 }, durationRow: { flexDirection: "row", alignItems: "center", gap: 7 }, durationField: { height: 43, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: BRAND.border, borderRadius: 13, backgroundColor: BRAND.background, paddingHorizontal: 9 }, durationInput: { minWidth: 25, color: BRAND.wine, fontSize: 14, fontWeight: "800", textAlign: "center" }, durationSuffix: { color: BRAND.muted, fontSize: 10, marginLeft: 4 }, durationPreview: { flex: 1, color: BRAND.primaryDark, fontSize: 10, fontWeight: "800", textAlign: "right" }, conversion: { color: BRAND.muted, fontSize: 10, marginTop: 6 }, activeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 13 }, checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: BRAND.border, borderRadius: 5, alignItems: "center", justifyContent: "center" }, checkboxActive: { backgroundColor: BRAND.success, borderColor: BRAND.success }, checkmark: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" }, activeText: { color: BRAND.wine, fontSize: 11, fontWeight: "700" }, saveButton: { minHeight: 45, backgroundColor: BRAND.primary, borderRadius: 999, alignItems: "center", justifyContent: "center", marginTop: 15 }, saveText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, cancel: { alignSelf: "center", padding: 10 }, cancelText: { color: BRAND.muted, fontSize: 11, fontWeight: "700" }, disabled: { opacity: .55 }, error: { color: BRAND.error, fontSize: 11, lineHeight: 16, marginTop: 10 }, message: { color: BRAND.primaryDark, fontSize: 11, lineHeight: 16, marginTop: 10 },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginHorizontal: 20, marginTop: 22, marginBottom: 5 }, sectionTitle: { color: BRAND.wine, fontSize: 15, fontWeight: "800" }, hint: { color: BRAND.muted, fontSize: 10 }, state: { alignItems: "center", gap: 8, padding: 20 }, empty: { alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 18, padding: 20, marginHorizontal: 20, marginTop: 8, borderWidth: 1, borderColor: BRAND.border }, emptyText: { color: BRAND.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 8 }, serviceCard: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, borderRadius: 16, padding: 12, marginHorizontal: 20, marginTop: 7 }, serviceIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: BRAND.softPink }, serviceCopy: { flex: 1 }, serviceName: { color: BRAND.wine, fontSize: 12, fontWeight: "800" }, serviceMeta: { flexDirection: "row", gap: 5, alignItems: "center", marginTop: 4 }, stateTag: { alignSelf: "flex-start", fontSize: 9, marginTop: 3, fontWeight: "800" }, activeTag: { color: BRAND.success }, inactiveTag: { color: BRAND.muted },
});
