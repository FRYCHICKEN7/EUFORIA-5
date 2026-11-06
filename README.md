# EUFORIA Beauty Studio

Aplicación móvil Expo Router / React Native / TypeScript para clientes, empleados y administración del salón en Honduras. Firebase Authentication valida correo y contraseña; Firestore conserva perfiles y datos de negocio, y Cloud Functions protegen reservas, cambios de roles y cronometraje.

## Estado y límites de esta entrega

El código implementa login y registro de clientes, perfiles Firebase compatibles con la colección antigua `users` y la colección de app `usuarios`, lista administrativa de clientes, activación de empleados a partir de cuentas existentes, catálogo de servicios con duración, turnos semanales de empleado, cálculo seguro de franjas libres, reservas con control de conflictos, confirmación/rechazo, inicio/final del trabajo y métricas de tiempo real.

En el tema rosado oscuro, la marca EUFORIA y los encabezados sobre el fondo vino usan texto blanco; las tarjetas claras conservan su tipografía oscura. Las instrucciones de Firebase de esta guía son manuales: esta entrega no ejecuta despliegues.

**No se desplegaron** Firestore Rules, índices ni Cloud Functions al Firebase real. Tampoco se escribieron datos de prueba en producción ni se confirmó allí un login, una cita, horarios, servicios o empleados. Las credenciales se mantienen en la configuración protegida del entorno; no las pegues en el chat ni publiques claves de Admin SDK. El bundle Android de Expo es solo una comprobación de empaquetado: **no es un APK instalable ni un build EAS**.

Los avisos de citas/servicios se guardan en Firestore para cliente, empleado y administración y el código incluye registro de Expo Push y envío desde `enviarPushExpo`. La entrega push real en segundo plano sigue pendiente de asociar un proyecto EAS, configurar credenciales nativas Android/iOS, compilar la aplicación y desplegar Rules/Functions manualmente; no se simuló una entrega.

## Roles y perfiles

Authentication Email/Password debe estar habilitado. Al registrarse, cada persona —incluido quien posteriormente será empleado— se crea primero como cliente. La app guarda el UID de Authentication como ID del documento y el campo `id`, correo, nombre, teléfono obligatorio (ocho dígitos hondureños o formato internacional con `+`), cumpleaños opcional como `birthdayDay` y `birthdayMonth`, `profileImage` vacío si no hay foto, `role: "cliente"`, `rol: "cliente"` y fecha del servidor. No solicita ni guarda número de identidad. El registro público nunca asigna el rol `empleado` o `admin`.

Los perfiles históricos podrían conservar un valor guardado antes de retirar el dato de identidad; el código ya no lo solicita ni lo presenta y las reglas rechazan que se vuelva a agregar al editar el perfil. No se borraron datos reales; una limpieza retroactiva requiere respaldo y migración manual.

Para compatibilidad, la sesión lee los documentos propios `users/{uid}`, `usuarios/{uid}` y `empleados/{uid}`. Los perfiles antiguos con `role: "customer"` o `role: "client"` se interpretan como cliente; `role`/`rol` deben coincidir si ambos aparecen. Cuando existen fuentes con roles contradictorios, el acceso se deniega hasta reconciliarlas. El panel **Clientes** une los perfiles `users/{uid}` y `usuarios/{uid}` por su ID interno, muestra correo, nombre, teléfono y cumpleaños cuando existen, y mantiene ocultos los identificadores técnicos. No muestra el campo de identidad.

### Preparar una cuenta administradora

1. En Firebase Console abre **Authentication → Users**, localiza la cuenta administradora y copia su UID actual.
2. En Firestore crea/actualiza `users/{UID}` o `usuarios/{UID}` usando **exactamente ese UID como ID del documento**; no basta con un campo `id` dentro de otro documento.
3. Asigna `email` igual al correo de Authentication y `role: "admin"` o `rol: "admin"` (también se admite `administrador`). Si mantienes documentos en ambas colecciones, usa el mismo rol en ambos. Un perfil con UID, correo o roles distintos no se vincula por email de manera automática.
4. En la pantalla de acceso toca el engranaje, elige **Administrador** e inicia sesión. Para más detalles, el UID vinculado debe coincidir carácter por carácter con el UID de Authentication.

La cuenta administradora inicial que se había documentado es `euforiasalonhn@gmail.com`; verifica siempre el UID actual en Authentication, ya que no es fijo.

### Acceso oculto y huella

La pantalla inicial muestra el acceso de cliente. El selector de administración/empleado aparece al tocar el engranaje. Esto solo cambia la opción visual del formulario: el rol efectivo sigue leyéndose y validándose contra el perfil Firestore vinculado al UID; el selector no concede permisos.

Después de autenticar por correo/contraseña, cada perfil puede activar biometría en su dispositivo si tiene huella/Face ID configurados. La preferencia se almacena de forma segura por UID y pide la biometría para desbloquear la sesión Firebase ya persistida, incluso cuando se vuelve a EUFORIA desde segundo plano. No almacena la contraseña ni los datos biométricos, y la huella **no reemplaza** el login de Firebase después de cerrar sesión; en ese caso se vuelve a ingresar con correo y contraseña.

### WhatsApp manual

