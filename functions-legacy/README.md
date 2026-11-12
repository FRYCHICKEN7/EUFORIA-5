# Código histórico de Cloud Functions — no desplegar

Este código se conserva solo como referencia histórica. La app vigente ya no lo importa y `firebase.json` no declara este directorio. No ejecutar `firebase deploy --only functions` ni compilarlo para esta versión Spark.

Si todavía hay funciones publicadas en el proyecto Firebase, identificarlas primero con `firebase functions:list --project <ID_DEL_PROYECTO>`. Borrarlas requiere una decisión y acción explícita del titular en Firebase; eliminar este código local no las borra ni modifica producción.
