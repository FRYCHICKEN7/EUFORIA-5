# Plan de implementación: EUFORIA Beauty Studio

## Alcance acordado

Continuar el starter móvil Expo Router/React Native/TypeScript existente; preservar identidad visual, Auth y runtime. El administrador puede leer perfiles reales de clientes en el esquema legacy `users/{uid}` y el esquema de app `usuarios/{uid}`, además de crear perfiles de empleado desde cuentas Auth registradas. Cada empleado configura disponibilidad semanal y una casilla independiente de habilitación para citas. El cliente ve servicios con precio/estimación, selecciona un profesional y únicamente horarios que el backend calcula como disponibles. El empleado recibe la solicitud dentro de la app, confirma/rechaza, inicia y termina servicios. Administración consulta duración real promedio y volumen por servicio/profesional.

El perfil cliente conserva `email`, `id` (UID), `name`, `phone` obligatorio, `profileImage`, `birthdayDay`/`birthdayMonth` opcionales y rol cliente; no se solicita ni se guarda número de identidad; perfiles legacy con `role: customer/client` también se reconocen. El esquema de empleado solicitado define `Empleado` (código), `email`, `id` (UID exacto Auth), `name`, `profileImage` y `role: empleado`. No insertar en producción los valores de ejemplo ni crear horarios/servicios/citas ficticias.

El registro público crea siempre un cliente; administración promueve explícitamente y solo mediante Cloud Function después de verificar la cuenta Auth real. La semana inicial sugerida para disponibilidad es 08:00–17:00, corregida por la usuaria; esos defaults no se persisten hasta guardar. Los minutos de servicio se guardan como entero (`90` = 1 h 30 min). El backend ofrece inicios cada 15 minutos en `America/Tegucigalpa`, omite horas pasadas, recesos, intervalos que no caben y solapamientos con citas activas. Todos los bookings seleccionados por profesional quedan pendientes de confirmación del empleado.

No desplegar a Firebase real, no probar haciendo escrituras en producción, no hacer build EAS ni afirmar que existe APK.

## Arquitectura y responsabilidades

- `app/auth.tsx`, `app/index.tsx`, `lib/auth-session.tsx`: sesión Firebase persistente; leer y conciliar `users/{uid}`, `usuarios/{uid}` y `empleados/{uid}`; aliases cliente/admin/empleado, denegar roles contradictorios y alta pública dual de cliente con UID Auth.
- `app/(tabs)/clients.tsx`, `lib/profiles.ts`: listeners de clientes actuales y legacy; búsqueda en español y campos vigentes; cumpleaños de día/mes; selección de una cuenta cliente existente, negocio y código de empleado; promoción por callable y listado del equipo.
- `app/employee/availability.tsx`: turnos semanales lunes–domingo con valores `HH:mm`, checkbox por día y casilla global “Disponible para citas”; escritura propia autorizada por callable.
- `app/employee/schedule.tsx`: agenda en vivo para empleado asignado y administración; avisos Firestore, confirmación/rechazo, inicio y final del trabajo.
- `app/client/catalog.tsx`: servicios reales, duración legible y consulta server-side de empleados/slots por negocio, servicio y fecha; reserva transaccional con refresh si el slot queda ocupado.
- `app/admin/services.tsx`, `app/(tabs)/index.tsx`: CRUD administrativo de servicios y resumen de citas completadas, promedio real y conteo por empleado/servicio.
- `lib/roles.ts`, `lib/appointments.ts`, `lib/profiles.ts`: normalización segura de perfiles y roles, listeners, consultas y callables.
- `lib/whatsapp.ts`, `lib/biometrics.ts`, `lib/device-notifications.ts`: normalización `wa.me`, enrolamiento/validación biométrica mediante SecureStore por UID y registro/desregistro de tokens Expo Push por dispositivo.
- `app/notifications.tsx`, `components/notification-setup-card.tsx`: campana/bandeja por rol, acciones de lectura, permiso push nativo y cierre de sesión/cambio de cuenta.
- `functions/src/roles.ts`, `functions/src/availability.ts`, `functions/src/index.ts`: reconciliación Admin SDK de perfiles/roles, cálculo de huecos por fecha, reserva y aprobación transaccionales, avisos in-app, política de disponibilidad, control de citas, tiempos reales y expiración de holds.
- `firestore.rules`: denegación por defecto, lectura admin/propietario/profesional asignado, creación propia con rol cliente, lectura propia de perfil, catálogo y disponibilidad pública solo por medios aprobados; roles, turnos y estados sensibles no se cambian directamente desde cliente.
- `firestore.indexes.json`: consultas de conflictos de cita, agendas cliente (`clienteId ASC, inicio ASC`), empleado/admin, holds que expiran, selector de profesionales disponibles y avisos por destinatario/fecha. La consulta de cliente ya tiene el índice compuesto.
- `README.md`/`TODO.md`: esquema exacto, pasos Firebase manuales, comprobaciones reales y límites.

