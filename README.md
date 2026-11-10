# EUFORIA Beauty Studio

Aplicación móvil Expo Router / React Native / TypeScript para clientes, empleados y administración del salón en Honduras. Firebase Authentication valida correo y contraseña; Firestore conserva perfiles y datos de negocio, y Cloud Functions protegen reservas, cambios de roles y cronometraje.

## Estado y límites de esta entrega

El código implementa inicio y registro de clientes, perfiles compatibles con `users` y `usuarios`, solicitudes de ingreso de empleados con decisión administrativa **Aceptar/Rechazar**, separación de aspirantes y clientes, creación administrativa de cuentas cliente con contraseña provisional y cambio obligatorio en el primer acceso, catálogo de servicios con duración y periodos de regreso, turnos semanales, disponibilidad segura, reservas sin solapamientos, medición de servicios, recordatorios de WhatsApp preparados manualmente y copias locales para el teléfono.

En el tema rosado oscuro, la marca EUFORIA y los encabezados sobre el fondo vino usan texto blanco; las tarjetas claras conservan su tipografía oscura. Las instrucciones de Firebase de esta guía son manuales: esta entrega no ejecuta despliegues.

**No se desplegaron** Firestore Rules, índices ni Cloud Functions al Firebase real. Tampoco se escribieron datos de prueba en producción ni se confirmó allí un login, una cita, horarios, servicios o empleados. Las credenciales se mantienen en la configuración protegida del entorno; no las pegues en el chat ni publiques claves de Admin SDK. El bundle Android de Expo es solo una comprobación de empaquetado: **no es un APK instalable ni un build EAS**.

Los avisos de citas/servicios se guardan para cliente, empleado asignado y administración y el código incluye registro de avisos al teléfono desde `enviarPushExpo`. La entrega push real en segundo plano sigue pendiente de asociar un proyecto EAS, configurar credenciales nativas Android/iOS, compilar la aplicación y desplegar Rules/Functions manualmente; no se simuló una entrega.

## Roles y perfiles

Authentication Email/Password debe estar habilitado. Al registrarse, cada persona —incluido quien posteriormente será empleado— se crea primero como cliente. La app guarda el UID de Authentication como ID del documento y el campo `id`, correo, nombre, teléfono obligatorio (ocho dígitos hondureños o formato internacional con `+`), cumpleaños opcional como `birthdayDay` y `birthdayMonth`, `profileImage` vacío si no hay foto, `role: "cliente"`, `rol: "cliente"` y fecha del servidor. No solicita ni guarda número de identidad. El registro público nunca asigna el rol `empleado` o `admin`.

Los perfiles históricos podrían conservar un valor guardado antes de retirar el dato de identidad; el código ya no lo solicita ni lo presenta y las reglas rechazan que se vuelva a agregar al editar el perfil. No se borraron datos reales; una limpieza retroactiva requiere respaldo y migración manual.

Para compatibilidad, la sesión lee los documentos propios `users/{uid}`, `usuarios/{uid}` y `empleados/{uid}`. Los perfiles antiguos con `role: "customer"` o `role: "client"` se interpretan como cliente; `role`/`rol` deben coincidir si ambos aparecen. Cuando existen fuentes con roles contradictorios, el acceso se deniega hasta reconciliarlas. El panel **Clientes** une los perfiles `users/{uid}` y `usuarios/{uid}` por su ID interno, muestra correo, nombre, teléfono y cumpleaños cuando existen, mantiene ocultos los identificadores técnicos y excluye a cualquier persona que tenga un documento en `empleados/{uid}`, sin importar si su solicitud está pendiente, rechazada o aprobada. No muestra el campo de identidad.

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

En la tarjeta de un cliente con número válido, administración puede tocar **WhatsApp**. Para un número hondureño de ocho dígitos se abre `https://wa.me/504XXXXXXXX`; si ya contiene `504` se conserva, y un número internacional con `+` se normaliza a solo dígitos. El botón abre el chat para que administración revise y decida enviar; no conecta WhatsApp Business y no manda mensajes automáticamente.

