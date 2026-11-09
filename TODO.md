# Estado de entrega EUFORIA

## Funcionalidad conservada de la versión anterior

- [x] **Perfiles y datos de clientes:** administración escucha perfiles reales de `users/{uid}` y `usuarios/{uid}`, reconoce `role/rol` y alias históricos `customer/client`. Las tarjetas muestran nombre, correo, teléfono y cumpleaños cuando existen, no muestran UID ni identidad y no usan datos de demostración.
- [x] **Registro de clientes:** perfil dual con teléfono obligatorio validado (ocho dígitos hondureños o internacional con `+`), cumpleaños opcional `birthdayDay`/`birthdayMonth`, sin año y sin campo de identidad. El alta pública no asigna privilegios.
- [x] **Disponibilidad semanal:** horarios de lunes a domingo (`0` domingo…`6` sábado), en Honduras, horas `HH:mm` y casilla separada «Disponible para citas». El servidor valida la edición propia.
- [x] **Servicios y reservas:** catálogo real con nombre, precio y `duracionMin` (5–480); ejemplo L. 120/90 min. El cliente selecciona servicio, fecha, profesional y franja calculada por función en `America/Tegucigalpa`, cada 15 minutos.
- [x] **Prevención de solapamientos:** descuenta citas activas del mismo profesional, reserva transaccional revalida el espacio y la app actualiza horarios ante conflicto. Los apartados temporales vencen a los 30 minutos.
- [x] **Agenda y métricas:** empleado confirma/rechaza, pulsa Inicio y Fin; el servidor registra `startedAt`, `completedAt` y duración real. Administración ve conteos y promedios.
- [x] **Roles, reglas e índices existentes:** Rules deniegan por defecto y protegen perfiles, roles, disponibilidad, citas y transiciones. Los índices cubren agenda de cliente (`clienteId ASC, inicio ASC`), empleado, administración, expiración y notificaciones.
- [x] **WhatsApp manual por cliente:** números hondureños se enlazan a `wa.me/504XXXXXXXX`; números internacionales se normalizan. El vínculo no envía mensajes automáticamente.
- [x] **Tema y lenguaje de la app:** marca y textos principales blancos sobre fondo vino; tarjetas claras conservan texto oscuro. Los errores de la interfaz no exponen mensajes crudos del proveedor.
- [x] **Estado de conexión:** Ajustes muestra una sola línea sencilla en español y reacciona a la red y a la respuesta del servidor; no muestra la versión técnica.

## Cambios aprobados en esta solicitud — completados en el código

