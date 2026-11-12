# EUFORIA Beauty Studio

Aplicación móvil Expo/React Native en español para clientes, empleados y administración de un salón en Honduras. Usa Firebase Authentication y Firestore con reglas, transacciones cliente y zona horaria `America/Tegucigalpa`. La interfaz presenta precios en lempiras (L.). El código de Functions anterior se conserva únicamente en `functions-legacy/` como referencia y no está conectado a la app ni a `firebase.json`.

## Qué hace esta versión

- Los clientes pueden registrarse con correo, contraseña y teléfono; empleados envían una solicitud separada y esperan la aceptación administrativa. Los roles se validan desde el perfil ligado al UID de Authentication.
- Administración puede crear clientes desde una sesión secundaria de Authentication, consultar los perfiles permitidos y administrar servicios, empleados, horarios y respaldos locales. Las contraseñas no se guardan en Firestore ni en copias.
- Los empleados guardan sus siete turnos semanales y su disponibilidad para el negocio al que pertenecen.
- El cliente ve los servicios y horarios disponibles sin leer citas, correos ni teléfonos de otras personas. La app usa Honduras como zona horaria y calcula intervalos de 15 minutos según la duración del servicio.
- Una reserva se prepara en dos pasos de Firestore: una cita privada y luego la confirmación junto con los bloqueos necesarios. Reglas verifican los datos, la agenda abierta y la ocupación; una cita de hasta ocho horas ocupa los bloques correspondientes. Administración o el profesional asignado puede aceptar o rechazar. Rechazar mantiene el horario ocupado hasta que se retiren los bloqueos propios.
- La agenda permite iniciar y terminar servicios y muestra una duración calculada con la hora del dispositivo. No es una medición de reloj de servidor.
- Antes de abrir reservas directas en un negocio existente, administración debe usar **Ajustes → Preparar agenda**. La herramienta revisa las citas futuras, detecta información inválida o solapamientos, copia solo ocupación neutra a los bloqueos y vuelve a abrir reservas únicamente si todo termina correctamente. Repetir el proceso es seguro.
- Los avisos creados por la app se consultan dentro de EUFORIA mientras está abierta y conectada. **No se envían notificaciones al teléfono con la app cerrada**: ese envío requiere un servidor y no forma parte de este modo Spark.
- **Avisar por WhatsApp** calcula oportunidades al abrir la pantalla; el aviso de cita usa inicialmente 73 horas antes. La administración revisa el texto y abre manualmente `wa.me`. La app no envía mensajes ni ejecuta tareas programadas.
- Las copias se guardan mediante el selector del sistema en el dispositivo; no se suben a Firebase.

Firebase Spark no tiene costo para los servicios de esta arquitectura dentro de sus cuotas, pero no representa uso ilimitado: si se agota una cuota gratuita, el servicio puede quedar limitado hasta su reposición.

## Preparación de Firebase

1. En Authentication, habilita el proveedor **Correo electrónico/contraseña**.
2. Copia la configuración web del proyecto a un archivo `.env` local usando las variables de `.env.example`. No incluyas claves privadas de Admin SDK ni publiques `.env`.
3. Vincula el perfil administrador al UID real de Authentication en `users/{uid}` o `usuarios/{uid}` con `role` y `rol` consistentes (`admin` o `administrador`). La app no asigna permisos privilegiados durante un registro público.
4. Configura el negocio, servicios con precio/duración válidos, horarios del negocio y turnos del equipo. Un negocio nuevo permanece con las reservas cerradas hasta completar **Preparar agenda**.
5. Revisa `firestore.rules` y `firestore.indexes.json`; los clientes no deben tener acceso a perfiles privados de otras personas ni a las citas ajenas.

El proyecto está configurado para Rules e índices de Firestore solamente. No hay un bloque `functions` en `firebase.json`, el SDK cliente de Functions fue retirado y el código histórico se guardó en `functions-legacy/`. No ejecutes `firebase deploy --only functions` para esta versión.