## Esquema y reglas operativas

1. Las nuevas cuentas cliente guardan `users/{uid}` y `usuarios/{uid}` con rol `cliente`; perfiles históricos pueden vivir en cualquiera de ambas. `role` y `rol` se leen como aliases, y `customer/client` equivale a cliente. Si las fuentes tienen roles contradictorios, el acceso falla cerrado.
2. `crearPerfilEmpleado` exige un UID con cuenta habilitada y correo en Firebase Authentication, un perfil cliente, un admin, negocio activo y código único. Escribe los roles sincronizados en `users`/`usuarios`, `empleados/{uid}` y `negocios/{negocioId}/empleados/{uid}` con disponibilidad inicialmente apagada.
3. El documento profesional vinculado tiene `usuarioId` y copia el UID; dispone `disponibilidad/{0..6}` con `{dia, activo, inicio, fin}`. La casilla global `disponible` controla si se puede seleccionar. El empleado no puede editar el perfil ni calendario de otra persona.
4. Cada servicio tiene `nombre`, precio numérico, `duracionMin` (5–480) y `activo`. Ejemplo indicado: Corte de Cabello Hombre, L. 120, 90 minutos.
5. `obtenerDisponibilidad` valida negocio/horario/servicio y cruza el horario del negocio con el del profesional; el resultado no expone registros privados de citas. Devuelve únicamente inicios futuros libres de 15 minutos cuyo servicio quepa completo, sin recesos ni solapamientos con el mismo empleado.
6. `reservarCita` repite la comprobación en transacción, guarda hold de 30 minutos con datos de cliente/servicio/precio/duración/empleado y crea notificación in-app. El empleado asignado o admin decide; al aprobar pasa a `confirmada`. Cada status sensible valida rol, UID, asignación y estado vigente.
7. Solo el empleado asignado cambia `confirmada → en_curso → completada`; servidor guarda `startedAt`, `completedAt` y `duracionRealMin`. Admin resume promedios y número de trabajos por empleado/servicio.

## Diseño

- **Movimiento:** boutique de belleza premium con composición editorial, fondo blanco cálido, rosa rubor, vino profundo y acento dorado discreto.
- **Principios:** lectura rápida, superficies limpias, controles amplios de uso con una mano, datos reales y estados operativos explícitos.
- **Color:** fondo `#FFF5F7`, superficies `#FFFFFF`, acción `#D85C7A`, vino `#5C1A2E`, rosa suave `#FCE8EE` y verde de acento; modos claro y rosado oscuro.
- **Contraste oscuro:** marca y encabezados blancos sobre el fondo vino; texto secundario en tono claro y tarjetas claras con tipografía oscura.
- **Layout y firma:** encabezado EUFORIA, tarjetas suaves, botones/píldoras accesibles, métricas y listas; estados vacíos aclaran la configuración faltante.
- **Interacción:** feedback inmediato, mensajes accionables, acciones privilegiadas confirmadas por servidor, refresh al fallar un slot ocupado.
- **Tipografía/voz:** sans serif del sistema, pesos 700–800, tono cálido, premium y directo.
- **Logo:** recurso existente preservado para launcher/splash y metadata con área segura.

