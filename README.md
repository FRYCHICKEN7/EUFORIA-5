# EUFORIA Beauty Studio

Aplicación móvil Expo Router / React Native / TypeScript para clientes, empleados y administración del salón en Honduras. Firebase Authentication valida correo y contraseña; Firestore conserva perfiles y datos de negocio, y Cloud Functions protegen reservas, cambios de roles y cronometraje.

## Estado y límites de esta entrega

El código implementa login y registro de clientes, perfiles Firebase compatibles con la colección antigua `users` y la colección de app `usuarios`, lista administrativa de clientes, activación de empleados a partir de cuentas existentes, catálogo de servicios con duración, turnos semanales de empleado, cálculo seguro de franjas libres, reservas con control de conflictos, confirmación/rechazo, inicio/final del trabajo y métricas de tiempo real.

En el tema rosado oscuro, la marca EUFORIA y los encabezados sobre el fondo vino usan texto blanco; las tarjetas claras conservan su tipografía oscura. Las instrucciones de Firebase de esta guía son manuales: esta entrega no ejecuta despliegues.

**No se desplegaron** Firestore Rules, índices ni Cloud Functions al Firebase real. Tampoco se escribieron datos de prueba en producción ni se confirmó allí un login, una cita, horarios, servicios o empleados. Las credenciales/variables Firebase se mantienen en la configuración protegida del entorno; no las pegues en el chat ni publiques claves de Admin SDK. El bundle Android de Expo es solo una comprobación de empaquetado: **no es un APK instalable ni un build EAS**.

Los avisos de nuevas solicitudes se guardan en Firestore y aparecen en la agenda de EUFORIA en tiempo real cuando la app escucha la cuenta. No son notificaciones push de Android/iOS: FCM y credenciales nativas no están integrados en esta fase.

## Roles y perfiles

Authentication Email/Password debe estar habilitado. Al registrarse, cada persona —incluido quien posteriormente será empleado— se crea primero como cliente. La app guarda el UID de Authentication como ID del documento y el campo `id`, correo, nombre, teléfono e identidad opcionales, `profileImage` vacío si no hay foto, `role: "cliente"`, `rol: "cliente"` y fecha del servidor. El registro público nunca asigna el rol `empleado` o `admin`.

Para compatibilidad, la sesión lee los documentos propios `users/{uid}`, `usuarios/{uid}` y `empleados/{uid}`. Los perfiles antiguos con `role: "customer"` o `role: "client"` se interpretan como cliente; `role`/`rol` deben coincidir si ambos aparecen. Cuando existen fuentes con roles contradictorios, el acceso se deniega hasta reconciliarlas. El panel **Clientes** une por UID los perfiles reales `users/{uid}` y `usuarios/{uid}`, muestra `email`, `id`, `identityNumber`, `name`, `phone`, `profileImage`, rol y fecha cuando existen, y no inventa valores.

### Preparar una cuenta administradora

1. En Firebase Console abre **Authentication → Users**, localiza la cuenta administradora y copia su UID actual.
2. En Firestore crea/actualiza `users/{UID}` o `usuarios/{UID}` usando **exactamente ese UID como ID del documento**; no basta con un campo `id` dentro de otro documento.
3. Asigna `email` igual al correo de Authentication y `role: "admin"` o `rol: "admin"` (también se admite `administrador`). Si mantienes documentos en ambas colecciones, usa el mismo rol en ambos. Un perfil con UID, correo o roles distintos no se vincula por email de manera automática.
4. Inicia sesión seleccionando **Administrador**. Para más detalles, el UID mostrado por la app debe coincidir carácter por carácter con el UID de Authentication.

La cuenta administradora inicial que se había documentado es `euforiasalonhn@gmail.com`; verifica siempre el UID actual en Authentication, ya que no es fijo.

### Alta segura de empleado

1. La persona se registra desde **Regístrate** usando su correo y contraseña; su rol inicial queda como cliente.
2. Administración abre **Clientes y equipo**, verifica que es la cuenta correcta y selecciona un negocio activo y un código único para el campo `Empleado`.
3. **Crear perfil de empleado** invoca la Cloud Function `crearPerfilEmpleado`. La Function vuelve a comprobar el rol admin, verifica que el UID exista y tenga correo habilitado en Firebase Authentication, comprueba el perfil cliente y el negocio, y luego sincroniza `users/{uid}` y `usuarios/{uid}` con el rol empleado.
4. La Function crea `empleados/{uid}` y `negocios/{negocioId}/empleados/{uid}` con `Empleado`, `email`, `id` igual al UID, `name`, `profileImage`, `role/rol: "empleado"`, `activo: true`, `publica: true` y `disponible: false`. No se agrega una cuenta Auth inventada ni se guarda una contraseña desde administración.
5. El empleado entra por la opción **Empleado**, abre **Mi agenda → Editar mi disponibilidad semanal**, habilita cada día, guarda inicio/fin y marca **Disponible para citas**. Los valores iniciales 08:00–17:00 son solo una sugerencia del formulario y no se escriben hasta guardar.

## Firestore: datos del negocio

