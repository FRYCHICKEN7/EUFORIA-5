import { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, Text } from "react-native";
import { BRAND } from "@/constants/brand";

export function PillButton({ label, onPress, icon: Icon, variant = "primary", compact = false }: { label: string; onPress?: () => void; icon?: LucideIcon; variant?: "primary" | "soft" | "outline"; compact?: boolean }) {
  const scheme = { primary: { backgroundColor: BRAND.primary, borderColor: BRAND.primary, color: "#FFFFFF" }, soft: { backgroundColor: BRAND.softPink, borderColor: BRAND.softPink, color: BRAND.primaryDark }, outline: { backgroundColor: "transparent", borderColor: BRAND.border, color: BRAND.wine } }[variant];
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.base, { backgroundColor: scheme.backgroundColor, borderColor: scheme.borderColor, paddingVertical: compact ? 9 : 13 }, pressed && styles.pressed]}><>{Icon ? <Icon size={16} color={scheme.color} /> : null}</><Text style={[styles.label, { color: scheme.color }]}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({ base: { minHeight: 42, borderRadius: 999, borderWidth: 1, paddingHorizontal: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, label: { fontSize: 13, fontWeight: "800" }, pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] } });
