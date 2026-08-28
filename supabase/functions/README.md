# Edge Functions

Contratos tipados entre la app y el backend (especificación §16). La app nunca
inserta en `time_events`: todo pasa por aquí, y estas funciones a su vez delegan
las reglas a las funciones SQL `security definer`.

| Función                    | Autenticación                             | Qué hace                                                     |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `activate-kiosk`           | ninguna (canjea un código de un solo uso) | Vincula el iPad a UNA ubicación y emite su credencial        |
| `refresh-kiosk-roster`     | credencial del dispositivo                | Equipo, turnos y políticas mínimos para operar               |
| `verify-pin`               | credencial del dispositivo                | Valida el PIN y emite un token de acción de 90 s             |
| `submit-time-event`        | credencial + token de acción              | Registra un fichaje con idempotencia                         |
| `sync-offline-events`      | credencial + token por evento             | Procesa un lote offline en orden, sin descartar nada         |
| `submit-time-edit-request` | credencial + token de acción              | Crea la solicitud "Olvidé marcar"                            |
| `attach-photo`             | credencial del dispositivo                | Sube la foto de un fichaje ya aceptado y apunta `photo_path` |
| `send-manager-alerts`      | **secreto propio** (`x-alerts-token`)     | Envía las notificaciones pendientes al gerente por Expo Push |

## Dos credenciales distintas, a propósito

1. **Credencial del dispositivo** (`x-kiosk-credential` + `x-kiosk-device`): larga
   vida, ligada al iPad y a una sola ubicación. Se revoca desde el panel.
2. **Token de acción**: 90 segundos, ligado a empleado + kiosco + ubicación. Lo
   emite `verify-pin` y lo consumen las funciones que escriben.

Sin el token, conocer la credencial del iPad permitiría fichar por cualquiera.

## Tres credenciales, no dos: `send-manager-alerts` no es del kiosco

`send-manager-alerts` no la llama ningún iPad ni ninguna persona: la llama un
programador cada 15 minutos. Por eso no usa ninguno de los dos mecanismos de
arriba, sino un **secreto propio** en la cabecera `x-alerts-token`, comparado en
tiempo constante.

No usa la `service_role` como credencial a propósito. Esa clave abre la base
entera, y el programador acabaría teniéndola pegada en su configuración; con un
token dedicado, lo peor que consigue quien lo robe es hacernos enviar nuestras
propias alertas pendientes antes de tiempo. Sin el secreto configurado la función
devuelve 500 y no atiende: una función de envío que se queda abierta porque falta
una variable de entorno es peor que una que no funciona, porque nadie lo nota.

## Secretos del entorno

Se configuran en Supabase, nunca en el repositorio ni con prefijo `EXPO_PUBLIC_`:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
KIOSK_TOKEN_SECRET      # 32+ caracteres aleatorios; firma los tokens de acción
MANAGER_ALERTS_TOKEN    # 32+ caracteres aleatorios; autoriza send-manager-alerts
EXPO_ACCESS_TOKEN       # opcional; solo si la cuenta de Expo tiene seguridad reforzada
```

## Despliegue

```bash
supabase functions deploy activate-kiosk refresh-kiosk-roster verify-pin \
  submit-time-event sync-offline-events submit-time-edit-request attach-photo

# --no-verify-jwt porque su `Authorization` no lleva un JWT de Supabase: se
# autentica con su propio secreto en `x-alerts-token`.
supabase functions deploy send-manager-alerts --no-verify-jwt

