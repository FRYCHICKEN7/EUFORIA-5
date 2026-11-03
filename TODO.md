# Estado de entrega EUFORIA

## Código implementado

- [x] Migrar selectivamente pantallas, componentes, tema, utilidades y branding del repositorio fuente al starter móvil Expo Router existente; conservar su runtime, navegación raíz, puertos `8081`/`3000` e identificadores nuevos del proyecto gestionado, sin enviar cambios al GitHub fuente.
- [x] Mantener el logo EUFORIA sin recorte y con margen seguro en icono, splash, favicon y variantes adaptativas; conservar la marca rosa/vino y el nombre del producto.
- [x] Implementar acceso Firebase Email/Password, selector de rol Cliente/Empleado/Administrador, control del perfil de `usuarios/{uid}`, recuperación por correo y cambio de contraseña con reautenticación cuando el usuario provee su contraseña actual.
- [x] Implementar registro público de clientes creando `usuarios/{uid}` con el UID de Authentication, `email`, `rol: "cliente"`, `createdAt` de servidor y los datos opcionales admitidos; no dejar que el formulario público elija roles privilegiados ni mostrar éxito si la creación del perfil falla.
- [x] Implementar lectura de perfil en sesión y redirección por rol; proteger las vistas administrativas, del empleado y del cliente. Las variables se cargan desde `EXPO_PUBLIC_FIREBASE_*`; `.env` local y credenciales Admin SDK quedan fuera del control de versiones.
- [x] Compatibilidad con perfiles Firebase legados: aceptar `role: "admin"` además de `rol: "admin"`/`"administrador"` en login, navegación, Firestore Rules y Cloud Functions; siempre exigir `usuarios/{UID autenticado}` y denegar perfiles con campos `role` y `rol` contradictorios. Mostrar el UID autenticado cuando falta el documento.
- [x] Entregar `firestore.rules` con denegación por defecto: lectura del perfil propio, creación propia exclusivamente con rol `cliente`, perfiles administrativos leídos solo por roles autorizados, catálogo público autenticado y acceso a citas limitado al cliente propietario, profesional asignado o administrador reconocido por su perfil. No permite escrituras directas no confiables de citas ni avisos.
- [x] Entregar reglas acotadas para `usuarios/{uid}`, `clientes/{clienteId}`, `negocios/{negocioId}` y subcolecciones; bloquear autoelevación y proteger rol/UID de perfil. Las reglas compilaron en el emulador local de Firestore.
- [x] Implementar Cloud Functions `reservarCita`, `aprobarCita`, `rechazarCita`, `expirarHolds` y `registrarAviso`. La reserva deriva el cliente de `request.auth.uid`, exige perfil `cliente`, servicio/negocio/profesional activos y modo válido, comprueba duración/precio, horario local de Tegucigalpa, apertura/cierre/recesos y fecha futura; la transacción rechaza solapamientos del mismo profesional/negocio. La función de reserva y las transiciones de cita se compilaron con TypeScript.
- [x] Mantener estados `hold`, `pendiente_de_aprobacion`, `confirmada`, `en_curso`, `completada`, `cancelada`, `rechazada` y `expirada`. El modo `unipersonal` confirma al reservar; `multiEmpleado` crea una reserva temporal de 30 minutos que solo puede decidir un administrador o el empleado asignado. La expiración programada corre cada cinco minutos.
- [x] Conectar catálogo/servicios a Firestore, y las citas del cliente, el resumen administrativo, los perfiles de Clientes y la agenda de administrador/empleado a listeners `onSnapshot` con estados de error/vacío; el personal autorizado ve sus citas, el administrador ve la agenda y cada cliente solo sus propias citas. No agregar servicios, precios, personas ni citas de demostración.
- [x] Entregar `firestore.indexes.json` para las consultas usadas por perfiles, agenda, profesionales y expiración de reservas; documentar el esquema requerido en README.
- [x] Mantener Ajustes, cierre de sesión, preferencias de apariencia y mensajes veraces: WhatsApp/FCM, exportación y respaldo se muestran como no conectados; no se simulan envíos.

## Verificado en el entorno de desarrollo

- [x] `pnpm check` finalizó correctamente.
- [x] `pnpm lint` finalizó sin errores de lint; Node notificó un warning no bloqueante sobre el formato ESM de `eslint.config.js`.
- [x] `cd functions && pnpm run build` finalizó correctamente; el entorno usa Node 22 y el runtime de Functions del proyecto está fijado a Node 20.
- [x] `pnpm db:push` indicó que no había cambios de esquema por aplicar.
- [x] Rules compilaron con Firebase Emulator usando un proyecto demo local, sin iniciar sesión, desplegar ni escribir en el Firebase real.
- [x] Metro respondió HTTP 200 en el puerto `8081` y `/status` devolvió `packager-status:running`; el API del starter escuchó en `3000`.
- [x] Se comprobó la presencia de las variables Firebase necesarias en el entorno gestionado actual sin imprimir sus valores. No se hizo una prueba de inicio de sesión ni de reserva contra datos de producción.

## Pendiente antes de habilitar Firebase real

- [ ] Verificar en Firebase Console que exista `usuarios/{UID exacto mostrado en Authentication}` para `euforiasalonhn@gmail.com`; asignar desde un entorno confiable `rol: "administrador"`, `rol: "admin"` o `role: "admin"` y un `createdAt` Timestamp si el documento falta. No asignar el rol desde la app.
- [ ] Crear los documentos de negocio/servicios reales: `negocios/{negocioId}` con `nombre`, `activo: true` y `modoNegocio: "unipersonal"` o `"multiEmpleado"`; `servicios/{servicioId}` con `nombre`, `precio` numérico, `duracionMin` entero (5–480) y `activo: true`; y `horarios/{dia}` para cada día (`0` domingo … `6` sábado), con `activo`, `apertura`, `cierre` y `recesos` válidos. No hay datos de negocio inventados.
- [ ] Si se usa `multiEmpleado`, crear las cuentas autorizadas y perfiles `usuarios/{uid}` con `rol: "empleado"`; asociar cada profesional en `negocios/{negocioId}/empleados/{empleadoId}` mediante `usuarioId`, `nombre`, `publica: true` y `activo: true`.
- [ ] Revisar el ID objetivo `euforia-e76a6` y desplegar manualmente `firestore.rules`, `firestore.indexes.json` y Cloud Functions según los comandos del README. Esto aún no se ejecutó y modifica recursos reales; no subir claves privadas ni service-account JSON a la app.
- [ ] Después del despliegue y la configuración real, hacer una validación controlada de login administrador, alta de cliente, perfil visible en vivo y solicitud/aprobación de cita. Esa prueba no se realizó para evitar escrituras no autorizadas en la base compartida.

## Fuera de esta entrega

- [ ] Build APK/EAS no ejecutado; no afirmar que exista un instalador descargable.
- [ ] No integrados envío oficial WhatsApp ni tokens/proceso de autorización FCM.
- [ ] No cubiertos gestión operativa completa de empleados, disponibilidad individual por turno, feriados, cancelación/reprogramación integral, historial completo ni analítica avanzada.
- [ ] Exportación y respaldo de datos siguen sin conectar.
