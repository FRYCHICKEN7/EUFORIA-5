# Estado de entrega EUFORIA

## Funcionalidad implementada

- [x] **Perfiles y datos reales de clientes:** administración escucha perfiles reales desde `users/{uid}` y `usuarios/{uid}`, reconoce `role/rol` y los valores legacy `customer/client`, y muestra los campos que existan (`email`, `id`/UID, `identityNumber`, `name`, `phone`, `profileImage`, rol y fecha). Los listeners no tienen tope fijo de 500 registros; no se inventan datos.
- [x] **Registro y creación segura de empleado:** el registro público crea una cuenta Firebase Authentication y perfil `cliente` (`role/rol: "cliente"`) enlazado al UID en ambas colecciones de perfil. La cuenta no puede autoasignarse roles. Administración selecciona un cliente ya registrado, indica negocio y código único `Empleado`, y solicita promoción mediante Cloud Function. La Function verifica admin, cuenta real y habilitada en Authentication, perfil cliente, negocio y código; sincroniza `users`, `usuarios`, `empleados/{uid}` y el perfil operativo del negocio. El esquema empleado usa `Empleado`, `email`, `id` igual al UID Auth, `name`, foto propia si existe y `role/rol: "empleado"`.
- [x] **Disponibilidad semanal:** la persona autorizada define en Honduras los siete días (`0` domingo…`6` sábado), activa días, cambia inicio y fin `HH:mm` y maneja la casilla explícita **Disponible para citas**. Los defaults del formulario 08:00–17:00 no se guardan hasta pulsar Guardar; una Function comprueba que solo se edite la disponibilidad propia.
- [x] **Servicio, profesional y agenda del cliente:** administración puede crear/editar servicios reales con nombre, precio y `duracionMin` (5–480). El ejemplo L. 120/90 min se representa como 1 h 30 min. El cliente elige servicio, fecha, profesional visible y una franja calculada por Function en zona `America/Tegucigalpa`, cada 15 minutos. Se excluyen horas pasadas, recesos y solicitudes donde toda la duración no cabe dentro del horario de negocio y del profesional.
- [x] **Franjas ocupadas:** el cálculo evita intervalos activos del mismo empleado con estado `hold` vigente, `pendiente_de_aprobacion`, `confirmada` o `en_curso`. Un servicio de 90 minutos que comienza a las 10:00 no se ofrece cuando esa franja se cruza con una cita ocupada; la transacción vuelve a validar al reservar y el cliente vuelve a actualizar los huecos ante conflicto.
- [x] **Solicitud y confirmación:** reserva transaccional guarda profesional, cliente, servicio, precio, duración, comienzo/fin, estado `hold` y vencimiento de 30 minutos, y crea avisos Firestore al empleado asignado y a administración. La agenda del empleado escucha citas/notificaciones en vivo y permite confirmar o rechazar; la confirmación pasa a `confirmada` y el cliente la ve por listener en tiempo real. Functions registran avisos de confirmación/rechazo e inicio/final de servicio para el cliente y administración.
- [x] **Inicio, finalización y métricas:** solo el empleado asignado puede iniciar la cita confirmada (`en_curso`, `startedAt`) y finalizarla (`completada`, `completedAt`, `duracionRealMin/Seg`) mediante Functions. El resumen del administrador presenta conteo y promedio de duración real por empleado/servicio.
- [x] **Protección Firebase:** Rules conservan denegación por defecto, acceso a perfiles propios/roles autorizados, lectura administrativa de clientes, lectura de citas por cliente/profesional/admin y bloqueo de escrituras directas a roles, disponibilidad, citas y transiciones privilegiadas. Cada cuenta solo puede registrar/actualizar/eliminar sus tokens de Expo Push bajo `usuarios/{uid}/dispositivos/{deviceId}` con campos permitidos, token acotado, proveedor `expo`, plataforma `android`/`ios` y fecha de servidor. Índices incluyen citas por empleado/cliente, selector de profesionales y notificaciones.
- [x] **Documentación:** README explica perfiles, los campos del esquema enviado, horarios reales, servicios/duración, creación segura de empleado, confirmaciones, límites y comandos de despliegue manual.
- [x] **Contraste en tema rosado oscuro:** el nombre EUFORIA y los encabezados sobre el fondo vino se muestran en blanco; el texto secundario y de error usa tonos claros, mientras las tarjetas claras conservan texto oscuro.

## Solicitud adicional en curso

