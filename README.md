# EUFORIA Beauty Studio

App móvil Expo Router/React Native/TypeScript para clientes y el equipo de EUFORIA Beauty Studio, Honduras. Usa Firebase Authentication y Firestore directamente desde el cliente; las reservas y decisiones privilegiadas se procesan en Cloud Functions.

## Estado de la entrega

La integración de correo/contraseña, registro cliente, perfil automático, recuperación de acceso, cambio de contraseña, lectura en vivo de perfiles de clientes, catálogo real, solicitud transaccional de citas y agenda en tiempo real están implementadas en el código. Las variables públicas de Firebase ya están configuradas y disponibles en el entorno gestionado que se validó; no las envíes por chat.

**Aún no se han desplegado** las reglas, índices ni Cloud Functions al Firebase real. Esta tarea tampoco verificó ni modificó el perfil de administrador en Firestore, ni pobló servicios, profesionales u horarios reales. Por eso no habilites reservas de producción hasta completar “Preparación Firebase” y desplegar los artefactos. No se crearon datos de muestra ni se probó autenticación o reservas escribiendo en la base compartida.

## Inicio de sesión y perfiles

Firebase Authentication debe tener habilitado el proveedor **Correo electrónico/contraseña** (ya estaba habilitado según la configuración entregada). El login ofrece Cliente, Empleado y Administrador; cada opción se valida contra el rol existente en `usuarios/{uid}`. El registro público siempre crea una cuenta cliente y guarda un perfil `usuarios/{uid}` con el mismo UID de Authentication, correo, `rol: "cliente"`, nombre, teléfono opcional y `createdAt` de servidor. El administrador ve esos perfiles nuevos en la pestaña **Clientes** mediante una suscripción en vivo.

El cliente puede pedir un correo de recuperación y cambiar su propia contraseña desde Ajustes → Seguridad. No se guarda ninguna contraseña en Firestore ni en archivos de configuración.

### Preparar el perfil administrador inicial

La cuenta de Authentication existente es `euforiasalonhn@gmail.com`, UID `r4CMfA2NlNWs7CkcJL6G9nKl6va2`. En Firebase Console, después de confirmar que el usuario está presente en Authentication, crea o corrige manualmente —desde un entorno confiable— el documento:

`usuarios/r4CMfA2NlNWs7CkcJL6G9nKl6va2`

con los campos:

```json
{
  "email": "euforiasalonhn@gmail.com",
  "rol": "administrador",
  "createdAt": "Timestamp"
}
```

En Firestore Console, `createdAt` debe ser un valor **Timestamp**, no el texto literal `"Timestamp"`. El acceso administrativo no se puede asignar desde el registro público; las reglas impiden que una persona cambie su rol desde la app. También se acepta `rol: "admin"`.

Para crear personal, primero crea sus cuentas de Authentication por un procedimiento autorizado, y luego asigna en `usuarios/{uid}` `rol: "empleado"`. No hagas el cambio desde el cliente.

## Configuración de Firebase

Los secretos ya configurados en el entorno WebDev son `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`, `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` y `EXPO_PUBLIC_FIREBASE_APP_ID`; `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` es opcional. El proyecto configurado es `euforia-e76a6`. Estos valores son configuración pública de cliente, no una service account ni contraseñas. No publiques claves privadas, JSON de Admin SDK, tokens o contraseñas.

Para desarrollo local, crea un `.env.local` a partir de `.env.example` y completa los valores desde Firebase Console; ese archivo está ignorado por Git. En el entorno WebDev no hace falta crear un archivo `.env`: se leen los secretos del proyecto. La tarjeta Ajustes → Conexión Firebase informa cuando el SDK pudo inicializarse. La presencia de configuración no equivale a una prueba de login contra el Firebase real.

## Datos de negocio necesarios

