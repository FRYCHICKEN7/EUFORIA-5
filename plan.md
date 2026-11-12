# Plan de migración de EUFORIA Beauty Studio a Firebase Spark

## Alcance confirmado por el archivo compartido

La aplicación sigue siendo Expo/React Native/TypeScript. Se retiraron Cloud Functions y Admin SDK del flujo activo, conservando Authentication y Firestore con reglas de menor privilegio. No se activó Blaze ni se desplegaron reglas, índices o funciones en Firebase real. El código histórico quedó en `functions-legacy/`, fuera de `firebase.json`, con una nota que prohíbe volver a desplegarlo.

La interfaz seguirá en español, conservará los perfiles duales `users/{uid}` y `usuarios/{uid}`, los roles `admin`, `empleado` y `cliente`, el catálogo, los avisos dentro de la app y los respaldos locales. Los mensajes presentados a las personas serán claros y no contendrán errores crudos.

## Hallazgos importantes antes de programar

- Firebase permite seguir usando Authentication y Firestore en Spark dentro de sus cuotas gratuitas. Cloud Functions requiere Blaze para nuevos despliegues. En Spark, si se alcanza una cuota gratuita, el servicio afectado puede quedar detenido hasta el siguiente ciclo; no es una promesa de uso ilimitado sin costo. [1]
- El inicio de sesión desde el cliente puede hacerse con transacciones de Firestore. Son atómicas, pero necesitan conexión; Rules también limita las consultas entre documentos de una operación. La documentación fija topes de acceso a documentos y señala que las reglas no filtran una consulta por sí solas. [2] [3]
- Una segunda instancia de Firebase App/Auth puede mantener separada la sesión secundaria de la principal. El SDK cliente puede crear una cuenta mediante correo y contraseña; esa instancia no es Admin SDK y no puede modificar cualquier cuenta como administración del servidor. [4] [5]
- **Límite de seguridad de contraseñas:** Firestore Rules no pueden confirmar que `updatePassword` ya se ejecutó en Authentication. El cambio obligatorio se conserva como barrera de navegación de la app, pero no se presenta como garantía frente a una app modificada. No se abrió una regla para que el cliente borre por sí mismo esa marca.
- **Límite de concurrencia de citas:** el candado determinístico por profesional, fecha y hora permite serializar reservas. Para cubrir servicios que se solapan pero empiezan a horas distintas, la propuesta es ocupar bloques de 15 minutos a lo largo de toda la duración dentro de la transacción. Las Rules deben validar que cada candado pertenece a la cita creada y no se pueda cambiar por un cliente. Los límites `getAfter`/lecturas por operación deben probarse con el emulador, en particular con duraciones largas; si no se puede probar que las reglas imponen todos los bloques necesarios, no se debe afirmar que impiden todo solapamiento ante solicitudes manipuladas. [2] [3]
- **Privacidad de los empleados:** Firestore entrega el documento completo en una lectura; Rules no pueden ocultar `email` o `phone` dentro de un documento legible por clientes. Se usa `empleadosPublicos/{uid}` con datos mínimos y se bloquea la lectura de la membresía privada a clientes; la membresía queda para administración o el propio empleado. Los bloqueos de ocupación son neutros y su lectura requiere un perfil cliente con negocio activo y agenda preparada, o administración. [6]
- **Restricción confirmada al auditar Fase 2:** las Rules actuales niegan las escrituras de citas y un cliente no puede consultar citas de otras personas. No se abrirá lectura de citas ni de datos personales. El registro público de ocupación se divide en 24 documentos de una hora por profesional y día hondureño, en `negocios/{negocioId}/bloqueosCitas/{empleadoUid}_{fechaLocalKey}_{particion}`. `fechaLocalKey` es el milisegundo UTC de la medianoche correspondiente al día civil en Honduras: la app lo prepara y Rules lo vuelve a calcular desde el inicio desplazado seis horas, usando `(inicioLocal.date()).toMillis()`; la partición identifica uno de los 24 tramos horarios. Cada mapa contiene como máximo cuatro claves —índices absolutos de bloques de 15 minutos convertidos a texto— con valores booleanos `true`; Rules verifica la consecutividad, el valor neutro y que `MapDiff` añada o retire solo las claves correspondientes a ese tramo. Una cita de hasta 480 minutos afecta como máximo nueve documentos y todos se vinculan a su inicio y servicio. Para no repetir el chequeo recíproco entre Rules, la app guarda primero la cita en un estado interno `preparando`; una segunda operación actualiza la cita a `pendiente_de_aprobacion` y guarda todos los bloqueos juntos. Las Rules comprueban que el estado interno es reciente y pertenece al mismo cliente antes de aceptar los bloqueos; si la operación final falla, la app elimina la preparación. La reserva solo se comunica al cliente después de que se haya guardado la cita y la totalidad de los bloqueos. Al rechazar, se marca primero el estado y después se liberan sus bloques; si la liberación no concluye, estos siguen ocupados para impedir solapamientos. Las lecturas por cliente consultan solo los registros de ese profesional y día; no leen citas de otras personas, membresías, correo ni teléfono. Si la cobertura de 480 minutos no cabe en los límites de expresiones/accesos o no se prueba íntegramente, no se habilitan reservas desde cliente. [2] [3] [7] [8] [9] [10] [11] [12]
- **Citas ya existentes:** la app incluye **Ajustes → Preparar agenda**. Cierra reservas, revisa citas futuras, informa datos inválidos, citas que cruzan el día o solapamientos, escribe ocupación neutra por lotes y solo vuelve a abrir cuando termina completa. Los holds vencidos se ignoran por vencimiento; no se automatiza ningún cron.