## Comprobaciones locales

Desde la carpeta del proyecto:

```bash
pnpm install
pnpm check
pnpm lint
pnpm test
pnpm test:rules
pnpm expo export --platform android
pnpm expo export --platform web
```

`pnpm test:rules` usa el emulador local y el proyecto de prueba `demo-euforia-rules`; no escribe en la base real. Las exportaciones Android/Web verifican el empaquetado JavaScript, pero no producen un APK/EAS ni sustituyen una prueba en un teléfono.

## Publicación manual de reglas e índices

Después de revisar los archivos y elegir el proyecto Firebase correcto, ejecuta:

```bash
firebase deploy --project euforia-e76a6 --only firestore:rules,firestore:indexes
```

También se puede pegar `firestore.rules` manualmente en **Firebase Console → Firestore Database → Reglas**. La app debe actualizarse en cada teléfono antes de probar los nuevos permisos. Esta tarea no publicó Rules ni índices y no realizó escrituras en Firebase real.

## Retirar funciones ya publicadas, si existen

Mover el código local no elimina funciones que ya se hayan desplegado. Primero revisa el proyecto:

```bash
firebase functions:list --project euforia-e76a6
```

Solo si aún aparecen funciones de la versión antigua y ya no se necesitan, elimina cada función confirmada por nombre y región, de forma deliberada:

```bash
firebase functions:delete <nombre-confirmado> --region us-central1 --project euforia-e76a6
```

Los nombres que la fuente histórica exportaba en su última versión eran `guardarDisponibilidadEmpleado`, `obtenerDisponibilidad`, `reservarCita`, `aprobarCita`, `rechazarCita`, `iniciarServicio`, `finalizarServicio`, `expirarHolds`, `registrarAviso`, `enviarPushExpo`, `crearCuentaCliente`, `cambiarContrasenaProvisional`, `actualizarRecordatorioWhatsApp`, `cancelarRecordatoriosWhatsAppExcluidos`, `cancelarRecordatoriosWhatsAppExcluidosLegacy`, `guardarConfiguracionRecordatoriosWhatsApp`, `prepararRecordatoriosCumpleanos`, `sincronizarRecordatoriosCitas` y `sincronizarRecordatoriosServicios`. La lista real puede diferir; elimina solo nombres presentes en `functions:list`. No hace falta crear un proyecto de facturación ni desplegar Functions para el flujo Spark descrito aquí.

## Límites conocidos

- La preparación requiere conexión y se detiene si encuentra citas futuras con datos inválidos, citas solapadas, demasiados registros o citas que atraviesan el día local. Administración debe resolver el conflicto antes de abrir reservas.
- Los documentos de ocupación solo contienen bloques booleanos neutros, sin cliente, cita ni información de contacto. Un perfil cliente puede consultar esos patrones mientras el negocio tenga su agenda preparada para ver horarios libres; Firestore Rules no puede limitar por sí sola una lectura de lista al filtro de fecha/profesional de la app, así que esa cuenta podría inferir patrones de ocupación del negocio. Administración ve todos los bloqueos y cada empleado solo los propios al responder una cita.
- La pantalla de avisos WhatsApp se actualiza al abrirla; no hay cron ni preparación en segundo plano.
- Los avisos dentro de la app requieren que la persona vuelva a abrirla. La entrega push con la app cerrada no está disponible en esta arquitectura.
- La duración real de un servicio y `createdAt` en ciertas escrituras se calculan con el reloj del dispositivo dentro de los límites que protegen las Rules; no se presentan como mediciones de servidor.
- El cambio de contraseña y ciertas transiciones de Auth usan el SDK cliente. Sin un servidor confiable, Rules no pueden demostrar frente a una app modificada que un cambio de contraseña en Authentication ocurrió antes de quitar una marca de interfaz.
- No se verificó el inicio de sesión con una cuenta de producción ni se probó la entrega en teléfonos reales. La migración no cambia ni limpia perfiles históricos existentes.
