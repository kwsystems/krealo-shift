# Edge Functions

Contratos tipados entre la app y el backend (especificación §16). La app nunca
inserta en `time_events`: todo pasa por aquí, y estas funciones a su vez delegan
las reglas a las funciones SQL `security definer`.

| Función | Autenticación | Qué hace |
|---|---|---|
| `activate-kiosk` | ninguna (canjea un código de un solo uso) | Vincula el iPad a UNA ubicación y emite su credencial |
| `refresh-kiosk-roster` | credencial del dispositivo | Equipo, turnos y políticas mínimos para operar |
| `verify-pin` | credencial del dispositivo | Valida el PIN y emite un token de acción de 90 s |
| `submit-time-event` | credencial + token de acción | Registra un fichaje con idempotencia |
| `sync-offline-events` | credencial + token por evento | Procesa un lote offline en orden, sin descartar nada |
| `submit-time-edit-request` | credencial + token de acción | Crea la solicitud "Olvidé marcar" |
| `attach-photo` | credencial del dispositivo | Sube la foto de un fichaje ya aceptado y apunta `photo_path` |

## Dos credenciales distintas, a propósito

1. **Credencial del dispositivo** (`x-kiosk-credential` + `x-kiosk-device`): larga
   vida, ligada al iPad y a una sola ubicación. Se revoca desde el panel.
2. **Token de acción**: 90 segundos, ligado a empleado + kiosco + ubicación. Lo
   emite `verify-pin` y lo consumen las funciones que escriben.

Sin el token, conocer la credencial del iPad permitiría fichar por cualquiera.

## Secretos del entorno

Se configuran en Supabase, nunca en el repositorio ni con prefijo `EXPO_PUBLIC_`:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
KIOSK_TOKEN_SECRET      # 32+ caracteres aleatorios; firma los tokens de acción
```

## Despliegue

```bash
supabase functions deploy activate-kiosk refresh-kiosk-roster verify-pin \
  submit-time-event sync-offline-events submit-time-edit-request attach-photo

supabase secrets set KIOSK_TOKEN_SECRET="$(openssl rand -hex 32)"
```


## Fotos de fichaje

`attach-photo` recibe la imagen en base64 y la sube con `service_role` a un bucket
privado. Dos cosas que no son negociables y el motivo de cada una:

1. **La ruta la deriva el servidor** con `attendance_photo_path(event_id)`. Si el
   cliente pudiera proponerla, podría apuntar la foto de un fichaje al archivo de
   otro, o escribir fuera de su organización.
2. **`photo_path` se escribe después de subir**, no antes. Al revés, cada subida
   fallida dejaría la columna apuntando a un objeto inexistente, indistinguible de
   una foto purgada por retención.

Por eso NO se usa una URL firmada de subida, que sería lo habitual: obligaría a
apuntar la columna antes de que el archivo exista, y daría al iPad una capacidad de
escritura sobre Storage que no necesita. El costo es el ancho de banda de la
función, y con un bucket limitado a 2 MB es asumible.

Es idempotente: reintentar con la misma imagen sobrescribe el mismo objeto
(`upsert`) y vuelve a dejar el mismo puntero. Con red mala el reintento es la norma.

El fichaje **no espera** por la foto: la persona ve su confirmación y se va, y la
imagen se sube en el siguiente pase de sincronización, de a una por pase para no
competir con los fichajes. Si no sube, se reintenta indefinidamente y nunca se
descarta por número de intentos: una foto pendiente no impide contar las horas, así
que perderla no tiene ninguna ventaja.

El modelo completo —bucket, políticas, retención y la excepción a append-only— está
en `SECURITY.md`.

## Validación offline del PIN (decidido)

La especificación §8 pide validar el PIN sin conexión con un verificador ligado
al dispositivo. El servidor guarda el PIN con bcrypt, o sea de forma
irreversible, así que **no puede derivar `HMAC(clave_dispositivo, PIN)`** sin
conocer el PIN en claro. Se consideraron cuatro salidas, y la elección fue de
seguridad, no técnica:

1. **Guardar el PIN de forma reversible** (cifrado con una clave del servidor)
   solo para derivar verificadores por dispositivo. Funciona siempre, pero
   introduce almacenamiento reversible de PIN.
2. **Derivar el verificador al fijar el PIN**, para cada dispositivo activo, en
   una tabla aparte. No hay PIN reversible, pero un iPad activado después queda
   sin verificadores hasta la siguiente rotación de PIN de cada empleado.
3. **Enviar al dispositivo el hash bcrypt con su salt.** No hay PIN reversible y
   funciona para cualquier iPad, pero quien se lleve el archivo local puede probar
   los 10⁶ PIN posibles sin límite de intentos.
4. **Enviar el salt y un verificador derivado con una clave propia del
   dispositivo**, sin el hash.

**Elegida: la 4.** `activate-kiosk` entrega al iPad una clave aleatoria de 32
bytes (`deviceKey`), separada de la credencial de peticiones, que el dispositivo
guarda en el Keychain. `refresh-kiosk-roster` devuelve por empleado:

```
{ employeeOpaqueId, pinSalt, pinVerifier, pinLength, pinVersion }
```

donde `pinSalt` son los 29 caracteres del salt de bcrypt y `pinVerifier` es
`sha256(deviceKey || ':' || hash_bcrypt)` en hexadecimal. El hash completo **no
sale de la base**.

El razonamiento completo, con su costo, está en `SECURITY.md`. La construcción
está fijada en `supabase/tests/20_functions.sql` y en
`src/lib/offline/__tests__/pin-derivation.test.ts`: si una de las dos puntas
cambia, las pruebas fallan.
