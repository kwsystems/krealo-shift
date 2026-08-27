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
  submit-time-event sync-offline-events submit-time-edit-request

supabase secrets set KIOSK_TOKEN_SECRET="$(openssl rand -hex 32)"
```

## Pendiente decidir: validación offline del PIN

La especificación §8 pide validar el PIN sin conexión con un verificador ligado
al dispositivo. El servidor guarda el PIN con bcrypt, o sea de forma
irreversible, así que **no puede derivar `HMAC(clave_dispositivo, PIN)`** sin
conocer el PIN en claro. Hay tres salidas, y la elección es de seguridad, no
técnica:

1. **Guardar el PIN de forma reversible** (cifrado con una clave del servidor)
   solo para derivar verificadores por dispositivo. Funciona siempre, pero
   introduce almacenamiento reversible de PIN.
2. **Derivar el verificador al fijar el PIN**, para cada dispositivo activo, en
   una tabla aparte. No hay PIN reversible, pero un iPad activado después queda
   sin verificadores hasta la siguiente rotación de PIN de cada empleado.
3. **Enviar al dispositivo el hash bcrypt con su salt**, cifrado con la clave del
   dispositivo. No hay PIN reversible y funciona para cualquier iPad, pero quien
   extraiga el blob puede probar los 10⁶ PIN posibles sin límite de intentos
   (bcrypt coste 12 lo hace lento, no imposible).

Se decide en la tarea de offline (P0-4). Hasta entonces el PIN se valida online.
