# Plan de implementación: EUFORIA Beauty Studio

## Alcance aprobado

Trasladar selectivamente la app móvil EUFORIA desde `FRYCHICKEN7/euforia-beauty-studio` al nuevo starter móvil gestionado autorizado por la usuaria. Mantener Expo Router, React Native, TypeScript, la navegación y el runtime del starter; preservar el logo y los estilos EUFORIA. La entrega incluye inicio/registro y recuperación con Firebase Authentication, perfiles vinculados al UID, roles seguros, catálogo Firebase, reserva de citas mediante Cloud Functions y visualización de citas en vivo por cliente, administración y personal autorizado. Las cuatro pestañas administrativas son Resumen, Clientes, Avisar y Ajustes. No crear contenido de demostración.

No desplegar Rules, índices ni Functions a Firebase; no escribir en la base real, cambiar GitHub fuente ni afirmar un APK sin build EAS comprobable. El proyecto gestionado se guarda en el historial/checkpoint Manus del proyecto nuevo. La conexión de configuración Firebase está presente en el entorno gestionado validado, pero no equivale a una prueba de acceso real.

## Arquitectura y responsabilidades

- `app/` mantiene las rutas de acceso, recuperación/cambio de contraseña, redirección por sesión/rol, catálogo y citas del cliente, calendario del empleado y tabs del administrador. Los estados vacíos y errores describen el estado real; no simular reservas ni envíos.
- `components/` y `constants/` contienen encabezado, controles, iconografía y tokens visuales. `assets/images/` conserva icono, splash, favicon y variantes adaptativas con margen de seguridad.
- `lib/firebase.ts` inicializa Firebase desde `EXPO_PUBLIC_FIREBASE_*`. `lib/firebase-auth-adapter.ts` y su variante `.native.ts` integran Authentication web/nativo y persistencia; `lib/auth-session.tsx` observa sesión y perfil; `lib/appointments.ts` limita el acceso de UI a catálogo, listeners y funciones callable. Las variables de cliente son configuración pública, no credenciales administrativas.
- `functions/src/index.ts` es backend TypeScript con Firebase Admin. `reservarCita` obtiene al cliente desde `request.auth.uid`, valida perfil `cliente`, negocio/servicio/profesional activo, modo de negocio, precio/duración y fecha, verifica horas/recesos en `America/Tegucigalpa` y crea la cita transaccionalmente sin solapamiento. `aprobarCita`/`rechazarCita` exigen perfil `admin`/`administrador` o empleado asociado a la cita y transición permitida. Las reservas multiempleado quedan en `hold` 30 minutos; `expirarHolds` las vence por tarea programada.
- `firestore.rules` deniega por defecto, impide autoasignar roles y escrituras directas inseguras de citas/avisos. Un cliente puede leer su perfil y sus citas; un empleado consulta solo asignaciones propias; el administrador autorizado observa la agenda. Los listeners usan filtros compatibles con las reglas.
- `firestore.indexes.json` cubre consultas de clientes, agenda, citas por empleado/negocio y expiración temporal. `firebase.json`, `firestore.rules`, índices y Functions quedan entregados para despliegue manual por la propietaria, no desplegados por esta tarea.
- `README.md` indica variables requeridas, UID/rol admin, estructura de negocio y horarios, pasos de despliegue manual y funciones aún no incluidas. `TODO.md` separa código implementado, verificaciones realizadas y acciones que requieren Firebase real.

## Roles y esquema

Los perfiles se guardan en `usuarios/{uid}` con UID igual al de Firebase Authentication, `email`, `rol`, `createdAt`, y nombre/teléfono opcionales. El registro público crea exclusivamente `rol: "cliente"`; no puede establecer `admin`, `administrador`, `empleado` ni permisos. El selector de acceso presenta Cliente, Empleado y Administrador y valida el rol observado. La cuenta administrativa existente es `euforiasalonhn@gmail.com`, UID `r4CMfA2NlNWs7CkcJL6G9nKl6va2`; si falta el documento, la propietaria asigna `rol: "administrador"` o `"admin"` desde un entorno confiable.

El negocio vive en `negocios/{negocioId}` con `modoNegocio`, y subcolecciones `servicios`, `empleados` y `horarios`. No se agregan servicios, precios, personal ni horarios hasta que existan datos reales. Las citas viven en `citas/{citaId}` con `negocioId`, `clienteId`, empleado opcional y UID asociado, servicio, inicio/fin, precio/duración validados, modo, estado y marcas de tiempo. Los estados reconocidos son `hold`, `pendiente_de_aprobacion`, `confirmada`, `en_curso`, `completada`, `cancelada`, `rechazada` y `expirada`. El backend no confía en rol, duración, precio, pertenencia ni UID enviados sin validar.

## Diseño conservado

- **Movimiento:** boutique de belleza premium con composición editorial, fondo blanco cálido, rosa rubor, vino profundo y acento dorado discreto.
- **Principios:** lectura rápida, superficies limpias, controles amplios y cómodos con una mano, estados operativos explícitos y datos reales.
- **Color:** fondo `#FFF5F7`, superficies `#FFFFFF`, acción `#D85C7A`, vino/texto `#5C1A2E`, rosa suave `#FCE8EE` y verde WhatsApp `#25D366`; modo claro y rosado oscuro.
- **Layout y firma:** header EUFORIA con logo y saludo, tarjetas de bordes suaves, chips tipo píldora, métricas/listas y navegación inferior ligera. Estados vacíos indican cuándo faltan datos reales.
- **Interacción:** feedback inmediato, errores accionables, protección ante acciones no autorizadas y confirmación de cambios de cita.
- **Tipografía y voz:** sans serif del sistema, jerarquía en pesos 700–800, controles legibles; tono cálido, premium y directo, con mensajes como “Tu próxima visita empieza aquí”.
- **Logo:** imagen existente preservada para launcher/splash/favicons sin recortar texto ni rostro y con área segura para máscaras de Android.

## Estructura del proyecto

- `app/`: pantallas Expo Router `auth.tsx`, `index.tsx`, `client/catalog.tsx`, `employee/schedule.tsx`, `(tabs)/index.tsx`, `(tabs)/clients.tsx`, `(tabs)/notify.tsx`, `(tabs)/settings.tsx` y `change-password.tsx`.
- `components/`: `app-header`, `auth-gate`, botones, tarjetas y avisos compartidos.
- `constants/`: `brand.ts` y tokens de tema.
- `lib/`: Firebase, adaptadores Auth nativo/web, proveedor de sesión, repositorios Firestore/Functions y formato de lempira.
- `functions/`: Functions callable y programada en TypeScript con Firebase Admin.
- `assets/images/`: logo e iconografía; `firebase.json`, `firestore.rules` e `firestore.indexes.json`: configuración Firebase a desplegar externamente.
- `README.md`, `TODO.md`, `plan.md`: instrucciones y registro de estado.

## Entorno y validación

Mantener los listeners fijos del starter en Expo/Metro `8081` y API `3000`. Evitar escrituras de prueba en la base compartida. En el entorno gestionado terminaron correctamente `pnpm check`, `pnpm lint`, build TypeScript de Functions y compilación local de reglas con el emulador Firestore; `pnpm db:push` indicó que no había cambios de esquema. Metro respondió `200` y `/status` informó que el packager estaba activo; el API escuchó en su puerto. No se probaron credenciales contra Firebase real. Las rules y functions deben desplegarse manualmente, y la primera prueba real requiere perfil admin, datos/horarios y una revisión del proyecto `euforia-e76a6`. Un APK se considera inexistente hasta completar un build EAS real.