## Tabla: qué hace cada Function y qué la sustituirá

| Function actual | Tipo y función actual | Fase | Sustitución planeada sin servidor |
|---|---|---:|---|
| `solicitarPerfilEmpleado` | Callable; valida sesión y guarda la solicitud `empleados/{uid}` como perfil cliente pendiente. | 1 | El usuario autenticado guarda sus perfiles base y la solicitud propia en una operación de Firestore; Rules limitan UID, campos, tipos y estado `pendiente`. No se envían avisos a otros administradores desde este paso. |
| `aprobarSolicitudEmpleado` | Callable; valida admin, solicitud, perfil y negocio; cambia roles, membresía y avisos. | 1 | Acción explícita de administración en la app, con transacción/batch Firestore y reglas exclusivas de admin que validen transición y campos. Promoción y membresía suceden al aceptar, nunca al solicitar. |
| `rechazarSolicitudEmpleado` | Callable; marca rechazada, mantiene rol cliente y avisa al solicitante. | 1 | Acción explícita de admin en Firestore que solo cambia solicitud pendiente a rechazada y registra actor/fecha; no eleva el rol. Aviso dentro de la app, sin push automático. |
| `prepararNegocioInicial` | Callable; reutiliza un negocio activo o crea EUFORIA Beauty Studio. | 1 | Consulta desde el cliente y creación directa por admin usando ID estable para evitar duplicados por doble toque. Rules mantienen escritura solo para admin. |
| `crearPerfilEmpleado` | Callable legacy que rechaza crear/promover directamente; no se encontró caller. | 1 | Retirarla del flujo y documentar que administración solo acepta o rechaza solicitudes. |
| `guardarDisponibilidadEmpleado` | Callable; valida perfil/membresía y guarda siete horarios semanales. | 2 | Transacción cliente del empleado autenticado que lee su propio perfil/membresía y guarda los siete días y disponibilidad; actualiza también la proyección pública mínima. Rules solo permiten su propia ruta, horarios válidos y datos públicos permitidos. |
| `obtenerDisponibilidad` | Callable de lectura; consulta servicio, horario, equipo, turnos y citas; ejecuta el cálculo de huecos. | 2 | Leer ficha pública de empleados y turnos; disponibilidad se calcula en el teléfono con `lib/availability.ts` y bloqueos neutros. El catálogo consulta por empleado/día y nunca consulta citas privadas de otras personas. |
| `reservarCita` | Callable transaccional; valida servicio/horario/empleado, crea `hold` y notificaciones. | 2 | Flujo cliente en dos pasos: guardar cita privada `preparando`; después actualizar a `pendiente_de_aprobacion` y escribir todas las particiones juntas. Rules vinculan cliente/cita/bloqueos, verifican servicio y horario, y niegan cambios a datos inmutables. No crear holds nuevos. |
| `aprobarCita` | Callable; permite a admin o empleado asignado confirmar una solicitud pendiente y avisa al cliente. | 2 | Transacción limitada a `pendiente_de_aprobacion → confirmada`, actor admin o empleado asignado; Rules y cliente vuelven a validar que negocio, profesional y horario sigan vigentes. |
| `rechazarCita` | Callable; permite a admin o empleado asignado rechazar la solicitud y avisa al cliente. | 2 | Transacción limitada a `pendiente_de_aprobacion → rechazada`; registra actor/fecha, crea aviso y retira únicamente los bloques de esa cita en la misma operación. |
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
- `lib/`: cliente Firebase y lógica reutilizable. `employee-requests.ts` y `profiles.ts` usan Auth/Firestore directos; `availability.ts`, `appointment-blocks.ts`, `appointment-migration.ts` y `appointment-preparation.ts` calculan disponibilidad, particiones y preparación de agenda. `whatsapp-reminder-logic.ts` prepara avisos locales al abrir la pantalla.
- `functions-legacy/`: fuente histórica sin punto de despliegue activo. `firebase.json` y la app ya no configuran Functions ni notificaciones push.
- `firestore.rules` y `firestore.indexes.json`: permisos y consultas. La Fase 1 actualiza Rules; no requiere nuevos índices.
- `tests/` y `lib/*.test.ts`: pruebas del emulador y pruebas unitarias; el emulador usa únicamente un proyecto local `demo-*`.
- `assets/images/`: logo y recursos gráficos usados por la app nativa.