En la tarjeta de un cliente con número válido, administración puede tocar **WhatsApp**. Para un número hondureño de ocho dígitos se abre `https://wa.me/504XXXXXXXX`; si ya contiene `504` se conserva, y un número internacional con `+` se normaliza a solo dígitos. El botón abre el chat para que la persona redacte y decida enviar; no conecta WhatsApp Business, no manda mensajes automáticamente y no crea mensajes preescritos.

### Notificaciones por cuenta y preparación Expo Push

Cliente, empleado y administrador tienen campana común, centro personal en tiempo real y tarjeta para autorizar notificaciones. El permiso se solicita solo en dispositivo móvil nativo; cada token se guarda en `usuarios/{uid}/dispositivos/{deviceId}` y cada registro nuevo en `notificaciones` activa la Function `enviarPushExpo`. La Function solicita a Expo Push entregar el título/cuerpo existente al dispositivo destinatario y deshabilita tokens que Expo informa como no registrados; un ticket aceptado no equivale por sí solo a confirmación de entrega al teléfono.

Para recibir avisos con la app cerrada, una persona administradora del proyecto debe completar **manualmente** estos pasos:

1. Asociar esta app con un proyecto Expo/EAS y obtener el `projectId`.
2. Definir `EXPO_PUBLIC_EAS_PROJECT_ID=<projectId>` en el entorno de build EAS; `app.config.ts` lo expone como `extra.eas.projectId` para obtener tokens Expo Push.
3. Configurar las credenciales push del proyecto EAS: Firebase Cloud Messaging V1 para Android y una clave APNs válida para iOS. Si el build requiere `google-services.json` o `GoogleService-Info.plist`, colócalos localmente en la raíz del proyecto o como archivos de credencial de build; están ignorados por Git y no se incluyen en el ZIP.
4. Generar un nuevo development/release build nativo con el plugin `expo-notifications`; Expo Go/Web Preview no validan la recepción remota nativa.
5. Revisar y desplegar las Rules y Functions nuevas en Firebase según la sección de despliegue manual. Después, autorizar permisos en cada teléfono y comprobar tickets/recepción con cuentas de cliente, empleado y administración.

Mientras falte cualquiera de estos requisitos, la interfaz identifica el estado pendiente y la bandeja Firestore continúa siendo la fuente de avisos dentro de EUFORIA. No se desplegaron reglas ni funciones en esta tarea.

### Alta segura de empleado

1. La persona se registra desde **Regístrate** usando su correo y contraseña; su rol inicial queda como cliente.
2. Administración abre **Clientes y equipo**, verifica que es la cuenta correcta, elige un negocio activo y escribe un código válido. Si todavía no existe un negocio activo, puede crearlo desde esa misma pantalla como **EUFORIA Beauty Studio**; si hay uno solo, se elige automáticamente.
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

La escritura directa de citas, promociones de rol, disponibilidad y transiciones sensibles está bloqueada por las reglas; se hace mediante funciones autorizadas. Las consultas de agenda respetan cliente/empleado/administración. `firestore.indexes.json` incluye el índice de cliente e inicio, agendas por profesional y el listener de avisos.

## Desplegar Firebase manualmente

No se ejecutó ningún despliegue. Después de revisar Rules, índices y Functions, una persona autorizada puede ejecutar desde la raíz del repositorio. El ID de proyecto incluido en cada comando evita depender de un alias local:

```bash
# 1. Construir las funciones localmente antes de subirlas
cd functions
pnpm install --frozen-lockfile
pnpm run build
cd ..

# 2. Publicar las reglas de seguridad
firebase deploy --project euforia-e76a6 --only firestore:rules

# 3. Publicar los índices compuestos, incluido citas (clienteId ASC, inicio ASC)
firebase deploy --project euforia-e76a6 --only firestore:indexes

# 4. Publicar todas las funciones, incluida prepararNegocioInicial
firebase deploy --project euforia-e76a6 --only functions
```

Estos comandos modifican recursos reales. La tarea no los ejecutó ni escribió datos en producción. La función programada puede requerir Cloud Scheduler, plan Blaze y facturación habilitada; no se necesita pegar claves de Admin SDK en la aplicación.

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

Las verificaciones locales de esta actualización: TypeScript y lint sin errores, 43 pruebas unitarias pasaron (1 prueba preexistente se omite), Functions compiló y Expo exportó el bundle Android HBC y 19 rutas Web estáticas. Esos bundles no generan APK/EAS ni verifican notificaciones/biometría en un dispositivo. Las Rules nuevas iniciaron en Firestore Emulator con el proyecto `demo-euforia` (sin conexión a Firebase real). Node informó que el runtime local es 22 mientras Functions fija Node 20; no impidió el build. Metro y el API del starter operan en los puertos 8081 y 3000; el starter gestionado se conserva.

## Pendientes fuera de esta fase

- Desplegar manualmente Rules, índices y Functions a Firebase real y verificar el rol del UID autenticado; la Function `prepararNegocioInicial`, la promoción de empleado y `enviarPushExpo` no se han desplegado.
- Asociar proyecto EAS, configurar FCM V1/APNs, credenciales nativas y build firmado para que push llegue al teléfono con la app cerrada.
- Crear negocio/horarios/servicios reales; promover desde administración las cuentas de empleados registradas como clientes.
- Gestión de feriados, descansos múltiples y disponibilidad variable por fecha, historial integral, cancelación/reprogramación completa y exportación.
- Probar biometría, permisos push y enlaces en un dispositivo físico después del build nativo; el preview web no verifica módulos nativos.
