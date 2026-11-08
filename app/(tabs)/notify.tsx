import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MessageCircle, Search, ShieldCheck } from "lucide-react-native";
import { router } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { NotificationSetupCard } from "@/components/notification-setup-card";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { appointmentMillis, loadBusinesses, type BusinessRecord } from "@/lib/appointments";
import { subscribeAdminClients, type CustomerProfile } from "@/lib/profiles";
import { getWhatsAppUrl, normalizeWhatsAppNumber } from "@/lib/whatsapp";
import {
  DEFAULT_REMINDER_LEAD_HOURS,
  DEFAULT_REMINDER_TEMPLATES,
  isSafeReminderMessage,
  loadReminderConfiguration,
  renderReminderTemplate,
  saveReminderConfiguration,
  subscribeAdminWhatsAppReminders,
  updateWhatsAppReminder,
  type ReminderStatus,
  type ReminderType,
  type WhatsAppReminder,
} from "@/lib/whatsapp-reminders";
import { WhatsAppPreview } from "@/components/whatsapp-preview";
import { useThemeContext } from "@/lib/theme-provider";

const HONDURAS_TIME_ZONE = "America/Tegucigalpa";
const REMINDER_TYPES: (ReminderType | "todos")[] = ["todos", "cita", "regreso", "cumpleanos"];
const REMINDER_STATES: (ReminderStatus | "todos")[] = ["todos", "pendiente", "preparado", "enviado", "omitido", "cancelado"];
const TYPE_LABELS: Record<ReminderType | "todos", string> = {
  todos: "Todos",
  cita: "Cita",
  regreso: "Regreso",
  cumpleanos: "Cumpleaños",
};
const STATE_LABELS: Record<ReminderStatus, string> = {
  pendiente: "Pendiente",
  preparado: "Preparado",
  enviado: "Enviado",
  omitido: "Omitido",
  cancelado: "Cancelado",
};
const TEMPLATE_LABELS: Record<ReminderType, string> = {
  cita: "Mensaje para una cita",
  regreso: "Mensaje para invitar a regresar",
  cumpleanos: "Mensaje de cumpleaños",
};
const TEMPLATE_VARIABLES: Record<ReminderType, Set<string>> = {
  cita: new Set(["Nombre del cliente", "Fecha de la cita", "Hora de la cita", "Nombre del servicio", "Nombre del negocio"]),
  regreso: new Set(["Nombre del cliente", "Nombre del servicio", "Días para volver", "Nombre del negocio"]),
  cumpleanos: new Set(["Nombre del cliente", "Nombre del negocio"]),
};

type Row = {
  key: string;
  type: ReminderType;
  client: CustomerProfile;
  reminder: WhatsAppReminder;
  when: string;
  serviceName: string;
  message: string;
};

function isValidTemplate(message: string, type: ReminderType) {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 1200) return false;
  const placeholders = [...trimmed.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
  const withoutPlaceholders = trimmed.replace(/\{\{\s*[^{}]+?\s*\}\}/g, "");
  if (withoutPlaceholders.includes("{{") || withoutPlaceholders.includes("}}")) return false;
  return placeholders.every((match) => TEMPLATE_VARIABLES[type].has(match[1]));
}

function formatReminderTime(reminder: WhatsAppReminder, type: ReminderType, date: Date) {
  if (type === "cumpleanos") return "Hoy";
  if (type === "cita") {
    const dateText = String(reminder.citaFecha ?? "");
    const timeText = String(reminder.citaHoraInicio ?? "");
    return [dateText, timeText].filter(Boolean).join(" · ") || date.toLocaleString("es-HN", { timeZone: HONDURAS_TIME_ZONE });
  }
  return date.toLocaleDateString("es-HN", { timeZone: HONDURAS_TIME_ZONE, day: "numeric", month: "long", year: "numeric" });
}

