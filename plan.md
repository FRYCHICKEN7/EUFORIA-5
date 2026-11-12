# Plan de migración de EUFORIA Beauty Studio a Firebase Spark

## Alcance confirmado por el archivo compartido

La aplicación seguirá siendo Expo/React Native/TypeScript. El objetivo es retirar Cloud Functions y Admin SDK del flujo, conservando Authentication y Firestore con reglas de menor privilegio. No se activará Blaze. No se desplegarán reglas, funciones, índices ni se escribirán datos de prueba en Firebase real. La carpeta actual `functions/` se moverá a `functions-legacy/` al final, con una nota que prohíba desplegarla.

La interfaz seguirá en español, conservará los perfiles duales `users/{uid}` y `usuarios/{uid}`, los roles `admin`, `empleado` y `cliente`, el catálogo, los avisos dentro de la app y los respaldos locales. Los mensajes presentados a las personas serán claros y no contendrán errores crudos.

## Hallazgos importantes antes de programar

- Firebase permite seguir usando Authentication y Firestore en Spark dentro de sus cuotas gratuitas. Cloud Functions requiere Blaze para nuevos despliegues. En Spark, si se alcanza una cuota gratuita, el servicio afectado puede quedar detenido hasta el siguiente ciclo; no es una promesa de uso ilimitado sin costo. [1]
- El inicio de sesión desde el cliente puede hacerse con transacciones de Firestore. Son atómicas, pero necesitan conexión; Rules también limita las consultas entre documentos de una operación. La documentación fija topes de acceso a documentos y señala que las reglas no filtran una consulta por sí solas. [2] [3]
- Una segunda instancia de Firebase App/Auth puede mantener separada la sesión secundaria de la principal. El SDK cliente puede crear una cuenta mediante correo y contraseña; esa instancia no es Admin SDK y no puede modificar cualquier cuenta como administración del servidor. [4] [5]
- **Límite de seguridad que debe aceptarse:** Firestore Rules no pueden confirmar que `updatePassword` ya se ejecutó en Authentication. El cambio obligatorio de contraseña puede imponerse en la navegación normal de la app, pero sin servidor no se puede demostrar frente a un cliente modificado que la contraseña cambió antes de retirar `mustChangePassword`. No se abrirá una regla que permita al propio cliente borrar esa marca y se presentará como seguridad garantizada. En Fase 3 habrá que elegir entre mantener una barrera de interfaz honesta, eliminar la marca obligatoria o conservar un servicio confiable fuera de Spark.
- **Límite de concurrencia de citas:** el candado determinístico por profesional, fecha y hora permite serializar reservas. Para cubrir servicios que se solapan pero empiezan a horas distintas, la propuesta es ocupar bloques de 15 minutos a lo largo de toda la duración dentro de la transacción. Las Rules deben validar que cada candado pertenece a la cita creada y no se pueda cambiar por un cliente. Los límites `getAfter`/lecturas por operación deben probarse con el emulador, en particular con duraciones largas; si no se puede probar que las reglas imponen todos los bloques necesarios, no se debe afirmar que impiden todo solapamiento ante solicitudes manipuladas. [2] [3]

## Tabla: qué hace cada Function y qué la sustituirá