No hay precios, servicios, empleados ni horarios de muestra. Antes de aceptar citas, configura datos reales:

```text
negocios/{negocioId}
  nombre: string
  activo: true
  modoNegocio: "unipersonal" | "multiEmpleado"

negocios/{negocioId}/servicios/{servicioId}
  nombre: string
  descripcion: string (opcional)
  precio: number
  duracionMin: integer entre 5 y 480
  activo: true

negocios/{negocioId}/horarios/{dia}
  activo: true
  apertura: "08:00"
  cierre: "17:00"
  recesos: [{ inicio: "12:00", fin: "13:00" }] (opcional)

negocios/{negocioId}/empleados/{uid}
  usuarioId: UID de Authentication
  Empleado: código de empleado
  nombre: string
  activo: true
  publica: true
  disponible: true | false

negocios/{negocioId}/empleados/{uid}/disponibilidad/{dia}
  dia: 0..6
  activo: true | false
  inicio: "08:00"
  fin: "17:00"
```

`dia` es un ID numérico en texto: `0` domingo, `1` lunes, …, `6` sábado. Los horarios del negocio y del empleado son controles diferentes; una franja solo está disponible dentro de ambos. La jornada predeterminada del formulario de empleado es 08:00 a 17:00, como corregiste. El horario del negocio se configura por separado y debe reflejar sus horas reales.

El catálogo se mantiene desde **Resumen → Servicios y tiempos estimados**. Ejemplo: “Corte de Cabello Hombre”, precio L. 120 y `duracionMin: 90`; la app presenta 1 h 30 min. Solo se ofrecen empleados activos, publicados y con la casilla de disponibilidad activa.

## Reserva, agenda y medición

1. El cliente selecciona servicio, fecha, empleado y una hora devuelta por `obtenerDisponibilidad` (callable). El servidor calcula horas en `America/Tegucigalpa`, en incrementos de 15 minutos. No incluye horas pasadas, recesos, ni un servicio que no quepa completo dentro del turno.
2. El cálculo excluye solapamientos del mismo empleado con citas `hold` vigentes, `pendiente_de_aprobacion`, `confirmada` o `en_curso`. Si alguien ocupa el horario después de cargar la lista, `reservarCita` vuelve a comprobarlo dentro de una transacción; ante conflicto rechaza y la app vuelve a cargar las franjas libres.
3. Una nueva solicitud queda como `hold` temporal por 30 minutos y genera un aviso Firestore `nueva_solicitud_cita`. El empleado asignado la recibe en la agenda en vivo y puede confirmar o rechazar. Al confirmar, el estado pasa a `confirmada` y el cliente ve la cita en su propio listener en vivo. `expirarHolds` retira reservas temporales vencidas cada cinco minutos.
4. El empleado asignado pulsa **Inicio de servicio**: Functions registra `startedAt` con la hora del servidor y cambia a `en_curso`. Al pulsar **Servicio finalizado**, registra `completedAt`, cambia a `completada` y calcula `duracionRealMin`. El panel administrativo muestra promedio real y cantidad de trabajos completados por empleado/servicio.

La escritura directa de citas, promociones de rol, disponibilidad y transiciones sensibles está bloqueada en Rules; se hace por Cloud Functions autorizadas. Las consultas de agenda respetan propietario/empleado/admin. `firestore.indexes.json` incluye citas por empleado/cliente y el listener de notificaciones.

## Desplegar Firebase manualmente

No se ejecutó el despliegue. Después de revisar las reglas, el modelo de datos y el proyecto Firebase objetivo `euforia-e76a6`, una persona autorizada puede ejecutar desde la raíz del repo:

```bash
cd functions
pnpm install
pnpm run build
cd ..
firebase deploy --only firestore:rules,firestore:indexes --project euforia-e76a6
firebase deploy --only functions --project euforia-e76a6
```

Estos comandos modifican servicios reales. La tarea no los ejecutó. La Function programada puede requerir Cloud Scheduler, plan Blaze y facturación habilitada; no se necesita pegar un service-account JSON en la app.

## Desarrollo y verificaciones

```bash
pnpm install
pnpm db:push
pnpm check
pnpm lint
pnpm test
pnpm dev

cd functions
pnpm install
pnpm run build
```

Las últimas verificaciones locales: TypeScript, lint sin errores, 35 pruebas unitarias pasaron (1 prueba preexistente se omite), Functions compiló, y Expo pudo exportar bundle Android. Node informó que el runtime local es 22 mientras Functions fija Node 20; no impidió el build. La comprobación final de Rules usa únicamente el emulador local. Metro y el API del starter operan en los puertos 8081 y 3000; el starter gestionado se conserva.

## Pendientes fuera de esta fase

- Desplegar Rules, índices y Functions a Firebase real y verificar el rol del UID autenticado.
- Crear negocio/horarios/servicios reales; promover desde administración las cuentas de empleados registradas como clientes.
- FCM push, gestión de feriados, descansos múltiples y disponibilidad variable por fecha, historial integral, cancelación/reprogramación completa y exportación.
- Build EAS/APK firmado y credenciales nativas.
