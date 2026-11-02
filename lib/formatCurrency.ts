export function formatCurrency(value: number | string | null | undefined): string {
  const numeric = typeof value === "string" ? Number(value.replace(/[^0-9.-]/g, "")) : Number(value ?? 0);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  return `L. ${safeValue.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