| Function actual | Tipo y función actual | Fase | Sustitución planeada sin servidor |
|---|---|---:|---|
| `solicitarPerfilEmpleado` | Callable; valida sesión y guarda la solicitud `empleados/{uid}` como perfil cliente pendiente. | 1 | El usuario autenticado guarda sus perfiles base y la solicitud propia en una operación de Firestore; Rules limitan UID, campos, tipos y estado `pendiente`. No se envían avisos a otros administradores desde este paso. |
| `aprobarSolicitudEmpleado` | Callable; valida admin, solicitud, perfil y negocio; cambia roles, membresía y avisos. | 1 | Acción explícita de administración en la app, con transacción/batch Firestore y reglas exclusivas de admin que validen transición y campos. Promoción y membresía suceden al aceptar, nunca al solicitar. |
| `rechazarSolicitudEmpleado` | Callable; marca rechazada, mantiene rol cliente y avisa al solicitante. | 1 | Acción explícita de admin en Firestore que solo cambia solicitud pendiente a rechazada y registra actor/fecha; no eleva el rol. Aviso dentro de la app, sin push automático. |
| `prepararNegocioInicial` | Callable; reutiliza un negocio activo o crea EUFORIA Beauty Studio. | 1 | Consulta desde el cliente y creación directa por admin usando ID estable para evitar duplicados por doble toque. Rules mantienen escritura solo para admin. |
| `crearPerfilEmpleado` | Callable legacy que rechaza crear/promover directamente; no se encontró caller. | 1 | Retirarla del flujo y documentar que administración solo acepta o rechaza solicitudes. |
| `guardarDisponibilidadEmpleado` | Callable; valida perfil/membresía y guarda siete horarios semanales. | 2 | Transacción cliente del empleado autenticado que lee su propio perfil/membresía y guarda los siete días y disponibilidad. Rules solo permiten su propia ruta y campos válidos. |
| `obtenerDisponibilidad` | Callable de lectura; consulta servicio, horario, equipo, turnos y citas; ejecuta el cálculo de huecos. | 2 | Lecturas permitidas desde Firestore y cálculo local. Mover `functions/src/availability.ts` a `lib/availability.ts` y mantener pruebas de horario Honduras, duración, recesos y conflictos. |
| `reservarCita` | Callable transaccional; valida servicio/horario/empleado, crea `hold` y notificaciones. | 2 | Transacción autenticada: leer referencias reales, comparar precio y duración, crear cita `pendiente_de_aprobacion` y candados determinísticos para cada bloque ocupado. Rules vinculan cliente/cita/candados, validan servicio activo y niegan cambios a datos inmutables. No crear holds nuevos. |
| `aprobarCita` | Callable; permite a admin o empleado asignado confirmar una solicitud pendiente y avisa al cliente. | 2 | Transacción Firestore limitada a `pendiente_de_aprobacion → confirmada`, actor admin o empleado asignado, y aviso in-app permitido por Rules. |
| `rechazarCita` | Callable; permite a admin o empleado asignado rechazar la solicitud y avisa al cliente. | 2 | Transacción limitada a `pendiente_de_aprobacion → rechazada`, registra actor/fecha y aviso in-app. Las reglas no permitirán cambiar cliente, profesional, servicio ni precio. |
| `iniciarServicio` | Callable; el profesional asignado inicia una cita confirmada con hora del servidor y aviso. | 2 | Escritura transaccional cliente de `confirmada → en_curso`, solo para empleado asignado. La hora proviene del dispositivo y no se describirá como hora de servidor. |
| `finalizarServicio` | Callable; completa servicio, mide duración con reloj del servidor y crea avisos. | 2 | Transición cliente de `en_curso → finalizada` con hora del dispositivo y cálculo en la app. Las Rules protegen actor/estado/campos, pero la duración no es una medición autoritativa frente a reloj manipulado. Lectores aceptarán registros históricos `completada`. |
| `expirarHolds` | Tarea programada cada cinco minutos para cambiar holds vencidos. | 2 | Retirar. No se crearán holds nuevos; los antiguos se ignoran por fecha al consultar o reservar y se liberan al intentar reservar, cuando Rules permitan demostrar que vencieron. No se simulará una tarea programada. |
| `registrarAviso` | Callable administrativa; no se encontró caller en la app. | 3 | Retirar si se confirma que no tiene consumidores. Los avisos requeridos se crean en la misma transacción del evento con destinatario/cita restringidos por Rules. |
| `enviarPushExpo` | Disparador; envía push Expo y modifica tokens/resultado. | 3 | Retirar el envío push automático y su trigger. Se conserva la bandeja dentro de la app; la notificación móvil remota no quedará disponible sin servidor. |
| `crearCuentaCliente` | Callable/Admin Auth; crea usuario ajeno y perfiles sincronizados, con recuperación de alta parcial. | 3 | Admin usa una segunda instancia de Auth cliente para crear o iniciar sesión en la cuenta; Auth principal del administrador no cambia. Luego escribe `users/{uid}` y `usuarios/{uid}` como cliente mediante Firestore, autorizado por Rules. Recuperar altas parciales iniciando sesión en la instancia secundaria; nunca guardar la contraseña en Firestore ni registros. |
| `cambiarContrasenaProvisional` | Callable; usa Admin Auth y actualiza flags de perfil. | 3 | El cliente cambia su propia contraseña con Auth SDK (`updatePassword`). Mantener bloqueo de pantallas dentro de la app, sujeto al límite de seguridad indicado arriba; no permitir que Rules confundan el cambio de bandera con una prueba del cambio real de contraseña. |
| `guardarConfiguracionRecordatoriosWhatsApp` | Callable admin; valida plantillas/plazo y regenera en masa recordatorios de cita. | 3 | Guardar solo configuración editable del negocio desde el cliente con Rules admin. Eliminar el barrido/regeneración automática. |
| `actualizarRecordatorioWhatsApp` | Callable admin; valida transiciones de recordatorios manuales usando citas/perfiles relacionados. | 3 | Si se conserva historial, actualización manual del estado desde la app, solo admin y con campos/transiciones limitados por Rules; WhatsApp se abre solo al tocar el botón. |
| `sincronizarRecordatoriosCitas` | Disparador de citas; crea/cancela recordatorios automáticamente. | 3 | Retirar. La pantalla calcula en ese momento las citas próximas que corresponde avisar y ofrece abrir manualmente `wa.me` con el texto preparado. No se escriben tareas en segundo plano. |
| `sincronizarRecordatoriosServicios` | Disparador de cambios en servicios; reconstruye avisos de regreso. | 3 | Retirar. Calcular oportunidades de regreso al abrir **Avisar**, desde citas finalizadas y la configuración vigente del servicio. |
| `prepararRecordatoriosCumpleanos` | Tarea diaria; encuentra cumpleaños y crea avisos por negocio. | 3 | Retirar. Calcular cumpleaños en la pantalla, cuando administración la abre, usando día/mes y zona `America/Tegucigalpa`; botón de contacto siempre manual. |
| `cancelarRecordatoriosWhatsAppExcluidos` | Disparador de `usuarios/{uid}`; cancela/regenera avisos según preferencia. | 3 | Retirar. La pantalla consulta la preferencia actual y no prepara ni muestra contacto si la persona excluyó avisos. |
| `cancelarRecordatoriosWhatsAppExcluidosLegacy` | Disparador legacy de `users/{uid}`; replica cancelación/regeneración. | 3 | Retirar junto a la automatización WhatsApp y la Function duplicada legacy. |

