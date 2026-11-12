export function isCompletedAppointmentStatus(status: unknown): boolean {
  return status === "finalizada" || status === "completada";
}