### Fase 1 — Solicitudes de empleados y negocio

Actualizar registro/recuperación en `app/auth.tsx`, operaciones de perfil en `lib/profiles.ts` y permisos en `firestore.rules`. La solicitud crea, para su propio UID, perfiles base de cliente y `empleados/{uid}` pendiente, con cumpleaños día/mes como números y datos del formulario. Reintentar con la cuenta existente no duplica Auth ni reemplaza datos. Aceptar/rechazar solo lo puede hacer admin; al aceptar se sincronizan perfiles, estado, negocio y membresía; rechazar conserva rol cliente y excluye a esa persona de Clientes. Crear negocio solo desde sesión admin, reutilizando negocio activo y usando creación estable si no existe.

Pruebas de Rules Emulator: una persona no puede ascenderse a empleado/admin ni editar campos privilegiados; solo admin acepta/rechaza; solicitudes pendientes/rechazadas no se cuentan como clientes; perfiles de otra persona no se leen; una cuenta con roles contradictorios no obtiene permisos. Ejecutar `pnpm check`, `pnpm lint` y `pnpm test`. No avanzar si falla alguna verificación.

**Estado 12 nov 2026:** Fase 1 quedó implementada en Auth/Firestore directo; no se desplegaron Rules ni se escribieron datos reales. La validación final de las Fases 2 y 3 se registra en `TODO.md`.

### Fase 2 — Disponibilidad y citas

Fase 2 implementada localmente: `lib/availability.ts` calcula horarios con `America/Tegucigalpa`; el catálogo consulta empleados públicos sin correo/teléfono y bloqueos neutros; la reserva cliente se prepara en dos pasos, evita solapamientos para intervalos de 5 a 480 minutos y no crea holds. Administración prepara citas futuras antes de abrir reservas. La aprobación vuelve a validar negocio, profesional y horario; el rechazo retira en la misma transacción solo los bloques propios. Se mantiene `finalizada` y se lee de manera compatible el histórico `completada`.

Rules Emulator cubre privacidad, citas ajenas, confirmación con horario vigente, dos reservas que se solapan, rechazo/liberación, horario del empleado y el caso de 480 minutos (32 bloques en nueve particiones). La lista de bloqueos solo se permite a perfiles cliente cuando el negocio está activo y la agenda preparada, o a administración; Firestore Rules no pueden probar por sí solas el filtro de una consulta, por lo que esos registros contienen exclusivamente ocupación neutra y no datos personales.

### Fase 3 — Avisos dentro de app, alta de cliente y WhatsApp manual