## Fases y carpetas

### Estructura del proyecto

- `app/`: pantallas Expo Router para acceso, pestañas, clientes, equipo, administración, catálogo, agenda y avisos.
- `components/`: controles compartidos, incluidos selectores de cumpleaños y formularios.
- `lib/`: cliente Firebase y lógica reutilizable. `employee-requests.ts` conserva las acciones de solicitud, aprobación, rechazo y negocio inicial directamente en Firestore; `employee-data.ts` contiene normalización pura; `profiles.ts` mantiene listeners y tipos. Las fases siguientes migrarán disponibilidad, citas y recordatorios en estos módulos.
- `functions/`: funciones existentes para las operaciones todavía pendientes de migración. En la Fase 1 se retiraron del punto de entrada las exportaciones de solicitud/aprobación/rechazo, alta de empleado y negocio inicial; no se debe volver a desplegar la versión anterior para esas acciones.
- `firestore.rules` y `firestore.indexes.json`: permisos y consultas. La Fase 1 actualiza Rules; no requiere nuevos índices.
- `tests/` y `lib/*.test.ts`: pruebas del emulador y pruebas unitarias; el emulador usa únicamente un proyecto local `demo-*`.
- `assets/images/`: logo y recursos gráficos usados por la app nativa.

### Fase 1 — Solicitudes de empleados y negocio

Actualizar registro/recuperación en `app/auth.tsx`, operaciones de perfil en `lib/profiles.ts` y permisos en `firestore.rules`. La solicitud crea, para su propio UID, perfiles base de cliente y `empleados/{uid}` pendiente, con cumpleaños día/mes como números y datos del formulario. Reintentar con la cuenta existente no duplica Auth ni reemplaza datos. Aceptar/rechazar solo lo puede hacer admin; al aceptar se sincronizan perfiles, estado, negocio y membresía; rechazar conserva rol cliente y excluye a esa persona de Clientes. Crear negocio solo desde sesión admin, reutilizando negocio activo y usando creación estable si no existe.

Pruebas de Rules Emulator: una persona no puede ascenderse a empleado/admin ni editar campos privilegiados; solo admin acepta/rechaza; solicitudes pendientes/rechazadas no se cuentan como clientes; perfiles de otra persona no se leen; una cuenta con roles contradictorios no obtiene permisos. Ejecutar `pnpm check`, `pnpm lint` y `pnpm test`. No avanzar si falla alguna verificación.

**Estado 11 nov 2026:** implementación y revisión independiente local completadas; TypeScript/lint, 52 pruebas unitarias, 8 pruebas de Rules Emulator, compilación de funciones restantes y exportaciones Expo Android/Web pasaron. No se desplegaron Rules ni se escribieron datos reales. Solo queda publicar las Rules finales e instalar la versión actualizada para comprobarla en el teléfono antes de usar el flujo con producción.

### Fase 2 — Disponibilidad y citas