- [x] **WhatsApp manual por cliente:** el administrador puede tocar un botón en la tarjeta de cualquier cliente que tenga teléfono; se abre `https://wa.me/504{número}` para teléfonos hondureños de 8 dígitos, y se normalizan números que ya incluyen `+504` o `504`. No se conecta WhatsApp Business ni se envían mensajes automáticamente.
- [ ] **Notificaciones para todos los perfiles (push remoto pendiente):** cliente, empleado y administración pueden abrir una campana común, leer/marcar avisos Firestore en tiempo real y ver la tarjeta para autorizar notificaciones; los avisos de citas/servicios se escriben para los perfiles destinatarios y `enviarPushExpo` procesa las nuevas notificaciones. La entrega remota aún requiere asociar el proyecto Expo/EAS, configurar FCM V1/APNs y credenciales nativas, generar el build nativo y desplegar manualmente las Rules/Functions nuevas. La interfaz no afirma que el push esté activo; no se desplegó Firebase desde esta tarea.
- [x] **Acceso simple y roles ocultos:** la pantalla inicial presenta inicio de sesión de cliente; el acceso de administrador y empleado permanece oculto hasta que el usuario presione el icono de engranaje. La autorización final sigue dependiendo de los roles Firebase vinculados al UID.
- [x] **Biometría disponible para todos los perfiles:** después del login válido, cada usuario puede habilitar huella/biometría en el dispositivo; al volver a abrir o regresar de segundo plano se desbloquea la sesión Firebase persistida. La preferencia por UID se guarda en almacenamiento seguro del sistema; no se guardan contraseñas. Al cerrar sesión se intenta desactivar el documento de token push del UID autenticado (requiere conectividad y Rules desplegadas) y se requiere volver a autenticar con el proveedor Firebase.
- [x] **Contraste de marca:** el texto, incluidos “EUFORIA”, que aparezca directamente sobre fondos rosados oscuros se muestra blanco; las superficies claras mantienen texto oscuro para legibilidad.

## Verificación local

- [x] `pnpm check` (TypeScript) finalizó sin errores.
- [x] `pnpm lint` finalizó sin errores; Node emitió solo el warning no bloqueante de formato ESM de `eslint.config.js`.
- [x] `pnpm test`: 39 pruebas pasaron; una prueba preexistente quedó omitida; se agregaron cuatro pruebas de normalización WhatsApp.
- [x] `cd functions && pnpm run build` finalizó; el entorno de desarrollo usa Node 22 aunque Functions fija Node 20 (warning de engine, no bloqueó el build).
- [x] Firestore Rules actualizadas arrancaron en Firestore Emulator con el proyecto local `demo-euforia`, sin desplegar ni escribir a la base real.
- [x] `firestore.indexes.json` pasó parseo JSON y `git diff --check`.
- [x] Expo exportó bundle Android HBC y 19 rutas Web estáticas para Preview; esto no produce APK/EAS ni prueba módulos nativos en dispositivo.
- [x] Metro `/status` y la ruta web raíz respondieron, y los procesos gestionados ocuparon los puertos 8081/3000.
- [x] Captura móvil 390×844 de `/auth` confirma que el formulario inicial muestra cliente y el icono de engranaje, sin opciones privilegiadas visibles.
- [x] Revisión de solo lectura de flujos UI/Rules/Functions: no encontró fallos bloqueantes; sí detectó un límite silencioso de 500 perfiles, ya eliminado de los listeners de clientes y empleados.
- [x] No se hicieron escrituras de prueba en Firebase producción ni se desplegaron Rules/índices/Functions.

## Pendiente antes de usar con datos reales

- [ ] En Firebase Console verificar que el ID del perfil admin sea exactamente el UID vigente de Authentication y que los campos de rol no sean contradictorios.
- [ ] Crear los documentos reales del negocio, servicios y horario comercial; el horario sugerido del empleado no es horario del negocio.
- [ ] Verificar en Authentication que cada empleado exista; registrarse públicamente lo crea inicialmente como cliente, después admin lo promueve desde Clientes.
- [ ] Desplegar manualmente `firestore.rules`, `firestore.indexes.json` y Functions según README; el despliegue modifica recursos reales y no se ejecutó.
- [ ] Validar login, promoción, reserva y decisión con cuentas y datos reales después de desplegar; no se ejecutó esta prueba porque generaría/escribiría datos de producción.

## Fuera de esta fase

- [ ] Notificación push remota Android/iOS: falta `EXPO_PUBLIC_EAS_PROJECT_ID`, credenciales FCM V1/APNs, build nativo y despliegue manual de Rules/Functions. También faltan gestión de feriados/turnos especiales, descansos múltiples, reprogramación/cancelación integral y exportaciones.
- [ ] Build EAS/APK instalable y firmado; no se generó.
