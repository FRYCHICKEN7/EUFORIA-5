import { Pressable, StyleSheet, Text, View } from "react-native";
import { BRAND } from "@/constants/brand";
export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) { return <View style={styles.row}><Text style={styles.title}>{title}</Text>{action ? <Pressable onPress={onAction}><Text style={styles.action}>{action}</Text></Pressable> : null}</View>; }
const styles = StyleSheet.create({ row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 11, marginTop: 23 }, title: { color: BRAND.wine, fontSize: 17, fontWeight: "800" }, action: { color: BRAND.primary, fontSize: 12, fontWeight: "800" } });