Extraer la lógica pura de disponibilidad a `lib/availability.ts`; sustituir callables de disponibilidad, reserva y transiciones por SDK cliente. Reescribir `lib/appointments.ts` y las pantallas de catálogo, agenda y resumen. La reserva inicial será `pendiente_de_aprobacion`; no habrá hold de 30 minutos. Validar con transacciones y candados por bloques de 15 minutos para cubrir duraciones variables, mantener `America/Tegucigalpa`, impedir modificaciones de campos históricos y reflejar vencimiento lógico de holds antiguos. Usar el estado nuevo `finalizada` y leer de manera compatible el histórico `completada`.

Pruebas de Rules Emulator: cliente A no lee cliente B; un cliente no confirma ni edita cita ajena; solo admin/empleado asignado realiza cada transición; precio/duración deben coincidir con servicio; dos clientes no pueden reclamar el mismo bloque ni horarios solapados; rechazo/vencimiento libera bloque; empleado solo edita su propia disponibilidad. Ejecutar TypeScript, lint y suite completa antes de pasar a Fase 3. Si Rules no pueden probar todos los bloques sin exceder sus límites, detener la fase y revisar la seguridad antes de permitir reservas.

### Fase 3 — Avisos dentro de app, alta de cliente y WhatsApp manual

Migrar altas administrativas de clientes a una instancia secundaria de Auth y perfiles cliente por Firestore. Sustituir el cambio de contraseña provisional por el SDK Auth de cliente y mantener el bloqueo de interfaz con el límite documentado. Escribir notificaciones in-app en los mismos lotes/transacciones que sus acciones cuando Rules puedan verificar actor, evento y destinatario. Quitar Expo Push. Rehacer **Avisar** para calcular oportunidades visibles al abrir la pantalla; mantener el plazo inicial de 73 horas y las plantillas si siguen siendo útiles, pero sin cron ni generación de avisos en segundo plano. Solo botones explícitos abrirán `wa.me`; ninguna función/app enviará automáticamente mensajes. Mantener el respaldo local en el dispositivo.

Agregar pruebas de Rules y pruebas de Auth Emulator para alta con Auth secundaria, perfil asociado al UID, contraseña no persistida y bloqueo normal de navegación. Ejecutar `pnpm check`, `pnpm lint`, `pnpm test`, reglas en emulador y exportaciones local Android/Web según soporte del proyecto. Entonces mover `functions/` a `functions-legacy/`, añadir su README de no despliegue y retirar configuración/guías que sugieran desplegar esas funciones. No ejecutar EAS, no prometer APK y no escribir en Firebase real.

## Validación, cambios publicados y entrega

Cada fase se integra solo si sus comandos `pnpm check`, `pnpm lint` y `pnpm test` pasan; Rules y sus pruebas deben correr contra emulador local. Se actualizarán README/TODO después de aprobar este plan, conservando explícitos los pasos manuales y límites de seguridad. Al final se creará el repositorio público `FRYCHICKEN7/EUFORIA-6`, se subirá la app completa sin `.env`, claves privadas ni credenciales. Antes de subir se revisarán archivos presentes y el historial que se enviará. El usuario recibirá el enlace, resumen en español, pruebas realmente ejecutadas, pasos manuales para pegar/publicar `firestore.rules` y qué debe probar en el teléfono.

No se despliegan Rules ni se publican datos en producción desde esta tarea. Publicar las Rules requiere acción manual del titular: **Firebase Console → Firestore Database → Reglas → pegar el archivo final → Publicar**.

## Diseño que se conserva

Boutique de belleza premium, rosa rubor, vino profundo y superficies claras; tarjetas legibles, controles amplios para uso con una mano y español sencillo. Se conserva el tema claro/rosado oscuro, el logo existente y las cuatro pestañas **Resumen**, **Clientes**, **Avisar** y **Ajustes**. Los mensajes de error describen qué puede hacer la persona, sin términos técnicos.

## Fuentes oficiales consultadas

[1] [Planes de precios Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) — acceso a Cloud Functions en Blaze y cuotas de Spark.
[2] [Condiciones de reglas de seguridad de Firestore](https://firebase.google.com/docs/firestore/security/rules-conditions) — `getAfter`, límites de acceso y consultas compatibles con reglas.
[3] [Transacciones y escrituras por lotes](https://firebase.google.com/docs/firestore/manage-data/transactions) — atomicidad, reintentos y falta de soporte sin conexión.
[4] [Configurar varios proyectos/instancias de Firebase en una app](https://firebase.google.com/docs/projects/multiprojects) — instancias distintas de Firebase App.
[5] [Administrar usuarios de Firebase Authentication](https://firebase.google.com/docs/auth/web/manage-users) — creación de cuenta y cambio de contraseña con SDK cliente.
