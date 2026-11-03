import type { PropsWithChildren } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { BRAND } from "@/constants/brand";
import { useAuthSession } from "@/lib/auth-session";
import { hasProfileRole } from "@/lib/roles";

type AllowedRole = "cliente" | "empleado" | "administrador" | "admin";

export function AuthGate({ allowedRoles, children }: PropsWithChildren<{ allowedRoles: AllowedRole[] }>) {
  const { user, profile, loading } = useAuthSession();
  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={BRAND.primary} /><Text style={styles.text}>Verificando acceso…</Text></View>;
  }
  if (!user || !profile) return <Redirect href="/auth" />;
  if (!hasProfileRole(profile, allowedRoles)) return <Redirect href="/" />;
  return <>{children}</>;
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: BRAND.background }, text: { color: BRAND.wine, fontSize: 14, fontWeight: "700" } });