- [x] **Registro de empleado y aprobación administrativa:** en el acceso oculto del equipo se puede escoger «Registrarse como empleado». El empleado crea su cuenta/perfil con los datos actuales del registro y envía una solicitud. Firestore crea el documento de empleado con estado `pendiente`, pero los perfiles `users/{uid}`/`usuarios/{uid}` conservan rol cliente; la solicitud pendiente o rechazada no puede abrir agenda, administrar disponibilidad ni reservar como empleado. En Clientes y equipo, administración solo ve solicitudes y puede **Aceptar** o **Rechazar**; se retiró la acción de crear/registrar empleados. La aceptación, verificada por servidor, sincroniza `role/rol: "empleado"`, `empleados/{uid}` y la membresía `negocios/{negocioId}/empleados/{uid}`, con disponibilidad apagada. El rechazo conserva la cuenta como cliente y marca la solicitud `rechazada`.
- [x] **Recuperación de registro parcial:** si se creó la cuenta pero falló el envío de la solicitud, registrar otra vez como empleado con el mismo correo autentica con la contraseña proporcionada y reintenta la solicitud sin crear otra cuenta ni reemplazar perfiles existentes. Iniciar sesión con el acceso de empleado también reintenta cuando el perfil sigue en estado cliente y no hay solicitud pendiente. Los errores indican que la cuenta ya existe y no debe registrarse de nuevo; la llamada de servidor existente devuelve una solicitud pendiente idempotentemente.
- [x] **Vinculación segura de solicitudes:** al aceptar, se usa el único negocio activo; si no hay ninguno, la función crea/reutiliza «EUFORIA Beauty Studio», `activo: true`; si hay varios negocios activos, bloquea la aceptación con mensaje claro en vez de elegir arbitrariamente. Solicitudes repetidas no duplican registros y se notifica el resultado al empleado.
- [x] **Recordatorios administrativos por WhatsApp, sin envío automático:** «Avisar por WhatsApp» lista datos reales de citas confirmadas, regresos recomendados y cumpleaños del día; permite buscar y filtrar, elegir una vista previa real, abrir manualmente el chat, marcar enviado solo después de enviar, omitir y cancelar. Un teléfono inválido impide abrir el chat. Ninguna tarea programada, vista previa o función envía mensajes automáticamente.
- [x] **Plazo y textos configurables:** los perfiles nuevos aceptan recordatorios por defecto y los perfiles históricos sin `aceptaRecordatoriosWhatsApp` se consideran habilitados. Cada cliente puede excluirse; al hacerlo se cancelan los avisos activos y no se generan nuevos. El recordatorio de cita queda inicialmente programado exactamente **73 horas antes**, ajustable por administración. Administración edita los tres textos (cita, regreso y cumpleaños), guarda la configuración en `negocios/{negocioId}.configuracionRecordatoriosWhatsApp`, tiene vista previa e inserción de variables permitidas; no se puede abrir un enlace con variables sin resolver ni `undefined`/`null`.
- [x] **Citas:** se preparan recordatorios únicamente para citas `confirmada`, no `hold`, pendiente, cancelada ni rechazada. Al cambiar fecha o estado se reconcilia o cancela el anterior, sin duplicados al repetir tareas; se usa fecha, hora y servicio reales en zona Honduras.
- [x] **Regresos por servicio:** cada servicio permite activar el recordatorio y configurar `periodoRegresoDias` y anticipación en días. El plazo se calcula desde `completedAt`, no desde inicio/reserva. Un servicio sin periodo no genera aviso; servicios distintos conservan periodos separados; si el cliente ya reservó el mismo servicio luego de finalizarlo, se cancela el aviso obsoleto.
- [x] **Cumpleaños e historial único:** se usan `birthdayDay`/`birthdayMonth`, sin año de nacimiento; el mismo aviso no vuelve a quedar pendiente el mismo año. El 29 de febrero se recuerda el 28 de febrero en años no bisiestos. Los eventos se guardan una sola vez en `recordatoriosWhatsApp` con tipo, cliente, negocio, cita/servicio si aplican, fecha programada, estado, marcas y UIDs de acciones e `idempotencyKey`; no se duplican colecciones de perfiles o citas.
- [x] **Mensajes y preferencias protegidos:** Rules/Functions reservan el historial para administración autorizada; Functions verifican cada acción de preparación, confirmación, omisión o cancelación. Cliente solo cambia su propio booleano `aceptaRecordatoriosWhatsApp`. Las tareas programadas preparan avisos pero nunca envían WhatsApp.
- [x] **Respaldo guardado en el celular:** administración exporta perfiles, negocio, servicios, horarios, equipo, clientes, citas y avisos. Se excluyen identidad, contraseñas, tokens y secretos. En Android se elige una carpeta del teléfono; en iPhone se abre la hoja del sistema para Guardar en Archivos. La copia no se sube a la nube y cancelar la selección no se presenta como un guardado exitoso.
- [x] **Avisos al reservar:** al enviar una solicitud se crean avisos dentro de la app para el cliente, el empleado asignado y todos los administradores válidos. El aviso del cliente incluye servicio, profesional y fecha/hora. El flujo de push remoto se conserva; la llegada con la app cerrada requiere credenciales Expo/FCM/APNs y una prueba en dispositivos.
- [x] **Compatibilidad de teléfonos históricos:** las funciones aceptan el teléfono guardado como `phone` o como `telefono`; los números no válidos se excluyen de WhatsApp.
- [x] **README/TODO y despliegue manual:** se documentan los campos, la colección, los comandos de Rules/índices/Functions y las limitaciones probadas. No se ejecutó ningún despliegue a Firebase. El ZIP actualizado se entrega aparte.

## Verificaciones ejecutadas en esta versión

- [x] `pnpm check`: TypeScript completo sin errores.
- [x] `pnpm lint`: sin errores; aparece solo un aviso no bloqueante sobre configuración ESM de ESLint.
- [x] `pnpm test`: 47 pruebas aprobadas, 1 prueba previa omitida.
- [x] `cd functions && pnpm run build`: compilación correcta. El entorno usa Node 22 aunque Functions declara Node 20; la compilación no se bloqueó.
- [x] Firestore Rules arrancaron en el emulador local `demo-euforia`; no se conectó con Firebase producción.
- [x] Expo exportó el bundle Android HBC y las 19 rutas Web. Esto no equivale a APK/EAS ni prueba almacenamiento local o push nativo en un teléfono.
- [x] `firestore.indexes.json` es JSON válido y `git diff --check` no encontró errores de formato.
- [x] Auditoría independiente detectó y se corrigieron: aviso inicial faltante al cliente, compatibilidad con `telefono` histórico y documentación del 29 de febrero; después se repitieron compilación, pruebas, exportaciones y verificación de Rules.
- [x] En la corrección del registro parcial se repitieron `pnpm check`, `pnpm lint`, `pnpm test` (47 aprobadas, 1 omitida) y exportación del bundle Android. No se probó una cuenta real ni la llamada en Firebase.
- [x] No se hicieron escrituras de prueba en Firebase producción ni se desplegaron Rules, índices o Functions.

## Pendiente para uso real

- [ ] Desplegar manualmente Rules, índices y Functions después de revisarlas; no se ha desplegado ningún recurso desde esta tarea.
- [ ] Asociar proyecto Expo/EAS, configurar FCM/APNs, tokens y build nativo para recibir push con la app cerrada; verificarlo realmente.
- [ ] Probar solicitud/aprobación/rechazo, recordatorios WhatsApp manuales y el guardado en una carpeta del teléfono después del despliegue. No afirmar resultados de producción antes de esa prueba.
- [ ] La restauración desde una copia, feriados, descansos múltiples y disponibilidad variable por fecha quedan fuera de esta entrega.
