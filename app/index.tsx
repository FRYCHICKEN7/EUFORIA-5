import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { BRAND } from "@/constants/brand";
import { useAuthSession } from "@/lib/auth-session";
import { profileRole } from "@/lib/roles";

export default function EntryScreen() {
  const { user, profile, loading } = useAuthSession();
  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={BRAND.primary} /><Text style={styles.text}>Conectando con EUFORIA…</Text></View>;
  }
  if (!user) return <Redirect href="/auth" />;
  if (!profile) return <Redirect href="/auth" />;
  const role = profileRole(profile);
  if (role === "admin") return <Redirect href="/(tabs)" />;
  if (role === "empleado") return <Redirect href="/employee/schedule" />;
  if (role === "cliente") return <Redirect href="/client/catalog" />;
  return <Redirect href="/auth" />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: BRAND.background },
  text: { color: BRAND.wine, fontSize: 14, fontWeight: "700" },
});
