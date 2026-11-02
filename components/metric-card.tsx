import { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { BRAND } from "@/constants/brand";

export function MetricCard({ label, value, detail, icon: Icon, tone = "pink" }: { label: string; value: string; detail: string; icon: LucideIcon; tone?: "pink" | "green" | "gold" | "wine" }) {
  const colors = { pink: { bg: BRAND.softPink, icon: BRAND.primary }, green: { bg: "#E8F5EE", icon: BRAND.success }, gold: { bg: "#FBF2E5", icon: BRAND.gold }, wine: { bg: "#F4E9ED", icon: BRAND.wine } }[tone];
  return <View style={styles.card}><View style={[styles.icon, { backgroundColor: colors.bg }]}><Icon size={19} color={colors.icon} /></View><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text><Text style={styles.detail}>{detail}</Text></View>;
}
const styles = StyleSheet.create({ card: { flex: 1, minHeight: 142, backgroundColor: BRAND.surface, borderRadius: 22, padding: 14, shadowColor: BRAND.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 }, icon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 13 }, label: { color: BRAND.muted, fontSize: 12, fontWeight: "600" }, value: { color: BRAND.wine, fontSize: 20, fontWeight: "800", marginTop: 3 }, detail: { color: BRAND.muted, fontSize: 11, marginTop: 5 } });
