# Especificación de Seguridad Firestore (Zero-Trust)

## 1. Invariantes de Datos y Acceso
1. Un usuario no autenticado jamás puede leer o listar `usuarios`, `clientes`, `citas`, `bloqueos` ni `ocupacion`.
2. Ningún usuario puede auto-asignarse o escalar su propio `role` en `usuarios/{uid}` (`role: 'admin'`).
3. Un barbero solo puede leer (`get`/`list`) sus propias citas (`barberUid == request.auth.uid`) y únicamente puede actualizar los campos `['status', 'updatedAt']` de citas que no estén en estado terminal (`finalizada` o `cancelada`).
4. Ningún cliente en navegador puede escribir directamente en `ocupacion`; únicamente el servidor con Firebase Admin SDK crea/libera candados de ocupación dentro de una transacción.
5. Toda cadena de texto y lista tiene límites estrictos de tamaño (`size()`) y regex para prevenir envenenamiento de IDs o payloads masivos.
6. Todo timestamp (`createdAt`, `updatedAt`) se valida contra `request.time`.

## 2. Payloads Adversarios ("Dirty Dozen")
1. **Escalamiento de privilegios en creación de usuario**: `{ "uid": "u1", "role": "admin", ... }` enviado por usuario no admin -> **DENEGADO**.
2. **Campo fantasma ("Shadow Update") en cita**: Barbero intenta enviar `{ "status": "finalizada", "priceCop": 0, "updatedAt": ... }` -> **DENEGADO** por `affectedKeys().hasOnly(['status', 'updatedAt'])`.
3. **Spoofing de identidad en `usuarios`**: Usuario intenta crear `usuarios/otroUid` con `uid: "miUid"` -> **DENEGADO** por `incoming().uid == userId`.
4. **Email sin verificar (`email_verified: false`)**: Token con correo de administrador pero `email_verified == false` -> **DENEGADO** por `isVerifiedUser()`.
5. **Lectura de PII de clientes por barbero o anónimo**: `get /clientes/c1` o `list /clientes` como barbero -> **DENEGADO**.
6. **Modificación de cita de otro barbero**: Barbero A intenta actualizar estado de cita de Barbero B -> **DENEGADO** por `existing().barberUid == request.auth.uid`.
7. **Reapertura de cita en estado terminal**: Barbero intenta cambiar cita de `finalizada` a `confirmada` -> **DENEGADO** por validación de estado terminal.
8. **Envenenamiento de ID (`isValidId`)**: Petición a `/servicios/../../../../etc` o ID > 128 chars -> **DENEGADO**.
9. **Inyección de string de 1 MB en `notes` o `name`**: `{ "notes": "A".repeat(100000) }` -> **DENEGADO** por `.size() <= 500`.
10. **Escritura directa en `ocupacion` desde cliente**: Cliente intenta crear `/ocupacion/b1_2026-11-15_1000` -> **DENEGADO** (`allow create, update, delete: if false;`).
11. **Falsificación de fecha de creación (`createdAt`)**: Cliente envía `createdAt` en el pasado o futuro -> **DENEGADO** por `incoming().createdAt == request.time`.
12. **Consulta `list` sin filtro en `citas`**: Barbero ejecuta `getDocs(collection(db, 'citas'))` sin `where('barberUid', '==', uid)` -> **DENEGADO** por `resource.data.barberUid == request.auth.uid`.