### Recordatorios preparados por administración

La pantalla **Avisar por WhatsApp** reúne citas confirmadas, regresos recomendados y cumpleaños del día. El aviso de cita queda habilitado por defecto **73 horas antes** y administración puede ajustar el plazo. También puede editar el texto para cada tipo; la pantalla ofrece botones para insertar datos del perfil, la cita, el servicio o el negocio. Los textos y el plazo se guardan en `negocios/{negocioId}.configuracionRecordatoriosWhatsApp`.

Los perfiles nuevos aceptan estos avisos por defecto; los perfiles antiguos sin la preferencia también se consideran habilitados. Cada cliente puede pausarlos desde su catálogo. Solo se preparan avisos para citas confirmadas; una cancelación o cambio de horario actualiza el registro anterior. El aviso de regreso parte de `completedAt` y de la configuración del servicio; si no hay periodo de regreso, no se crea. Los cumpleaños usan el día y mes del perfil, sin año de nacimiento. A las personas que cumplen el 29 de febrero se les recuerda el 28 de febrero en años no bisiestos.

Los registros se guardan una sola vez en `recordatoriosWhatsApp` con estados `pendiente`, `preparado`, `enviado`, `omitido` o `cancelado`. Abrir WhatsApp no confirma que el mensaje se envió; administración debe marcar **Confirmar envío** después de enviarlo desde el teléfono. No se abre WhatsApp ni se envía ningún mensaje de manera automática, desde una tarea programada o desde la vista previa.

Al solicitar una cita se registra un aviso dentro de la app para el cliente, el profesional asignado y administración. La recepción como aviso push con la app cerrada requiere tokens de dispositivo y credenciales nativas configuradas; no está comprobada hasta probarla en teléfonos con el build correspondiente.

### Copia local en el teléfono

Desde **Ajustes → Copias de seguridad**, administración puede guardar una copia de negocio con perfiles, servicios, horarios, equipo, clientes, citas y avisos. En Android se elige una carpeta del teléfono; en iPhone se abre la hoja del sistema y se elige **Guardar en Archivos**. La app no sube la copia a un servidor y excluye identidad, contraseñas, claves y tokens de notificación. Protege el archivo como información privada del salón. La restauración no forma parte de esta opción.

### Notificaciones por cuenta y preparación Expo Push

Cliente, empleado y administrador tienen campana común, centro personal en tiempo real y tarjeta para autorizar notificaciones. El permiso se solicita solo en dispositivo móvil nativo; cada token se guarda en `usuarios/{uid}/dispositivos/{deviceId}` y cada registro nuevo en `notificaciones` activa la Function `enviarPushExpo`. La Function solicita a Expo Push entregar el título/cuerpo existente al dispositivo destinatario y deshabilita tokens que Expo informa como no registrados; un ticket aceptado no equivale por sí solo a confirmación de entrega al teléfono.

Para recibir avisos con la app cerrada, una persona administradora del proyecto debe completar **manualmente** estos pasos:

1. Asociar esta app con un proyecto Expo/EAS y obtener el `projectId`.
2. Definir `EXPO_PUBLIC_EAS_PROJECT_ID=<projectId>` en el entorno de build EAS; `app.config.ts` lo expone como `extra.eas.projectId` para obtener tokens Expo Push.
3. Configurar las credenciales push del proyecto EAS: Firebase Cloud Messaging V1 para Android y una clave APNs válida para iOS. Si el build requiere `google-services.json` o `GoogleService-Info.plist`, colócalos localmente en la raíz del proyecto o como archivos de credencial de build; están ignorados por Git y no se incluyen en el ZIP.
4. Generar un nuevo development/release build nativo con el plugin `expo-notifications`; Expo Go/Web Preview no validan la recepción remota nativa.
5. Revisar y desplegar las Rules y Functions nuevas en Firebase según la sección de despliegue manual. Después, autorizar permisos en cada teléfono y comprobar tickets/recepción con cuentas de cliente, empleado y administración.