## Entorno y validación

Mantener Expo/Metro en 8081 y API del starter en 3000; no reemplazar el starter. Validar TypeScript, lint, pruebas unitarias de slots/roles, build de Functions, sintaxis Rules con emulador local y bundle Android Expo. La base administrada y Firebase producción son compartidos: no escribir datos al probar. Un agente revisor de solo lectura traza UI, Rules, Functions y requisitos antes del checkpoint. Guardar en `main` remoto canónico Manus; no desplegar Firebase ni publicar sin autorización.

## Ampliación acordada: acceso, contacto y notificaciones

- En el formulario inicial se muestra solo el inicio de sesión de cliente. Un icono de engranaje revela/oculta el selector de administrador y empleado, sin cambiar las comprobaciones de rol del perfil Firestore.
- Cada tarjeta de cliente ofrece abrir su chat de WhatsApp usando un vínculo `https://wa.me/504XXXXXXXX`; se normaliza el número hondureño de ocho dígitos a prefijo `504`, se preservan números internacionales y no se envían mensajes automáticamente ni se integra WhatsApp Business API.
- Todos los roles pueden consultar su bandeja personal en tiempo real y registrar el token Expo Push de su dispositivo con permiso del sistema. Functions transmite los documentos de notificación a Expo Push; la entrega fuera de la app requiere un proyecto EAS y credenciales de notificaciones Android/iOS. No desplegar reglas/Functions ni afirmar notificaciones remotas listas hasta configurar y desplegar estos recursos manualmente.
- La huella/biometría se ofrece para cada rol, opcionalmente por dispositivo. Tras autenticar el perfil con Firebase, el sistema seguro del teléfono guarda solo el UID enrolado; en inicios posteriores protege la sesión Firebase persistida con biometría. Nunca se guarda la contraseña: cerrar la sesión Firebase exige volver a usar correo/contraseña.
- El encabezado común enlaza la campana a una bandeja accesible para cliente, empleado y administración; la pantalla de avisos administrativos explica los botones directos a WhatsApp y el estado real de registro push.

## Ajustes solicitados: lenguaje, negocio y datos de cliente

- Las pantallas muestran mensajes cálidos en español, nunca errores crudos, enlaces de diagnóstico ni nombres de proveedores/servicios técnicos. Los detalles de consulta fallida van a la consola; el cliente ve «No pudimos cargar tus citas, intenta de nuevo» y puede reintentar.
- El cliente registra un teléfono obligatorio: ocho dígitos hondureños o número internacional con `+`. El perfil guarda cumpleaños opcional únicamente como `birthdayDay` y `birthdayMonth`; no se solicita ni se escribe identidad. La UI puede presentar registros antiguos sin revelar esos campos retirados.
- Administración selecciona automáticamente el único negocio activo. Si no hay ninguno, una acción explícita llama una Cloud Function protegida que crea «EUFORIA Beauty Studio» activo; la función comprueba rol admin y vuelve a usar el negocio existente ante llamadas repetidas.
- El alta de empleado requiere negocio activo y código válido; cada faltante se indica bajo su campo y el botón permanece deshabilitado hasta cumplir ambos requisitos. UID sigue siendo interno y no se presenta.
- `firestore.indexes.json` cubre la consulta de cliente por `clienteId ASC, inicio ASC` y todas las consultas compuestas de la app. Los pasos de despliegue manual indican los comandos específicos de índices, Rules y Functions.
- Ajustes muestra una única línea «Conectado con servidor» / «Sin conexión con servidor», con indicador verde/rojo y estado observado de internet/endpoint; elimina nombre del proveedor, instrucciones de secretos y número de versión.
