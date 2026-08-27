# Pruebas de flujo (E2E) con Maestro

Los ocho flujos críticos de la especificación (§28) escritos como
especificaciones ejecutables de [Maestro](https://maestro.mobile.dev). Se eligió
Maestro y no Detox porque el YAML se mantiene con poco esfuerzo, corre contra el
binario ya instalado y no exige compilar una variante de pruebas.

Estos archivos valen incluso donde todavía no pasan: dicen, en un lenguaje
ejecutable, qué se espera de la app. Dos de ellos fallan hoy por bugs reales del
código, no de la prueba, y están señalados abajo.

## Inventario

| Archivo | Flujo §28 | Estado |
|---|---|---|
| `01-kiosco-jornada-completa.yaml` | 1 · entrada, descanso, regreso y salida | automático |
| `02-offline-salida-y-sincronizacion-unica.yaml` | 2 · sin red se guarda y sincroniza una sola vez | **paso manual** (cortar la red a mano) |
| `03-kiosco-no-ficha-por-otra-sede.yaml` | 3 · el iPad de Sede Principal no ficha por Sucursal Demo | automático (mitad en SQL) |
| `04-kiosco-revocado-no-registra.yaml` | 4 · un kiosco revocado no envía ni sincroniza | **paso manual** (revocar por SQL) |
| `05-gerente-corrige-fichaje-con-auditoria.yaml` | 5 · corrección con motivo y auditoría | **incompleto**: falta la interfaz |
| `06-gerente-copia-semana-y-publica.yaml` | 6 · copiar semana, editar y publicar | **incompleto**: falta el editor |
| `07-cambio-idioma-es-en.yaml` | 7 · ES/EN actualiza todo el flujo | automático |
| `08-pin-empleado-no-abre-rutas-admin.yaml` | 8 · el PIN de empleado no abre rutas administrativas | automático, **falla hoy** (ver abajo) |

Los subflujos reutilizables están en `subflows/`: teclear el PIN de cada persona
demo y confirmar una acción. Si cambia el largo del PIN o el flujo de
confirmación, se corrige en un solo lugar.

## Qué hace falta para correrlos

1. **Maestro instalado.**

   ```bash
   curl -Ls "https://get.maestro.mobile.dev" | bash
   maestro -v
   ```

   En Windows hay que usar WSL, y aun así el simulador de iOS solo existe en
   macOS: los flujos de iPad se corren desde un Mac o contra un dispositivo real
   conectado a un Mac. Desde Windows se pueden mantener y revisar los archivos,
   no ejecutarlos contra iOS.

2. **La app instalada en el dispositivo o simulador.** Maestro maneja un binario
   instalado, no el servidor de Metro. Lo más simple:

   ```bash
   eas build --platform ios --profile development   # o --profile preview
   ```

   Con Expo Go el `appId` no es el de la app sino `host.exp.Exponent`, así que los
   flujos no funcionan tal cual. Usa un development build.

3. **`appId` correcto.** Los flujos declaran
   `com.krealomedia.krealoshift`. Si se cambia el bundle identifier en
   `app.config.ts` —y hay que cambiarlo si está tomado, ver el README raíz— hay
   que cambiarlo también en los ocho archivos.

4. **Backend con datos demo.** Migraciones aplicadas, `supabase/seed.sql`
   aplicado y usuarios demo creados con `scripts/seed-demo-users.mjs`. Los pasos
   completos están en el README raíz.

5. **iPad activado como kiosco de Sede Principal** para los flujos 01–04, 07 y
   08. Los flujos 05 y 06 necesitan lo contrario: un dispositivo **sin** activar,
   porque si es kiosco el arranque nunca muestra el acceso administrativo.

6. **La app en español.** Los flujos 01–04 y 08 comprueban textos en es-PE, que
   es el idioma por defecto del demo. El flujo 07 es el que cambia de idioma.

## Cómo se corren

```bash
maestro test e2e/                                        # todos
maestro test e2e/01-kiosco-jornada-completa.yaml         # uno
maestro test --include-tags critico e2e/                 # solo los críticos
maestro test --exclude-tags manual,incompleto e2e/       # solo los automáticos
maestro test -e DEMO_PASSWORD="…" e2e/05-gerente-corrige-fichaje-con-auditoria.yaml
```

`DEMO_PASSWORD` es la contraseña que se eligió al correr
`scripts/seed-demo-users.mjs`. **No se guarda en el repositorio**: se pasa con
`-e` en cada corrida.

Para ver la jerarquía de vistas y encontrar un elemento:

```bash
maestro studio
```

## Poner el demo en el estado inicial

Los flujos no son independientes del estado: el flujo 01 necesita que Sofía Demo
**no** tenga turno abierto, y el 02 que **sí** esté trabajando. La forma limpia de
reiniciar es volver a aplicar los datos demo, que son idempotentes y recalculan
los turnos relativos a la hora actual:

```bash
psql "<cadena de conexión>" -f supabase/seed.sql
```

Consultas y llamadas que los flujos piden como paso manual:

```sql
-- Flujo 04: revocar el kiosco de demostración
select revoke_kiosk_device('66666666-6666-4666-8666-666666666661');

-- Flujo 04: volver a dejarlo operativo (después de la prueba)
update kiosk_devices
   set status = 'active', revoked_at = null
 where id = '66666666-6666-4666-8666-666666666661';

-- Flujo 02: comprobar que la salida se registró UNA sola vez
select event_type, occurred_at, is_offline
  from time_events
 where employee_id = '55555555-5555-4555-8555-555555555551'
   and occurred_at > now() - interval '1 hour'
 order by occurred_at;
```

Para la mitad de los flujos 03 y 04 que no pasa por la interfaz —enviar un evento
con la credencial del kiosco pero la ubicación de otra tienda, o con una
credencial revocada— se llama directamente a la Edge Function con `curl`,
enviando las cabeceras `x-kiosk-credential` y `x-kiosk-device`. El contrato está
en `supabase/functions/README.md`. La credencial del kiosco demo es un valor
conocido definido en `supabase/seed.sql`, y sirve solo para el proyecto de
desarrollo.

## testID: reconciliado el 2026-08-27

**Los 28 `testID` que usan los flujos existen en el código.** Se comprueba con
`node scripts/e2e-ids-check.mjs`, que está en CI.

Esa comprobación hace falta por un motivo concreto: un flujo que apunta a un id
inexistente no falla al escribirlo, falla cuando alguien lo ejecuta — y aquí eso es
"nunca", porque no hay simulador de iOS en la máquina de desarrollo remoto. Sin ella,
este directorio sería documentación que aparenta ser una prueba.

**Cuidado con una trampa al comprobarlo a mano:** muchos `testID` se construyen con
plantilla (`` testID={`keypad-${digit}`} ``), así que buscar solo `testID="..."` dice
que faltan las diez teclas del teclado numérico. No faltan. El script resuelve las
plantillas y también los comodines `*` de Maestro.

La lista de "testID que faltan" que había aquí quedó obsoleta: el panel
administrativo los añadió todos, con nombres distintos y mejores (`session-correct-*`
en vez de `timesheet-*`, `schedule-copy-week` en vez de `schedule-copy-previous-week`).
Los flujos ya usan los nombres reales.

## Lo que hace falta en el código

Hallazgos detectados al escribir estos flujos. Los tres primeros eran defectos
reales y **ya están arreglados**; se dejan escritos porque el motivo importa más
que el parche.

1. ~~**`app/kiosk/exit.tsx` autoriza con cualquier PIN válido.**~~ **ARREGLADO.**
   `tryAuthorize` daba por bueno cualquier `verifyPin` correcto, sin comprobar que
   la persona administre la ubicación: con el PIN de una empleada se llegaba al
   menú de diagnóstico y al botón que desactiva el kiosco. Ahora exige
   `canManageLocation`, que decide el servidor. Sin conexión el menú no abre, y se
   explica por qué en vez de dar un error genérico.
2. ~~**`app/(manager)/_layout.tsx` no tiene guarda de sesión ni de rol.**~~
   **ARREGLADO.** Como `(manager)` es un grupo, sus rutas viven en la raíz
   (`/hours`, `/team`, `/schedule`, `/more`) y eran alcanzables por enlace profundo
   o escribiendo la URL en la previsualización web, sin atravesar la redirección de
   `app/index.tsx`. El layout ahora comprueba sesión, kiosco y rol.
3. ~~**Nada llama a `markRevoked()`**~~ **ARREGLADO.** La pantalla "Este reloj fue
   desactivado" era inalcanzable. Ahora la marcan tanto `app/kiosk/index.tsx` como
   `app/kiosk/actions.tsx` al recibir `revoked` del servidor, y la pantalla tiene
   `testID="kiosk-revoked"`. El flujo 04 puede afirmarla directamente.
4. **Las pantallas administrativas son estados vacíos.** Los flujos 05 y 06 no se
   pueden completar hasta que existan las hojas de tiempo y el editor de horarios.
   Sigue pendiente: es el trabajo de P0-5.
