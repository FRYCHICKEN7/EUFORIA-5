# Plan de implementación: EUFORIA Beauty Studio

## Alcance acordado

Continuar el starter móvil Expo Router/React Native/TypeScript existente; preservar identidad visual, autenticación, runtime y datos actuales. Clientes reservan servicios reales con duración; la disponibilidad se calcula en servidor en `America/Tegucigalpa`, descontando horarios y citas. Empleados autorizados configuran turnos, deciden citas, registran inicio/final de servicio; administración observa citas, clientes y métricas.

El alta pública de clientes conserva teléfono hondureño/internacional obligatorio, cumpleaños opcional de día/mes, perfil doble `users/{uid}` y `usuarios/{uid}`, y no solicita ni guarda identidad. En el flujo oculto de personal, un aspirante puede crear su cuenta y una solicitud. La cuenta permanece con rol cliente mientras está pendiente o rechazada. Únicamente una decisión administrativa protegida puede convertirla en empleado.

Administración conserva acceso a perfiles reales y a la agenda. Al reservar, el cliente, el empleado asignado y administración reciben avisos dentro de la app; se conserva el envío Expo Push existente para dispositivos configurados. No desplegar Rules, índices ni Functions a Firebase real durante esta tarea, no escribir datos de prueba en producción y no afirmar entrega push si no se comprobó en dispositivo.

La pantalla existente Avisar se amplía para preparar recordatorios manuales por WhatsApp de citas, regresos y cumpleaños. Los recordatorios de cita quedan habilitados por defecto y su aviso se programa **73 horas antes**, ajustable por administración. Los tres textos se editan desde secciones de administración y se guardan en configuración del negocio existente. Ninguna función abre o envía WhatsApp automáticamente. Si un cliente desactiva recordatorios, no se le prepara un aviso.

La copia de seguridad de negocio se exporta a un archivo JSON guardado localmente en el teléfono del administrador: selección de carpeta/guardado nativo en Android y diálogo del sistema para Guardar en Archivos en iOS. No se sube el respaldo a servidores externos ni se incluyen secretos, contraseñas o tokens de dispositivo.

## Arquitectura y responsabilidades

- `app/auth.tsx`, `app/index.tsx`, `lib/auth-session.tsx`: inicio cliente inicial; engranaje para acceso y registro de personal; mantener validación efectiva por rol, biometría y sesión existente.
- `lib/profiles.ts`, `lib/roles.ts`: conservar lectura de `users`, `usuarios`, `empleados`; perfil cliente con teléfono, cumpleaños y `aceptaRecordatoriosWhatsApp`; listeners de solicitudes pendientes y callables para solicitar/aceptar/rechazar.
- `functions/src/index.ts`, `functions/src/roles.ts`: crear solicitudes como cliente pendiente; aceptar/rechazar solo con rol admin verificado; asociar al único negocio activo, crear el inicial si no hay ninguno y bloquear una asignación ambigua si hay varios; sincronizar roles/membresía solo al aceptar.
- `app/(tabs)/clients.tsx`: lista de clientes y empleados activos; reemplazar «Crear perfil de empleado» por solicitudes con botones **Aceptar** y **Rechazar**. No permitir altas manuales de empleados.
- `app/client/catalog.tsx`: conservar catálogo y agenda; permitir que el cliente cambie la preferencia de recordatorios WhatsApp sin alterar teléfono o roles.
- `app/(tabs)/notify.tsx`, `lib/whatsapp.ts`, nuevo módulo `lib/whatsapp-reminders.ts`, `components/whatsapp-preview.tsx`: tres listas —citas, regresos y cumpleaños—, búsqueda/filtros, registro real seleccionado, sustitución/validación de variables, abrir vínculo prellenado, marcar preparado, confirmar enviado manualmente y omitir/cancelar. Cualquier apertura solo cambia a `preparado`; solo la acción explícita del administrador guarda `enviado`.
- `app/admin/services.tsx`, `lib/appointments.ts`: campos por servicio para activar regreso, periodo de regreso en días y anticipación del aviso; servicio sin periodo no produce recordatorio.
- `functions/src/index.ts`: tareas idempotentes que únicamente preparan documentos en `recordatoriosWhatsApp`; citas confirmadas a 73 h (configurable en `negocios/{negocioId}`), regreso calculado desde `completedAt`, y cumpleaños con `birthdayDay`/`birthdayMonth` y año local de Honduras. Recalcular o cancelar al cambiar el estado/fecha de cita, no duplicar, omitir avisos de personas excluidas y no contactar con teléfono inválido. Conservar destinatarios de reserva empleado/admin y `enviarPushExpo`.
- `app/(tabs)/settings.tsx`, nuevo módulo de respaldo local: acción solo administrativa, JSON con perfiles de negocio, servicios, horarios, equipo, clientes, citas y registro de recordatorios; excluir documentos de dispositivos/tokens y cualquier secreto. Usar selector SAF del teléfono Android y hoja de compartir/archivos de iOS.
- `firestore.rules`: perfil solo puede cambiar su preferencia booleana; empleado pendiente nunca equivale a `empleado`; solo admin lee y modifica historial de recordatorios, y toda transición se valida desde Functions. Mantener denegación por defecto y reglas seguras existentes.
- `firestore.indexes.json`: añadir solo los índices requeridos por consultas implementadas; mantener los índices actuales de citas, personal y notificaciones.
- `README.md`/`TODO.md`: explicar el esquema real, la configuración de textos y 73 horas, respaldo local, prueba real versus simulada y comandos manuales de despliegue.

## Esquema y reglas operativas