Mientras falte cualquiera de estos requisitos, la interfaz identifica el estado pendiente y la bandeja Firestore continúa siendo la fuente de avisos dentro de EUFORIA. No se desplegaron reglas ni funciones en esta tarea.

### Solicitud y aprobación de empleado

1. Desde el engranaje de la pantalla de acceso, la persona elige **Empleado → Registrarse como empleado** y completa los datos de la cuenta. Se crea primero un perfil cliente y se envía una solicitud; el perfil no obtiene acceso al área del equipo mientras esté pendiente.
2. **Clientes y equipo** ofrece las pestañas **Clientes** y **Empleados**. En **Empleados** se muestran por separado las solicitudes pendientes y los empleados aceptados. Administración solo puede **Aceptar** o **Rechazar** solicitudes; ya no registra empleados ni asigna códigos manualmente.
3. Las funciones verifican el rol administrativo y la solicitud. Si se acepta, se asigna el único negocio activo; si no existe, se crea **EUFORIA Beauty Studio** activo. Si hay varios negocios activos, la aceptación se detiene para evitar asignar al negocio equivocado. El rol empleado y la membresía del negocio se guardan únicamente después de aceptar.
4. Un rechazo conserva la cuenta y los perfiles con rol cliente. La solicitud queda marcada como rechazada y no permite abrir agenda ni administrar disponibilidad.
5. El empleado aceptado entra por **Empleado → Mi agenda → Editar mi disponibilidad semanal**, habilita los días, guarda su horario y activa **Disponible para citas**. Los valores iniciales 08:00–17:00 son una sugerencia del formulario y no se escriben hasta guardar.

Si el primer intento creó la cuenta pero no completó la solicitud, **no vuelvas a crear otra cuenta ni cambies el perfil a empleado a mano**. En la app actual, inicia sesión desde el engranaje como **Empleado** con ese mismo correo y contraseña; si la cuenta sigue con perfil cliente y no tiene solicitud, la app la envía de nuevo. También puedes volver al registro de empleado con el mismo correo: la app verifica la contraseña de la cuenta existente y reintenta sin sobrescribir el perfil. La solicitud pendiente se devuelve como existente para no duplicarla. Si no puede enviar la solicitud, administración debe confirmar que las funciones actualizadas estén desplegadas; el archivo `empleados/{uid}` se crea solo al completar la solicitud. Las solicitudes rechazadas permanecen en `empleados/{uid}` para que esa persona no aparezca como cliente.

### Crear cuentas de clientes con contraseña provisional

Desde **Clientes y equipo → Clientes → Crear cliente**, administración ingresa nombre, correo, teléfono hondureño o internacional, cumpleaños opcional y una contraseña provisional de al menos 8 caracteres. El servidor crea la cuenta y los perfiles `users/{uid}` y `usuarios/{uid}` con el mismo UID y rol cliente. La contraseña solo se usa para crear la cuenta de acceso: no se guarda en Firestore, en las copias ni en registros. Se muestra a administración solo mientras el formulario sigue abierto para poder entregarla de forma privada. Al entrar por primera vez, el cliente debe escribir la contraseña actual, elegir otra y confirmarla; hasta completar el cambio, todas las pantallas de cliente lo devuelven a esa acción. Si la contraseña se actualizó pero la conexión se interrumpió antes de terminar, el cliente puede volver a intentar usando como actual la última que eligió. Después puede cambiar su contraseña desde el botón **Cambiar contraseña** del catálogo. El campo `mustChangePassword` solo lo administra el servidor y las reglas actuales impiden que el cliente lo cambie directamente.

## Firestore: datos del negocio

No hay precios, servicios, empleados ni horarios de muestra. Antes de aceptar citas, configura datos reales:

```text
negocios/{negocioId}
  nombre: string
  activo: true
  modoNegocio: "unipersonal" | "multiEmpleado"
  configuracionRecordatoriosWhatsApp:
    horasAntesCita: 73 (valor inicial)
    plantillas: { cita, regreso, cumpleanos }

negocios/{negocioId}/servicios/{servicioId}
  nombre: string
  descripcion: string (opcional)
  precio: number
  duracionMin: integer entre 5 y 480
  activo: true
  recordatorioRegresoActivo: boolean
  periodoRegresoDias: integer opcional
  anticipacionRecordatorioDias: integer opcional

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
3. Una nueva solicitud queda como `hold` temporal por 30 minutos y genera avisos en la app al cliente, al empleado asignado y a todos los administradores válidos. El empleado la recibe en la agenda y puede confirmar o rechazar. Al confirmar, el estado pasa a `confirmada`, el cliente ve la cita en su propio listener y se programa el recordatorio. `expirarHolds` retira reservas temporales vencidas cada cinco minutos. La notificación push con la app cerrada depende de la configuración descrita arriba.
4. El empleado asignado pulsa **Inicio de servicio**: Functions registra `startedAt` con la hora del servidor y cambia a `en_curso`. Al pulsar **Servicio finalizado**, registra `completedAt`, cambia a `completada` y calcula `duracionRealMin`. El panel administrativo muestra promedio real y cantidad de trabajos completados por empleado/servicio.

La escritura directa de citas, decisiones de solicitudes de empleado, disponibilidad y estados del historial está bloqueada por las reglas; se hace mediante funciones autorizadas. Las consultas de agenda respetan cliente/empleado/administración. `firestore.indexes.json` incluye índices de citas, avisos, cumpleaños y sincronización de servicios.

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

# 4. Publicar las funciones, incluidos los flujos de empleado, recordatorios y avisos
firebase deploy --project euforia-e76a6 --only functions

# Si se necesita actualizar solo el flujo de solicitudes y las nuevas funciones de clientes
firebase deploy --project euforia-e76a6 --only functions:solicitarPerfilEmpleado,functions:crearCuentaCliente,functions:cambiarContrasenaProvisional
```

Esta mejora no añade índices ni requiere cambiar Rules: las reglas existentes ya permiten que administración lea `empleados` y bloquean al cliente cambiar los campos que solo escribe el servidor. Para corregir el registro fallido anterior y habilitar las cuentas provisionales, despliega las tres funciones indicadas o todas las Functions. Estos comandos modifican recursos reales. La tarea no los ejecutó ni escribió datos en producción. La función programada puede requerir Cloud Scheduler, plan Blaze y facturación habilitada; no se necesita pegar claves de Admin SDK en la aplicación.

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

Las verificaciones locales de esta entrega: TypeScript y lint sin errores, 49 pruebas unitarias pasaron (1 prueba previa se omite), Functions compiló y Expo exportó el bundle Android HBC y 19 rutas Web estáticas. Esos bundles no generan APK/EAS ni prueban guardado local, WhatsApp o avisos nativos en un teléfono. Firestore Emulator arrancó bajo el proyecto de demostración `demo-euforia`, sin conectar con producción. Node informó que el runtime local es 22 mientras Functions fija Node 20; no impidió la compilación. No se hicieron despliegues ni escritura de datos reales.

## Pendientes fuera de esta fase

- Desplegar manualmente Rules, índices y Functions a Firebase real y verificar la solicitud/aceptación/rechazo con cuentas reales; no se ha desplegado ningún recurso desde esta tarea.
- Asociar proyecto EAS, configurar FCM V1/APNs, credenciales nativas y build firmado para que push llegue al teléfono con la app cerrada.
- Crear negocio/horarios/servicios reales; los empleados deben enviar solicitud y administración aceptarla para activar su rol.
- Gestión de feriados, descansos múltiples, disponibilidad variable por fecha y restauración de copias.
- Probar permisos push, almacenamiento local y apertura/confirmación manual de WhatsApp en un dispositivo físico; la exportación web no verifica funciones nativas.