function NotifyContent() {
  const { user, profile } = useAuthSession();
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [clients, setClients] = useState<CustomerProfile[]>([]);
  const [reminders, setReminders] = useState<WhatsAppReminder[]>([]);
  const [nowMillis, setNowMillis] = useState(0);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ReminderType | "todos">("todos");
  const [stateFilter, setStateFilter] = useState<ReminderStatus | "todos">("todos");
  const [selected, setSelected] = useState<Row | null>(null);
  const [templates, setTemplates] = useState(DEFAULT_REMINDER_TEMPLATES);
  const [leadHours, setLeadHours] = useState(DEFAULT_REMINDER_LEAD_HOURS);
  const [saving, setSaving] = useState(false);
  const [loadedConfigurationFor, setLoadedConfigurationFor] = useState("");
  const [failedConfigurationFor, setFailedConfigurationFor] = useState("");
  const [configurationRetry, setConfigurationRetry] = useState(0);
  const configurationLoading = Boolean(businessId) && loadedConfigurationFor !== businessId && failedConfigurationFor !== businessId;
  const configurationReady = Boolean(businessId) && loadedConfigurationFor === businessId;
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const firstTick = setTimeout(() => setNowMillis(Date.now()), 0);
    const minuteTick = setInterval(() => setNowMillis(Date.now()), 60_000);
    return () => {
      clearTimeout(firstTick);
      clearInterval(minuteTick);
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadBusinesses()
      .then((items) => {
        if (active) {
          setBusinesses(items);
          setBusinessId((current) => current || items[0]?.id || "");
        }
      })
      .catch((reason) => {
        console.warn("No se pudieron cargar los negocios para Avisar.", reason);
        if (active) setStatusMessage("No pudimos cargar los negocios.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let active = true;
    loadReminderConfiguration(businessId)
      .then((config) => {
        if (active) {
          setLeadHours(config.horasAntesCita);
          setTemplates(config.plantillas);
          setLoadedConfigurationFor(businessId);
          setFailedConfigurationFor("");
        }
      })
      .catch((reason) => {
        console.warn("No se pudieron cargar los ajustes de avisos.", reason);
        if (active) {
          setStatusMessage("No pudimos cargar los ajustes. Intenta de nuevo antes de guardar.");
          setFailedConfigurationFor(businessId);
        }
      });
    return () => { active = false; };
  }, [businessId, configurationRetry]);

  useEffect(() => {
    let active = true;
    const unsubscribers: (() => void)[] = [];
    const subscribeTimer = setTimeout(() => {
      try {
        unsubscribers.push(subscribeAdminClients(
          (items) => { if (active) setClients(items); },
          (reason) => {
            console.warn("No se pudieron actualizar los perfiles en Avisar.", reason);
            if (active) setStatusMessage("No pudimos actualizar los perfiles.");
          },
        ));
        if (businessId) {
          unsubscribers.push(subscribeAdminWhatsAppReminders(
            businessId,
            (items) => { if (active) setReminders(items); },
            (reason) => {
              console.warn("No se pudieron actualizar los avisos.", reason);
              if (active) setStatusMessage("No pudimos actualizar los avisos.");
            },
          ));
        }
      } catch (reason) {
        console.warn("No se pudo iniciar la bandeja de avisos.", reason);
        if (active) setStatusMessage("No pudimos conectar con los avisos.");
      }
    }, 0);
    return () => {
      active = false;
      clearTimeout(subscribeTimer);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [businessId]);

  const rows = useMemo(() => {
    if (!nowMillis) return [] as Row[];
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const activeBusiness = businesses.find((business) => business.id === businessId);
    const result: Row[] = [];

    for (const reminder of reminders) {
      if (reminder.negocioId !== businessId || !["cita", "regreso", "cumpleanos"].includes(reminder.tipo)) continue;
      const scheduledAt = appointmentMillis(reminder.fechaProgramada);
      if (scheduledAt === null || scheduledAt > nowMillis) continue;
      const client = clientsById.get(reminder.clienteId);
      if (!client || client.aceptaRecordatoriosWhatsApp === false) continue;
      const type = reminder.tipo;
      const scheduledDate = new Date(scheduledAt);
      const serviceName = String(reminder.servicioNombre ?? "");
      const values: Record<string, unknown> = {
        "Nombre del cliente": String(client.name ?? client.displayName ?? client.nombre ?? reminder.clienteNombre ?? "Hola"),
        "Fecha de la cita": String(reminder.citaFecha ?? ""),
        "Hora de la cita": String(reminder.citaHoraInicio ?? ""),
        "Nombre del servicio": serviceName,
        "Días para volver": Number(reminder.anticipacionRecordatorioDias ?? 3),
        "Nombre del negocio": activeBusiness?.nombre ?? "EUFORIA Beauty Studio",
      };
      result.push({
        key: reminder.id,
        type,
        client,
        reminder,
        when: formatReminderTime(reminder, type, scheduledDate),
        serviceName,
        message: renderReminderTemplate(templates[type], type, values),
      });
    }
    return result.sort((left, right) => {
      const a = appointmentMillis(left.reminder.fechaProgramada) ?? 0;
      const b = appointmentMillis(right.reminder.fechaProgramada) ?? 0;
      return a - b;
    });
  }, [reminders, clients, businessId, businesses, templates, nowMillis]);

  const visibleRows = rows.filter((row) => {
    const text = `${row.client.name ?? row.client.displayName ?? row.client.nombre ?? ""} ${row.client.phone ?? row.client.telefono ?? ""}`.toLowerCase();
    const matchesSearch = !search.trim() || text.includes(search.trim().toLowerCase());
    const matchesType = typeFilter === "todos" || row.type === typeFilter;
    const matchesState = stateFilter === "todos" || row.reminder.estado === stateFilter;
    return matchesSearch && matchesType && matchesState;
  });

  const openWhatsApp = async (row: Row) => {
    const phone = String(row.client.phone ?? row.client.telefono ?? row.reminder.clienteTelefono ?? "");
    const baseUrl = getWhatsAppUrl(phone);
    if (row.reminder.estado !== "pendiente" && row.reminder.estado !== "preparado") {
      setStatusMessage("Este aviso ya no está disponible para abrir. Actualiza la lista antes de continuar.");
      return;
    }
    if (row.client.aceptaRecordatoriosWhatsApp === false) {
      setStatusMessage("Esta persona pausó los recordatorios por WhatsApp.");
      return;
    }
    if (!normalizeWhatsAppNumber(phone)) {
      setStatusMessage("Este perfil no tiene un número válido para WhatsApp.");
      return;
    }
    if (!isSafeReminderMessage(row.message)) {
      setStatusMessage("Revisa el texto y los datos disponibles antes de continuar.");
      return;
    }
    if (!baseUrl) {
      setStatusMessage("Este perfil no tiene un número válido para WhatsApp.");
      return;
    }
    try {
      await updateWhatsAppReminder(row.reminder.id, "preparado");
    } catch (reason) {
      console.warn("No se pudo preparar el aviso antes de abrir WhatsApp.", reason);
      setStatusMessage("Este aviso cambió o ya no está disponible. Actualiza la lista antes de continuar.");
      return;
    }
    try {
      await Linking.openURL(`${baseUrl}?text=${encodeURIComponent(row.message)}`);
      setStatusMessage("Se abrió WhatsApp con el mensaje listo. Confirma aquí solo cuando lo hayas enviado.");
    } catch (reason) {
      console.warn("No se pudo abrir WhatsApp.", reason);
      setStatusMessage("No pudimos abrir WhatsApp. El aviso sigue preparado para que puedas intentarlo de nuevo.");
    }
  };

  const setReminderStatus = async (row: Row, nextStatus: ReminderStatus) => {
    try {
      await updateWhatsAppReminder(row.reminder.id, nextStatus);
      setStatusMessage(nextStatus === "enviado" ? "El envío quedó confirmado por administración." : "El estado del aviso quedó actualizado.");
    } catch (reason) {
      console.warn("No se pudo actualizar el estado del aviso.", reason);
      setStatusMessage("No pudimos actualizar el aviso. Intenta de nuevo.");
    }
  };

  const saveSettings = async () => {
    if (!configurationReady) {
      setStatusMessage("Espera a que se carguen los ajustes actuales antes de guardar.");
      return;
    }
    if (!businessId || !Number.isInteger(leadHours) || leadHours < 1 || leadHours > 720) {
      setStatusMessage("El plazo debe ser un número entero entre 1 y 720 horas.");
      return;
    }
    const invalidTemplate = (Object.keys(templates) as ReminderType[]).some((type) => !isValidTemplate(templates[type], type));
    if (invalidTemplate) {
      setStatusMessage("Asegúrate de que cada mensaje tenga texto y solo incluya los datos disponibles.");
      return;
    }
    setSaving(true);
    try {
      await saveReminderConfiguration(businessId, leadHours, templates);
      setStatusMessage("Los plazos y mensajes quedaron guardados.");
    } catch (reason) {
      console.warn("No se pudieron guardar los ajustes de avisos.", reason);
      setStatusMessage("No pudimos guardar los ajustes. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const nameOf = (client: CustomerProfile) => String(client.name ?? client.displayName ?? client.nombre ?? "Cliente");
  const renderPanel = (heading: string, type: ReminderType) => {
    const sectionRows = visibleRows.filter((row) => row.type === type);
    return (
      <View key={type}>
        <Text style={[styles.sectionTitle, isDark && styles.lightText]}>{heading}</Text>
        {sectionRows.length === 0
          ? <Text style={[styles.empty, isDark && styles.mutedOnDark]}>No hay avisos para mostrar.</Text>
          : sectionRows.map((row) => {
            const phone = String(row.client.phone ?? row.client.telefono ?? row.reminder.clienteTelefono ?? "");
            const status = row.reminder.estado;
            const canConfirmSent = status === "preparado";
            const canOmit = status === "pendiente" || status === "preparado";
            const canOpen = canOmit && Boolean(normalizeWhatsAppNumber(phone));
            return (
              <View key={row.key} style={styles.row}>
                <Text style={styles.rowTitle}>{nameOf(row.client)}</Text>
                <Text style={styles.rowInfo}>{phone || "Sin teléfono"} · {row.when}{row.serviceName ? ` · ${row.serviceName}` : ""}</Text>
                <Text style={styles.status}>Estado: {STATE_LABELS[status]}</Text>
                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" onPress={() => setSelected(row)} style={styles.secondary}>
                    <Text style={styles.secondaryText}>Vista previa</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={!canOpen} onPress={() => void openWhatsApp(row)} style={[styles.action, !canOpen && styles.disabled]}>
                    <Text style={styles.actionText}>Abrir WhatsApp</Text>
                  </Pressable>
                </View>
                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" disabled={!canConfirmSent} onPress={() => void setReminderStatus(row, "enviado")} style={[styles.secondary, !canConfirmSent && styles.disabled]}>
                    <Text style={styles.secondaryText}>Confirmar envío</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={!canOmit} onPress={() => void setReminderStatus(row, "omitido")} style={[styles.secondary, !canOmit && styles.disabled]}>
                    <Text style={styles.secondaryText}>Omitir</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
      </View>
    );
  };

  return (
    <AuthGate allowedRoles={["admin", "administrador"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppHeader name={String(profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.heading}>
            <Text style={[styles.eyebrow, isDark && styles.lightText]}>COMUNICACIÓN CON CLIENTES</Text>
            <Text style={[styles.title, isDark && styles.lightText]}>Avisar por WhatsApp</Text>
            <Text style={[styles.subtitle, isDark && styles.mutedOnDark]}>Prepara y gestiona manualmente los avisos. EUFORIA no envía mensajes automáticamente.</Text>
          </View>

          {businesses.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.businessList}>
              {businesses.map((business) => (
                <Pressable key={business.id} onPress={() => setBusinessId(business.id)} style={[styles.chip, businessId === business.id && styles.chipActive]}>
                  <Text style={[styles.chipText, businessId === business.id && styles.chipTextActive]}>{business.nombre}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={styles.filters}>
            <View style={styles.search}>
              <Search size={17} color={BRAND.muted} />
              <TextInput value={search} onChangeText={setSearch} placeholder="Buscar nombre o teléfono" placeholderTextColor={BRAND.muted} style={styles.searchInput} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {REMINDER_TYPES.map((value) => (
                <Pressable key={value} onPress={() => setTypeFilter(value)} style={[styles.chip, typeFilter === value && styles.chipActive]}>
                  <Text style={[styles.chipText, typeFilter === value && styles.chipTextActive]}>{TYPE_LABELS[value]}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {REMINDER_STATES.map((value) => (
                <Pressable key={value} onPress={() => setStateFilter(value)} style={[styles.chip, stateFilter === value && styles.chipActive]}>
                  <Text style={[styles.chipText, stateFilter === value && styles.chipTextActive]}>{value === "todos" ? "Todos los estados" : STATE_LABELS[value]}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {statusMessage ? <Text accessibilityRole="alert" style={[styles.message, isDark && styles.lightText]}>{statusMessage}</Text> : null}
          {businesses.length === 0
            ? <Text style={[styles.empty, isDark && styles.mutedOnDark]}>Estamos preparando los avisos para este negocio.</Text>
            : <>
              {renderPanel("Citas próximas", "cita")}
              {renderPanel("Recordatorios para regresar", "regreso")}
              {renderPanel("Cumpleaños de hoy", "cumpleanos")}
            </>}

          <View style={styles.card}>
            <View style={styles.icon}><MessageCircle size={22} color={BRAND.whatsapp} /></View>
            <Text style={styles.cardTitle}>Ajustes y mensajes</Text>
            <Text style={styles.cardText}>El aviso de una cita se prepara, por defecto, 73 horas antes de la hora confirmada. Puedes cambiar este plazo.</Text>
            <Text style={styles.inputLabel}>Horas antes de la cita</Text>
            <TextInput accessibilityLabel="Horas de anticipación del aviso de cita" keyboardType="number-pad" value={String(leadHours)} onChangeText={(value) => setLeadHours(Number(value.replace(/\D/g, "")))} style={styles.editorInput} />
            {(Object.keys(templates) as ReminderType[]).map((type) => (
              <View key={type}>
                <Text style={styles.inputLabel}>{TEMPLATE_LABELS[type]}</Text>
                <TextInput accessibilityLabel={TEMPLATE_LABELS[type]} multiline value={templates[type]} onChangeText={(value) => setTemplates((current) => ({ ...current, [type]: value }))} style={[styles.editorInput, styles.templateInput]} />
                <Text style={styles.cardText}>Toca un dato para agregarlo al mensaje:</Text>
                <View style={styles.templateTokens}>
                  {Array.from(TEMPLATE_VARIABLES[type]).map((variable) => (
                    <Pressable
                      key={variable}
                      accessibilityRole="button"
                      accessibilityLabel={`Agregar ${variable}`}
                      onPress={() => setTemplates((current) => {
                        const currentText = current[type].trimEnd();
                        return { ...current, [type]: `${currentText}${currentText ? " " : ""}{{${variable}}}` };
                      })}
                      style={styles.templateToken}
                    >
                      <Text style={styles.templateTokenText}>{variable}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            {failedConfigurationFor === businessId && businessId ? <Pressable accessibilityRole="button" onPress={() => { setFailedConfigurationFor(""); setConfigurationRetry((value) => value + 1); }} style={styles.secondary}><Text style={styles.secondaryText}>Volver a cargar</Text></Pressable> : null}
            <Pressable accessibilityRole="button" disabled={saving || !configurationReady} onPress={() => void saveSettings()} style={[styles.action, (saving || !configurationReady) && styles.disabled]}>
              <Text style={styles.actionText}>{configurationLoading ? "Cargando ajustes…" : saving ? "Guardando…" : "Guardar ajustes"}</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Contacta a tus clientes</Text>
            <Text style={styles.cardText}>WhatsApp se abre con un mensaje listo. Confirma el envío solo después de enviarlo desde tu teléfono.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/clients" as never)} style={styles.secondary}>
              <Text style={styles.secondaryText}>Ver perfiles de clientes</Text>
            </Pressable>
          </View>
          {user?.uid && <NotificationSetupCard uid={user.uid} />}
          <View style={styles.note}>
            <ShieldCheck size={17} color={BRAND.success} />
            <Text style={styles.noteText}>No se envían mensajes en segundo plano ni desde la vista previa.</Text>
          </View>
        </ScrollView>

        {selected && (
          <View style={styles.previewOverlay}>
            <View style={styles.previewCard}>
              <Pressable accessibilityRole="button" onPress={() => setSelected(null)}>
                <Text style={styles.close}>Cerrar</Text>
              </Pressable>
              <WhatsAppPreview name={nameOf(selected.client)} message={selected.message} />
            </View>
          </View>
        )}
      </ScreenContainer>
    </AuthGate>
  );
}

export default function NotifyScreen() {
  return <NotifyContent />;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  heading: { paddingHorizontal: 20, marginTop: 10 },
  eyebrow: { color: BRAND.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  title: { color: BRAND.wine, fontSize: 28, fontWeight: "800", marginTop: 4 },
  subtitle: { color: BRAND.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  businessList: { paddingHorizontal: 20, paddingTop: 12 },
  filters: { marginHorizontal: 20, marginTop: 14, gap: 8 },
  search: { height: 42, backgroundColor: BRAND.surface, borderRadius: 14, borderWidth: 1, borderColor: BRAND.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, color: BRAND.wine, fontSize: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, marginRight: 6 },
  chipActive: { backgroundColor: BRAND.primary, borderColor: BRAND.primary },
  chipText: { color: BRAND.wine, fontWeight: "700", fontSize: 10 },
  chipTextActive: { color: "#FFFFFF" },
  sectionTitle: { color: BRAND.wine, fontSize: 16, fontWeight: "800", marginHorizontal: 20, marginTop: 18, marginBottom: 7 },
  row: { backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, borderRadius: 18, marginHorizontal: 20, marginTop: 7, padding: 13 },
  rowTitle: { color: BRAND.wine, fontWeight: "800", fontSize: 14 },
  rowInfo: { color: BRAND.muted, fontSize: 11, marginTop: 4 },
  status: { color: BRAND.primaryDark, fontSize: 11, fontWeight: "700", marginTop: 6 },
  actions: { flexDirection: "row", gap: 7, marginTop: 9, flexWrap: "wrap" },
  action: { backgroundColor: BRAND.whatsapp, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999 },
  actionText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  secondary: { backgroundColor: BRAND.softPink, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999 },
  secondaryText: { color: BRAND.wine, fontSize: 10, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  empty: { marginHorizontal: 20, color: BRAND.muted, fontSize: 11, paddingVertical: 8 },
  card: { backgroundColor: BRAND.surface, borderRadius: 20, padding: 16, marginHorizontal: 20, marginTop: 16, borderWidth: 1, borderColor: BRAND.border },
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: BRAND.wine, fontSize: 14, fontWeight: "800", marginTop: 9 },
  cardText: { color: BRAND.muted, fontSize: 11, lineHeight: 17, marginTop: 4 },
  inputLabel: { color: BRAND.wine, fontSize: 11, fontWeight: "800", marginTop: 12, marginBottom: 5 },
  editorInput: { minHeight: 42, borderWidth: 1, borderColor: BRAND.border, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, color: BRAND.wine, fontSize: 12, backgroundColor: BRAND.background },
  templateInput: { minHeight: 100, textAlignVertical: "top" },
  templateTokens: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  templateToken: { backgroundColor: BRAND.softPink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  templateTokenText: { color: BRAND.wine, fontSize: 10, fontWeight: "700" },
  note: { flexDirection: "row", gap: 8, marginHorizontal: 20, marginTop: 14, padding: 12, backgroundColor: "#EAF6EF", borderRadius: 14 },
  noteText: { color: BRAND.wine, fontSize: 11, flex: 1, lineHeight: 16 },
  message: { color: BRAND.primaryDark, fontSize: 11, marginHorizontal: 20, marginTop: 10 },
  lightText: { color: BRAND.onDarkText },
  mutedOnDark: { color: BRAND.onDarkMutedText },
  previewOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,.58)", justifyContent: "center", padding: 16 },
  previewCard: { backgroundColor: BRAND.surface, borderRadius: 20, padding: 14 },
  close: { textAlign: "right", color: BRAND.primaryDark, fontWeight: "800", padding: 6 },
});