Fase 3 implementada localmente: altas de clientes mediante instancia secundaria de Auth y perfiles Firestore; cambio de contraseña con el SDK cliente y barrera de navegación con el límite documentado; avisos dentro de la app y bandeja administrativa; Expo Push y Functions retirados del flujo activo. **Avisar** calcula oportunidades cuando administración abre la pantalla; plazo inicial 73 horas, ajustes editables, sin cron ni envío automático. Solo el botón manual abre `wa.me`; copias locales siguen guardándose en el dispositivo.

No hay una prueba de Auth de producción ni se ejecutó el flujo en un teléfono físico; la suite Auth logout configurada aparece omitida en Vitest. Las pruebas, exportaciones y despliegue manual pendiente se detallan en `TODO.md`. El código antiguo está archivado en `functions-legacy/`; no se ejecutó EAS ni se escribió en Firebase real.

## Validación, cambios publicados y entrega

El código verificado quedó en el commit `ae0996993e6d0c69f4aafb9f733e2b62534dc30a`, sincronizado con la rama `main` del remoto canónico Manus y del espejo público solicitado [`FRYCHICKEN7/EUFORIA-5`](https://github.com/FRYCHICKEN7/EUFORIA-5). La historia se conserva y no se crea otro repositorio `EUFORIA-6`. La publicación automática está desactivada; guardar el código no publica la app ni despliega Firebase. README/TODO conservan los pasos manuales, límites de seguridad y pruebas realmente ejecutadas.

No se despliegan Rules ni se publican datos en producción desde esta tarea. Publicar las Rules requiere acción manual del titular: **Firebase Console → Firestore Database → Reglas → pegar el archivo final → Publicar**.

## Diseño que se conserva

Boutique de belleza premium, rosa rubor, vino profundo y superficies claras; tarjetas legibles, controles amplios para uso con una mano y español sencillo. Se conserva el tema claro/rosado oscuro, el logo existente y las cuatro pestañas **Resumen**, **Clientes**, **Avisar** y **Ajustes**. Los mensajes de error describen qué puede hacer la persona, sin términos técnicos.

## Fuentes oficiales consultadas

[1] [Planes de precios Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) — acceso a Cloud Functions en Blaze y cuotas de Spark.
[2] [Condiciones de reglas de seguridad de Firestore](https://firebase.google.com/docs/firestore/security/rules-conditions) — `getAfter`, límites de acceso y consultas compatibles con reglas.
[3] [Transacciones y escrituras por lotes](https://firebase.google.com/docs/firestore/manage-data/transactions) — atomicidad, reintentos y falta de soporte sin conexión.
[4] [Configurar varios proyectos/instancias de Firebase en una app](https://firebase.google.com/docs/projects/multiprojects) — instancias distintas de Firebase App.
[5] [Administrar usuarios de Firebase Authentication](https://firebase.google.com/docs/auth/web/manage-users) — creación de cuenta y cambio de contraseña con SDK cliente.
[6] [Control de acceso a campos de Firestore](https://firebase.google.com/docs/firestore/security/rules-fields) — las lecturas son a nivel de documento; para ocultar campos se necesitan documentos separados.
[7] [Referencia de MapDiff en Rules](https://firebase.google.com/docs/reference/rules/rules.MapDiff) — conjuntos de claves agregadas, modificadas o afectadas.
[8] [Referencia de Set en Rules](https://firebase.google.com/docs/reference/rules/rules.Set) — comparación de conjuntos con `hasAll`, `hasOnly`, `difference` e `intersection`.
[9] [Referencia de List en Rules](https://firebase.google.com/docs/reference/rules/rules.List) — acceso por índice, conversión a conjunto y tamaño de listas.


[10] [Lenguaje de reglas de seguridad Firebase](https://firebase.google.com/docs/rules/rules-language) — límites de funciones y ausencia de ciclos.
[11] [Cadenas en Firebase Rules](https://firebase.google.com/docs/reference/rules/rules.String) — conversión `string()` de valores numéricos y concatenación.
[12] [Timestamp en Firebase Rules](https://firebase.google.com/docs/reference/rules/rules.Timestamp_) — métodos de fecha/hora y conversión a milisegundos.
