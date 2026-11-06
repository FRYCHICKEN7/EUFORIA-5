import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import * as Network from "expo-network";
import { BRAND } from "@/constants/brand";

export function ServerConnectionStatus() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    let checking = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const checkConnection = async () => {
      if (checking) return;
      checking = true;
      try {
        const network = await Network.getNetworkStateAsync();
        if (!network.isConnected || network.isInternetReachable === false) {
          if (active) setConnected(false);
          return;
        }

        const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
        if (!baseUrl) {
          if (active) setConnected(false);
          return;
        }

        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${baseUrl}/api/health`, { method: "GET", signal: controller.signal });
        const payload = response.ok ? await response.json() as { ok?: boolean } : null;
        if (active) setConnected(payload?.ok === true);
      } catch (error) {
        console.warn("No se pudo comprobar la conexión con el servidor.", error);
        if (active) setConnected(false);
      } finally {
        if (timeout) clearTimeout(timeout);
        checking = false;
      }
    };

    void checkConnection();
    const interval = setInterval(() => { void checkConnection(); }, 15_000);
    const networkSubscription = Network.addNetworkStateListener((state) => {
      if (!state.isConnected || state.isInternetReachable === false) {
        setConnected(false);
      } else {
        void checkConnection();
      }
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkConnection();
    });

    return () => {
      active = false;
      clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      networkSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  return <View accessibilityRole="text" style={styles.row}>
    <View style={[styles.light, connected ? styles.lightOn : styles.lightOff]} />
    <Text style={styles.label}>{connected ? "Conectado con servidor" : "Sin conexión con servidor"}</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 9, marginHorizontal: 20, minHeight: 48, paddingHorizontal: 15, backgroundColor: BRAND.surface, borderRadius: 16, borderWidth: 1, borderColor: BRAND.border },
  light: { width: 10, height: 10, borderRadius: 5 },
  lightOn: { backgroundColor: "#2E9B68" },
  lightOff: { backgroundColor: "#C7495C" },
  label: { color: BRAND.wine, fontSize: 13, fontWeight: "700" },
});