No se precargan servicios, precios, empleados ni horas ficticias. Antes de aceptar reservas, configura documentos reales:

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
  apertura: "09:00"
  cierre: "18:00"
  recesos: [{ inicio: "12:00", fin: "13:00" }] (opcional)
```

`dia` es un ID de texto numérico: `0` domingo, `1` lunes, …, `6` sábado. Crea para cada día un documento `activo: false` cuando el negocio cierre. El backend interpreta horas en `America/Tegucigalpa`; rechazará citas fuera del horario, durante recesos, en días no habilitados, en el pasado, con servicio inválido o si se cruzan con una cita activa. El catálogo muestra servicios sin inventar datos; un servicio sin duración o precio numéricos no permite solicitar.

En modo `multiEmpleado`, añade:

```text
negocios/{negocioId}/empleados/{empleadoId}
  nombre: string
  usuarioId: "UID de Firebase Authentication" (requerido para agenda de esa persona)
  publica: true
  activo: true
```

Solo personal publicado y activo aparece en el selector de reservas. La cita se asigna a la profesional elegida; su UID queda en `empleadoUid` para autorización y consulta en vivo. El modo `unipersonal` confirma directamente al reservar; en modo multiempleado la reserva entra como `hold` por 30 minutos, visible en la agenda, y el administrador o empleado asignado puede aprobarla o rechazarla. La función programada expira los `hold` vencidos cada 5 minutos. Cada decisión verifica rol, asignación y estado actual en el backend.

## Reglas, índices y Cloud Functions

`firestore.rules` deniega escrituras directas a citas. El cliente solo puede crear su propio perfil con `rol: "cliente"` y leer sus propias citas; el empleado ve solo citas asignadas; el administrador, reconocido por `usuarios/{uid}.rol`, puede leer la agenda y perfiles. El catálogo de servicios es legible por usuarios autenticados y los empleados solo se exponen a clientes cuando `publica: true`. `firestore.indexes.json` incluye las combinaciones usadas por reservas y listeners.

Para desplegar **manualmente** (la tarea no ha desplegado ni modificado el Firebase de producción), usa una cuenta con permisos de Firebase, verifica dos veces el ID del proyecto y ejecuta desde la raíz:

```bash
cd functions
pnpm install
pnpm run build
cd ..
firebase deploy --only firestore:rules,firestore:indexes --project euforia-e76a6
firebase deploy --only functions --project euforia-e76a6
```

El comando `firebase deploy` modifica recursos reales: antes de ejecutarlo, revisa los archivos y confirma que el proyecto mostrado es `euforia-e76a6`. La función programada usa Cloud Scheduler y la publicación de Cloud Functions puede requerir el plan Firebase Blaze y facturación habilitada. No es necesario descargar ni pegar una clave service account en la app.

## Desarrollo y validaciones realizadas

En la raíz del proyecto:

```bash
pnpm install
pnpm db:push
pnpm check
pnpm lint
pnpm dev

cd functions
pnpm install
pnpm run build
```

`pnpm db:push` informó que no había cambios de esquema. En este entorno, `pnpm check`, `pnpm lint` y la compilación TypeScript de Cloud Functions finalizaron correctamente; las Rules compilaron en el emulador local de Firestore, sin desplegarlas. Metro respondió `200` en `8081` y su endpoint `/status` indicó `packager-status:running`; el proceso API quedó escuchando en `3000`. Metro notificó un warning no bloqueante de estilos `shadow*`, y las Functions un warning de que este equipo usa Node 22 mientras su runtime está fijado en Node 20. El bundle Preview no prueba autenticación real, no acredita despliegue de Rules/Functions ni valida FCM, credenciales nativas o un APK. No se afirma haber generado un APK EAS.

## Lo que todavía no está conectado

La pantalla Avisar explica que no envía mensajes: WhatsApp oficial y envío FCM no están integrados. También siguen fuera de esta entrega la disponibilidad individual por profesional, feriados, cancelación/reprogramación completa, historial integral y analítica completa. No se simulan esos comportamientos.
