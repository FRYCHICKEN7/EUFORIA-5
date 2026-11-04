import { Bell, ChevronDown } from "lucide-react-native";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { BRAND } from "@/constants/brand";
import { useThemeContext } from "@/lib/theme-provider";

export function AppHeader({ name = "tu cuenta", onNotifications }: { name?: string; onNotifications?: () => void }) {
  const { colorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";

  return (
    <View style={styles.container}>
      <View style={styles.identity}>
        <Image source={require("../assets/images/icon.png")} style={styles.logo} />
        <View>
          <Text style={[styles.brand, isDark && styles.onDarkText]}>EUFORIA</Text>
          <View style={styles.greetingRow}>
            <Text style={[styles.greeting, isDark && styles.onDarkMutedText]}>Hola, {name}</Text>
            <ChevronDown size={14} color={isDark ? BRAND.onDarkMutedText : BRAND.muted} />
          </View>
        </View>
      </View>
      <Pressable accessibilityLabel="Notificaciones" onPress={onNotifications} style={styles.bell}>
        <Bell size={21} color={BRAND.wine} strokeWidth={2} />
        <View style={styles.dot} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  identity: { flexDirection: "row", alignItems: "center", gap: 11 },
  logo: { width: 48, height: 48, borderRadius: 24, backgroundColor: BRAND.surface },
  brand: { color: BRAND.wine, fontSize: 19, fontWeight: "800", letterSpacing: 1.8 },
  onDarkText: { color: BRAND.onDarkText },
  onDarkMutedText: { color: BRAND.onDarkMutedText },
  greetingRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  greeting: { color: BRAND.muted, fontSize: 13, fontWeight: "600" },
  bell: { width: 43, height: 43, borderRadius: 22, backgroundColor: BRAND.surface, alignItems: "center", justifyContent: "center", shadowColor: BRAND.shadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: BRAND.primary, position: "absolute", right: 10, top: 9, borderWidth: 1.5, borderColor: BRAND.surface },
});
