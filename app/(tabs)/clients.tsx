import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Search, UsersRound } from "lucide-react-native";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { BRAND } from "@/constants/brand";
import { ScreenContainer } from "@/components/screen-container";
import { useAuthSession } from "@/lib/auth-session";
import { db } from "@/lib/firebase";
import { appointmentMillis } from "@/lib/appointments";
import { hasProfileRole } from "@/lib/roles";

type ClientProfile = { id: string; email?: string; displayName?: string; nombre?: string; phone?: string; telefono?: string; createdAt?: unknown };

function ClientsContent() {
  const { user, profile } = useAuthSession();
  const uid = user?.uid;
  const isAdmin = hasProfileRole(profile, ["admin"]);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const firstTick = setTimeout(() => setNow(Date.now()), 0);
    const minuteTick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearTimeout(firstTick); clearInterval(minuteTick); };
  }, []);

  useEffect(() => {
    if (!isAdmin || !uid) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (!active) return;
      if (!db) { setError("Firebase no está configurado."); setLoading(false); return; }
      const clientsQuery = query(collection(db, "usuarios"), where("rol", "==", "cliente"), limit(300));
      unsubscribe = onSnapshot(clientsQuery, (snapshot) => {
        if (!active) return;
        const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as ClientProfile[];
        setClients(rows.sort((a, b) => (appointmentMillis(b.createdAt) ?? 0) - (appointmentMillis(a.createdAt) ?? 0)));
        setLoading(false);
        setError("");
      }, (reason) => {
        if (!active) return;
        setError(reason.code === "permission-denied" ? "El perfil administrador no puede listar usuarios. Revisa Firestore Rules." : reason.message);
        setLoading(false);
      });
    }, 0);
    return () => { active = false; clearTimeout(timer); unsubscribe?.(); };
  }, [isAdmin, uid]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((item) => `${item.displayName ?? ""} ${item.nombre ?? ""} ${item.email ?? ""} ${item.phone ?? ""} ${item.telefono ?? ""}`.toLowerCase().includes(term));
  }, [clients, search]);
  const newClients = clients.filter((item) => {
    const created = appointmentMillis(item.createdAt);
    return created !== null && created >= now - 30 * 24 * 60 * 60 * 1000;
  }).length;

  return (
    <AuthGate allowedRoles={["admin", "administrador"]}>
      <ScreenContainer containerClassName="bg-background" safeAreaClassName="bg-background">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader name={String(profile?.displayName ?? profile?.nombre ?? user?.email?.split("@")[0] ?? "tu cuenta")} />
          <View style={styles.titleRow}><View><Text style={styles.eyebrow}>PERFILES VINCULADOS A AUTH</Text><Text style={styles.title}>Tus clientas</Text></View></View>
          <View style={styles.metrics}><View style={styles.metric}><Text style={styles.metricLabel}>Perfiles cliente</Text><Text style={styles.metricValue}>{loading ? "…" : String(clients.length)}</Text></View><View style={styles.metric}><Text style={styles.metricLabel}>Registros · 30 días</Text><Text style={styles.metricValue}>{loading ? "…" : String(newClients)}</Text></View></View>
          <View style={styles.search}><Search size={18} color={BRAND.muted} /><TextInput value={search} onChangeText={setSearch} placeholder="Buscar por nombre, correo o teléfono" placeholderTextColor={BRAND.muted} style={styles.input} /></View>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {loading ? <View style={styles.state}><ActivityIndicator color={BRAND.primary} /><Text style={styles.hint}>Leyendo perfiles Firebase…</Text></View> : error ? null : filtered.length === 0 ? <View style={styles.empty}><UsersRound size={26} color={BRAND.primary} /><Text style={styles.emptyTitle}>{clients.length === 0 ? "Aún no hay perfiles cliente" : "No encontramos coincidencias"}</Text><Text style={styles.hint}>{clients.length === 0 ? "Al registrarse, cada cliente se agrega automáticamente con su UID de Authentication." : "Prueba otra búsqueda."}</Text></View> : filtered.map((client) => <ClientCard key={client.id} item={client} />)}
        </ScrollView>
      </ScreenContainer>
    </AuthGate>
  );
}

export default function ClientsScreen() { return <ClientsContent />; }

function ClientCard({ item }: { item: ClientProfile }) {
  const displayName = String(item.displayName ?? item.nombre ?? "Cliente EUFORIA");
  const registered = appointmentMillis(item.createdAt);
  const dateLabel = registered ? new Date(registered).toLocaleDateString("es-HN", { timeZone: "America/Tegucigalpa", day: "numeric", month: "short", year: "numeric" }) : "Fecha no disponible";
  return <View style={styles.card}><View style={styles.avatar}><Text style={styles.initial}>{displayName.charAt(0).toUpperCase()}</Text></View><View style={styles.copy}><Text numberOfLines={1} style={styles.name}>{displayName}</Text><Text numberOfLines={1} style={styles.details}>{item.email ?? "Sin correo"}</Text><Text style={styles.details}>{item.phone ?? item.telefono ?? "Teléfono no agregado"} · Registro {dateLabel}</Text></View></View>;
}

const styles = StyleSheet.create({ content: { paddingBottom: 32 }, titleRow: { paddingHorizontal: 20, marginTop: 10 }, eyebrow: { color: BRAND.primary, fontSize: 10, letterSpacing: 1.3, fontWeight: "800" }, title: { color: BRAND.wine, fontSize: 28, fontWeight: "800", marginTop: 5 }, metrics: { flexDirection: "row", gap: 10, paddingHorizontal: 20, marginTop: 17 }, metric: { flex: 1, backgroundColor: BRAND.surface, borderRadius: 18, padding: 13, borderWidth: 1, borderColor: BRAND.border }, metricLabel: { color: BRAND.muted, fontSize: 11, fontWeight: "700" }, metricValue: { color: BRAND.wine, fontSize: 22, fontWeight: "800", marginTop: 3 }, search: { flexDirection: "row", alignItems: "center", gap: 9, height: 50, backgroundColor: BRAND.surface, borderRadius: 18, marginHorizontal: 20, marginTop: 17, paddingHorizontal: 15, borderWidth: 1, borderColor: BRAND.border }, input: { flex: 1, color: BRAND.wine, fontSize: 14 }, error: { color: BRAND.error, fontSize: 12, lineHeight: 18, margin: 20 }, state: { alignItems: "center", gap: 9, padding: 28 }, hint: { color: BRAND.muted, fontSize: 12, lineHeight: 18, textAlign: "center" }, empty: { alignItems: "center", backgroundColor: BRAND.surface, borderRadius: 24, padding: 26, marginHorizontal: 20, marginTop: 10, borderWidth: 1, borderColor: BRAND.border }, emptyTitle: { color: BRAND.wine, fontSize: 15, fontWeight: "800", marginTop: 9, textAlign: "center" }, card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: BRAND.surface, borderRadius: 18, padding: 13, marginHorizontal: 20, marginBottom: 8, borderWidth: 1, borderColor: BRAND.border }, avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: BRAND.softPink, alignItems: "center", justifyContent: "center" }, initial: { color: BRAND.primaryDark, fontSize: 16, fontWeight: "800" }, copy: { flex: 1 }, name: { color: BRAND.wine, fontSize: 13, fontWeight: "800" }, details: { color: BRAND.muted, fontSize: 10, marginTop: 3 },
});