supabase secrets set KIOSK_TOKEN_SECRET="$(openssl rand -hex 32)"
supabase secrets set MANAGER_ALERTS_TOKEN="$(openssl rand -hex 32)"
```

## El disparador de las alertas hay que configurarlo aparte

`20260827001100_manager_alerts.sql` programa con `pg_cron` lo que `pg_cron` puede
hacer: la purga diaria del historial de deduplicación. El **envío** no, porque
`pg_cron` ejecuta SQL y enviar exige hablar HTTP con Expo. Para que lo hiciera
habría que instalar `pg_net` y guardar un token de servicio en un ajuste de la
base de datos, o sea mover un secreto desde el entorno de las Edge Functions
—donde está— a la propia base. No se hace.

El disparador es externo, cada 15 minutos:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-manager-alerts" \
  -H "x-alerts-token: $MANAGER_ALERTS_TOKEN"
```

**Si nadie lo configura, las alertas se calculan y no se envían.** No se pierden
—`pending_manager_alerts` las vuelve a devolver mientras el hecho siga vigente—
pero nadie se entera de nada.

## Cómo no repetir la misma alerta cada 15 minutos

La deduplicación está entera en la base, en `manager_alert_deliveries`, y la Edge
Function no decide nada sobre ella: `claim_manager_alerts()` reserva y devuelve en
UNA sentencia solo lo que no se avisó todavía. Dos pases solapados del trabajo no
pueden enviar lo mismo dos veces.

La clave es `(destinatario, tipo, sujeto, ocurrencia)`. El razonamiento completo
—incluido por qué el destinatario forma parte de la clave y por qué unos avisos
llevan cubo de tiempo y otros no— está en el comentario de esa tabla en la
migración.

Reglas de marcado que importan:

- **Fallo de red o respuesta ilegible de Expo:** no se marca nada. Las filas
  quedan `queued` y el pase siguiente las recoge pasados 10 minutos, hasta tres
  intentos. Marcarlas fallidas perdería la alerta.
- **Expo rechaza el mensaje:** se marca `failed`. Reintentar da el mismo rechazo.
- **`DeviceNotRegistered`:** el token se desactiva (`push_tokens.is_active =
false`). Seguir enviando a un dispositivo borrado gasta cuota para siempre.

## El texto de la notificación no lleva datos de personas

Ni el nombre, ni el número de empleado, ni el correo, ni el teléfono, ni la foto
(§9.6, §19). Solo el tipo de alerta, la cantidad de hechos y el nombre de la
tienda: "2 personas no han fichado su entrada en Sede Principal".

Un nombre propio en la pantalla de bloqueo de un teléfono es información laboral
de un tercero, legible por cualquiera que pase cerca sin desbloquear nada. El
gerente ve el nombre un toque después, dentro de la app. El costo es real: la
notificación no dice quién, así que hay que abrir la app para actuar.

La garantía es mecánica y no de disciplina: en `_shared/alert-messages.ts` los
únicos marcadores que existen son `{{count}}` y `{{location}}`, y `composeAlert`
no sabe sustituir nada más. Lo fija
`src/features/notifications/__tests__/alert-messages.test.ts`, y desde el otro
lado `supabase/tests/20_functions.sql` comprueba que `pending_manager_alerts` no
devuelve ninguna columna de personas.

## Los intentos de fichaje rechazados se anotan desde aquí, no desde SQL

§19 pide avisar de un "intento de fichaje desde un kiosco revocado o incorrecto".
`authenticate_kiosk` y `submit_time_event` rechazan levantando una excepción, y
una excepción aborta la transacción: un `insert` dentro de la misma función se
desharía con ella, y Postgres no tiene transacciones autónomas.

Así que lo anota la Edge Function, en una petición nueva, con
`record_kiosk_rejection`:

- `_shared/kiosk-auth.ts` cubre el dispositivo revocado o desconocido. Está en el
  punto por el que pasan todas las peticiones del kiosco, así que cubre las siete
  funciones de una vez.
- `submit-time-event` cubre el empleado que no pertenece a la tienda de ese iPad.

Un `device_public_id` que no existe en la base no se anota: no hay organización a
la que atribuirlo, así que no hay gerente a quien avisar. Un escaneo con
identificadores inventados no deja rastro ahí; eso corresponde a un límite de
peticiones en el borde, no a esta tabla.

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