1. Cuentas cliente se registran en Auth y guardan `users/{uid}` y `usuarios/{uid}` con `role/rol: "cliente"`. Teléfono obligatorio; cumpleaños opcional como `birthdayDay`/`birthdayMonth`; el valor efectivo inicial de `aceptaRecordatoriosWhatsApp` es `true` (documentos históricos sin el campo también se consideran habilitados), y el cliente puede desactivarlo. No hay campo de identidad. Roles legacy `customer/client` siguen reconociéndose.
2. Solicitar ser empleado escribe, mediante callable autenticada, `empleados/{uid}` con estado `pendiente`, solicitante y marcas de tiempo, pero no eleva los roles ni crea una membresía operativa. Una solicitud duplicada no crea otro registro. Si Authentication ya creó la cuenta y luego falló el envío, el registro como empleado acepta el mismo correo solo tras verificar la contraseña, reutiliza el perfil cliente existente y reintenta la solicitud sin sobrescribir datos; iniciar sesión como empleado también reintenta si falta la solicitud. Rechazar conserva el perfil con rol cliente y estado `rechazada`. Aceptar requiere rol admin, solicitud vigente y exactamente un negocio activo; si no hay ninguno se crea «EUFORIA Beauty Studio» activo; si hay varios la decisión se bloquea con explicación para no elegir al azar. Solo la aceptación sincroniza `users`, `usuarios`, `empleados/{uid}` y `negocios/{negocioId}/empleados/{uid}`, con disponibilidad apagada.
3. Administrador ya no da de alta empleados ni elige su código; el acceso al antiguo callable de creación se desactiva o se convierte en ruta de compatibilidad que no pueda saltarse la aprobación.
4. Servicio conserva `nombre`, precio, `duracionMin` entero (5–480) y `activo`; añade `recordatorioRegresoActivo`, `periodoRegresoDias` y `anticipacionRecordatorioDias`, validados y editables por administrador. Solo los regresos habilitados con periodo positivo producen un aviso, desde fecha real `completedAt`.
5. Configuración en el documento del negocio guarda `horasAntesCita: 73` como valor inicial y plantillas editables `cita`, `regreso`, `cumpleanos`. Administración cambia horario y textos. Variables permitidas: cita (`cliente.nombre`, `cita.fecha`, `cita.horaInicio`, `cita.servicioNombre`, `negocio.nombre`); regreso (`cliente.nombre`, `servicio.nombre`, `configuracion.anticipacionRecordatorioDias`, `negocio.nombre`); cumpleaños (`cliente.nombre`, `negocio.nombre`). No se abre WhatsApp si quedan llaves `{{...}}`, `undefined`, `null` o teléfono inválido.
6. `recordatoriosWhatsApp/{id}` es el único historial, con tipo, `clienteId`, `negocioId`, `citaId`/`servicioId` si aplican, `fechaProgramada`, estado `pendiente/preparado/enviado/omitido/cancelado`, `preparadoAt`, `enviadoAt`, `preparadoPorUid`, `enviadoPorUid`, `idempotencyKey` y año de cumpleaños cuando aplica. Duplicados no se crean; ya enviados no se reabren por una ejecución repetida. Cancelación/reprogramación y nueva reserva del mismo servicio cancelan recordatorios obsoletos.
7. Los recordatorios se preparan para administración, nunca envían mensajes. Abrir el vínculo WhatsApp puede marcar `preparado`, no `enviado`; solo administración puede marcar enviado/omitido/cancelado. Cada cambio pasa por callable verificada. El cliente no accede al historial administrativo.
8. Al reservar, Functions guardan avisos en Firestore para cliente, empleado asignado y cada administrador válido; el trigger Expo Push sigue usando tokens habilitados. La entrega remota depende de que el proyecto nativo/EAS y credenciales se configuren y desplieguen manualmente.
9. El respaldo local incluye datos reales exportables para administración y excluye `dispositivos`, tokens Expo, secretos y contraseñas. Cancelar el selector o no conceder acceso no crea un archivo parcial que se presente como guardado.

## Diseño

- **Movimiento:** boutique de belleza premium con composición editorial, fondo blanco cálido, rosa rubor, vino profundo y acento dorado discreto.
- **Principios:** lectura rápida, superficies limpias, controles amplios de uso con una mano, datos reales y estados operativos explícitos.
- **Color:** fondo `#FFF5F7`, superficies `#FFFFFF`, acción `#D85C7A`, vino `#5C1A2E`, rosa suave `#FCE8EE` y verde de acento; modos claro y rosado oscuro.
- **Contraste oscuro:** marca y encabezados blancos sobre el fondo vino; texto secundario claro y tarjetas claras con tipografía oscura.
- **Layout y firma:** encabezado EUFORIA, tarjetas suaves, botones/píldoras accesibles, métricas y listas; estados vacíos aclaran la configuración faltante.
- **Interacción:** feedback inmediato, mensajes en español, texto editable con vista previa no emisora y decisiones privilegiadas confirmadas por servidor.
- **Tipografía/voz:** sans serif del sistema, pesos 700–800, tono cálido, premium y directo.
- **Logo:** recurso existente preservado para launcher/splash y metadata con área segura.

## Entorno y límites de entrega

Mantener Expo/Metro en 8081 y API del starter en 3000; no reemplazar el starter. Validar TypeScript, lint, pruebas unitarias, build local de Functions, sintaxis Rules con emulador y exportaciones compatibles del starter. No hacer build EAS ni afirmar que existe APK. La base administrada y Firebase producción son compartidos: no hacer escrituras de prueba. Revisar UI, Rules, Functions e instrucciones de despliegue antes del checkpoint. Guardar `main` del remoto canónico; no desplegar Firebase ni publicar esta app automáticamente.
