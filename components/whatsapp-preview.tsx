import { MessageCircle } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { BRAND } from "@/constants/brand";

export function WhatsAppPreview({ name, message }: { name: string; message: string }) {
  return <View style={styles.card}><View style={styles.header}><View style={styles.waIcon}><MessageCircle size={18} color="#FFFFFF" /></View><View><Text style={styles.title}>Vista previa de WhatsApp</Text><Text style={styles.subtitle}>Solo vista previa · no se guarda ni se envía</Text></View></View><View style={styles.bubble}><Text style={styles.message}>{message}</Text><Text style={styles.time}>Vista previa</Text></View><Text style={styles.recipient}>Para: {name}</Text></View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: "#F0FBF4", borderRadius: 22, padding: 15, borderWidth: 1, borderColor: "#CDEFD9" }, header: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 13 }, waIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND.whatsapp, alignItems: "center", justifyContent: "center" }, title: { color: BRAND.wine, fontSize: 14, fontWeight: "800" }, subtitle: { color: BRAND.muted, fontSize: 10, marginTop: 2 }, bubble: { alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderRadius: 16, borderTopLeftRadius: 4, padding: 13, maxWidth: "100%" }, message: { color: BRAND.wine, fontSize: 13, lineHeight: 19 }, time: { color: BRAND.muted, fontSize: 9, textAlign: "right", marginTop: 5 }, recipient: { color: BRAND.muted, fontSize: 10, marginTop: 9 } });
