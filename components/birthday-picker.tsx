import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CalendarDays, Check } from "lucide-react-native";
import { BRAND } from "@/constants/brand";
import { CUSTOMER_BIRTHDAY_MONTHS, formatCustomerBirthday, isValidCustomerBirthday } from "@/lib/customer-fields";

type Props = {
  day: number | null;
  month: number | null;
  onChange: (day: number | null, month: number | null) => void;
};

export function BirthdayPicker({ day, month, onChange }: Props) {
  const [visible, setVisible] = useState(false);
  const [draftDay, setDraftDay] = useState<number | null>(day);
  const [draftMonth, setDraftMonth] = useState<number | null>(month);
  const daysInMonth = draftMonth ? new Date(2000, draftMonth, 0).getDate() : 31;
  const label = day && month ? formatCustomerBirthday(day, month) : null;

  const open = () => {
    setDraftDay(day);
    setDraftMonth(month);
    setVisible(true);
  };
  const save = () => {
    if (!draftDay || !draftMonth || !isValidCustomerBirthday(draftDay, draftMonth)) return;
    onChange(draftDay, draftMonth);
    setVisible(false);
  };

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={label ? `Cumpleaños: ${label}` : "Añadir cumpleaños opcional"} onPress={open} style={styles.trigger}>
      <CalendarDays size={18} color={BRAND.muted} />
      <Text style={[styles.triggerText, !label && styles.placeholder]}>{label ? `Cumpleaños: ${label}` : "Cumpleaños (opcional)"}</Text>
    </Pressable>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
      <View style={styles.shade}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Cumpleaños</Text>
          <Text style={styles.subtitle}>Elige el mes y el día. No hace falta indicar el año.</Text>
          <Text style={styles.section}>Mes</Text>
          <View style={styles.months}>{CUSTOMER_BIRTHDAY_MONTHS.map((name, index) => {
            const value = index + 1;
            const selected = draftMonth === value;
            return <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { setDraftMonth(value); if (draftDay && !isValidCustomerBirthday(draftDay, value)) setDraftDay(null); }} style={[styles.month, selected && styles.selected]}><Text style={[styles.monthText, selected && styles.selectedText]}>{name}</Text></Pressable>;
          })}</View>
          <Text style={styles.section}>Día</Text>
          <ScrollView style={styles.dayScroll} contentContainerStyle={styles.days}>
            {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((value) => {
              const selected = draftDay === value;
              return <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setDraftDay(value)} style={[styles.day, selected && styles.selected]}><Text style={[styles.dayText, selected && styles.selectedText]}>{value}</Text></Pressable>;
            })}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={() => { onChange(null, null); setVisible(false); }} style={styles.clear}><Text style={styles.clearText}>Quitar</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={!draftDay || !draftMonth} onPress={save} style={[styles.save, (!draftDay || !draftMonth) && styles.disabled]}><Check size={16} color="#FFFFFF" /><Text style={styles.saveText}>Guardar</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { width: "100%", minHeight: 54, borderWidth: 1, borderColor: BRAND.border, backgroundColor: BRAND.surface, borderRadius: 18, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 9 },
  triggerText: { flex: 1, color: BRAND.wine, fontSize: 14 },
  placeholder: { color: BRAND.muted },
  shade: { flex: 1, backgroundColor: "rgba(40,15,26,.48)", justifyContent: "flex-end" },
  sheet: { maxHeight: "88%", backgroundColor: BRAND.background, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 28 },
  title: { color: BRAND.wine, fontSize: 20, fontWeight: "800" },
  subtitle: { color: BRAND.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  section: { color: BRAND.wine, fontSize: 12, fontWeight: "800", marginTop: 17, marginBottom: 8 },
  months: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  month: { borderRadius: 999, backgroundColor: BRAND.surface, borderWidth: 1, borderColor: BRAND.border, paddingHorizontal: 11, paddingVertical: 8 },
  monthText: { color: BRAND.wine, fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  days: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8 },
  dayScroll: { maxHeight: 170 },
  day: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: BRAND.border, backgroundColor: BRAND.surface, alignItems: "center", justifyContent: "center" },
  dayText: { color: BRAND.wine, fontSize: 12, fontWeight: "700" },
  selected: { backgroundColor: BRAND.primary, borderColor: BRAND.primary },
  selectedText: { color: "#FFFFFF" },
  actions: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginTop: 17 },
  clear: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
  clearText: { color: BRAND.primaryDark, fontSize: 13, fontWeight: "800" },
  save: { flex: 1, minHeight: 46, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, borderRadius: 999, backgroundColor: BRAND.primary },
  saveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.55 },
});
