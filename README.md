# Krealo Shift

Control de asistencia y horarios para tiendas pequeñas. Un iPad fijo en el local
funciona como **reloj compartido (kiosco)**: el personal marca entrada, descanso,
regreso y salida con un PIN personal. Gerentes y administradores usan la misma
app —o su previsualización web— para ver el equipo, armar el horario semanal y
revisar horas.

Aplicación única para iPhone y iPad, hecha con Expo (React Native) y Supabase.

## Alcance real de P0/P1

Lo que **sí** hace en esta etapa:

- kiosco iPad con PIN por empleado, vinculado a **una** ubicación;
- entrada, inicio y fin de descanso, y salida, con máquina de estados en el
  servidor e idempotencia;
- funcionamiento sin conexión: el fichaje se guarda en el iPad y se sincroniza al
  volver la red, sin duplicar ni descartar nada en silencio;
- panel administrativo para propietario, administrador y gerente;
- español (es-PE) e inglés completos, conmutables en caliente;
- previsualización web para desarrollar y revisar desde Windows.

Lo que **no** hace, a propósito:

- **no hay fichaje desde el celular del empleado.** El reloj es el iPad de la
  tienda. Un empleado no necesita cuenta ni instalar nada;
- no hay geolocalización ni mapas: el iPad ya está vinculado de forma segura a
  una tienda concreta;
- no hay integración con Shopify, nómina ni chat (eso es P2);
- la web es una herramienta de desarrollo, **no** un producto que se despliegue
  ni un WebView metido dentro de iOS.

Ver `docs/DECISIONES.md` para el registro de decisiones técnicas y desviaciones,
y `SECURITY.md` para el modelo de seguridad.

## Requisitos

| Herramienta            | Versión                             | Notas                                  |
| ---------------------- | ----------------------------------- | -------------------------------------- |
| Node.js                | 20 LTS o superior                   | `node --version`                       |
| npm                    | 10 o superior                       | viene con Node                         |
| Git                    | cualquiera reciente                 |                                        |
| Cuenta Supabase        | plan gratuito sirve para desarrollo |                                        |
| Supabase CLI           | 2.x                                 | solo para migraciones y Edge Functions |
| Cuenta Expo (EAS)      | gratuita para empezar               | solo para generar builds               |
| Cuenta Apple Developer | del propietario                     | solo para TestFlight                   |
| iPad con iPadOS 16.4+  |                                     | el mínimo lo fija Expo SDK 57          |

No hace falta macOS: los builds de iOS se generan en la nube con EAS Build. Sí
hace falta un iPhone o iPad real para verificar cámara, notificaciones,
SecureStore y Acceso guiado.

## Instalación

```bash
git clone https://github.com/kwsystems/krealo-shift.git
cd krealo-shift
npm install
cp .env.example .env      # en PowerShell: Copy-Item .env.example .env
```

Después rellena `.env` (ver [Variables de entorno](#variables-de-entorno)) y
arranca:

```bash
npx expo start            # abre el servidor de desarrollo (QR, iOS, web)
npx expo start --web      # abre directamente la previsualización web
```

Si `.env` está incompleto, la app **no** revienta: la pantalla de arranque
enumera qué claves faltan (`src/lib/env.ts`).

## Comandos

```bash
npm install                                             # dependencias
npx expo start                                          # servidor de desarrollo
npx expo start --web                                    # previsualización web (Windows)
npx expo-doctor                                         # revisa el proyecto Expo
npx tsc --noEmit                                        # typecheck (TypeScript strict)
npm test                                                # pruebas Jest
npx eslint .                                            # lint
npx prettier --check .                                  # formato (npm run format lo arregla)
./scripts/db-test.sh                                    # pruebas SQL sobre Postgres local

node scripts/generar-iconos.mjs                         # regenera icono, splash y favicon
node scripts/render-check.mjs <dir-export>               # ¿pinta cada ruta sin errores de consola?
node scripts/interaccion-check.mjs <dir-export>          # abre la app y la USA: teclea un PIN, toca botones
node scripts/a11y-check.mjs <dir-export>                # contraste, nombres, objetivos táctiles, texto 150%
node scripts/e2e-ids-check.mjs                          # testIDs referenciados que ya no existen
node scripts/coherencia-check.mjs                       # claves i18n huérfanas y controles que no hacen nada
node scripts/capturas-store.mjs <dir-export>            # capturas para la App Store, en los tamaños exactos
python3 scripts/generar-instalacion.py                  # regenera supabase/instalar-todo.sql

eas login                                               # autenticarse en EAS
eas build:configure                                     # crea/asocia el projectId de EAS
eas build --platform ios --profile preview              # build interno instalable
eas build --platform ios --profile production           # build para App Store/TestFlight
eas submit --platform ios --profile production          # subir el build a App Store Connect
```

Atajos equivalentes definidos en `package.json`: `npm start`, `npm run web`,
`npm run typecheck`, `npm run lint`, `npm run doctor`, `npm test`.

Ninguna dependencia actual requiere `expo prebuild`: el proyecto sigue en
workflow administrado y todo lo nativo se configura desde `app.config.ts`
(plugins de Expo). Si en el futuro se agrega una dependencia que sí lo exija,
hay que documentarlo aquí; los directorios `/ios` y `/android` están en
`.gitignore` justamente para que el repositorio siga siendo reproducible con EAS.

## Primera vez en Windows

Los cuatro pasos, desde cero, en PowerShell. No hace falta nada más que
[Node.js LTS](https://nodejs.org) y [Git](https://git-scm.com/download/win).

> **La rama importa.** Todo el trabajo vive en `claude/proxima-tarea-uwy0ab`, no en
> `main`. Un `git clone` a secas te deja en `main`, que no tiene nada de esto: la app no
> arrancaría y parecería un problema de tu máquina. Por eso el paso 1 lleva `--branch`.

```powershell
# 1. Descargar el proyecto (crea la carpeta krealo-shift en tu usuario)
cd $HOME
git clone --branch claude/proxima-tarea-uwy0ab https://github.com/kwsystems/krealo-shift.git
cd krealo-shift

# Si YA lo tenías clonado de antes, en vez del clone:
#   cd $HOME\krealo-shift
#   git fetch origin
#   git checkout claude/proxima-tarea-uwy0ab
#   git pull
#   npm install     # hay dependencias nuevas desde la última vez

# 2. Instalar dependencias (tarda unos minutos la primera vez)
npm install

# 3. Crear la configuración mínima para que la app arranque
Copy-Item .env.example .env
notepad .env    # pega la URL y la anon key de Supabase, o déjalo así para solo mirar

# 4. Arrancar
npx expo start --web
```

Cuando abra, añade `/kiosk` a la URL: `http://localhost:8081/kiosk`.

**Si te equivocas de carpeta**, el síntoma es
`fatal: not a git repository`: significa que no estás dentro de `krealo-shift`.
`cd $HOME\krealo-shift` y vuelve a intentarlo.

### El script que hace los pasos 2 a 4 de una

```powershell
.\scripts\windows-empezar.ps1
```

Si PowerShell responde _"no se puede cargar porque la ejecución de scripts está
deshabilitada"_, es la política de ejecución de Windows, no un problema del proyecto.
Para permitirlo solo en esta ventana:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Los cuatro comandos de arriba funcionan siempre y no dependen de esa política.

### Qué se ve y qué no, sin credenciales de Supabase

| Funciona                                               | No funciona                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| Recorrer el kiosco: reloj, teclado, ayuda, activación  | Validar un PIN                                               |
| Cambiar de idioma y ver todo traducido                 | El panel administrativo (se queda en "Preparando tu sesión") |
| Redimensionar la ventana: diseño de iPad y de teléfono | Cualquier dato real                                          |

## Trabajar desde Windows

El desarrollo diario se puede hacer entero en Windows con la previsualización
web:

```bash
npx expo start --web
```

Se abre en Chrome o Edge. Para revisar el diseño responsive, usa las
herramientas de desarrollo del navegador (F12 → _Toggle device toolbar_) con
viewports equivalentes a:

| Objetivo                  | Viewport aproximado |
| ------------------------- | ------------------- |
| iPhone SE / ancho pequeño | 375 × 667           |
| iPhone moderno            | 393 × 852           |
| iPad 10–11" vertical      | 834 × 1194          |
| iPad 10–11" horizontal    | 1194 × 834          |

En la web se puede recorrer el flujo del kiosco (reposo, PIN, acciones,
confirmación, resultado), el acceso administrativo, el cambio ES/EN y los
tamaños de texto.

### Lo que NO se puede verificar en la web

Estas cuatro cosas tienen adaptadores seguros para que la web no se rompa, pero
**su comportamiento real solo se puede comprobar en un iPhone o iPad**:

| Función                                | En web                                                                                                                                                                                         | Dónde verificarla de verdad                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Cámara** (foto opcional del fichaje) | `expo-camera` en web usa `getUserMedia`: pide permiso del navegador y puede no haber cámara. La foto nunca bloquea el fichaje.                                                                 | iPad real, con la política `photoEnabled` activada en la ubicación                      |
| **Notificaciones**                     | `expo-notifications` no tiene equivalente completo en web y requiere claves push; no hay notificaciones reales.                                                                                | dispositivo real con build de development o preview                                     |
| **SecureStore**                        | no existe en web. `src/lib/security/secure-storage.ts` cae a `localStorage`, avisa por consola que **no es almacenamiento seguro** y se niega a funcionar si el build web fuera de producción. | dispositivo real: la credencial del kiosco solo está protegida en el Keychain de iOS    |
| **Acceso guiado de iPadOS**            | es una función del sistema operativo; no existe en navegador.                                                                                                                                  | iPad real (ver [Modo kiosco de verdad](#modo-kiosco-de-verdad-acceso-guiado-de-ipados)) |

Además, en web el `keep-awake` del kiosco no aplica y los gestos como la
pulsación larga de 3 segundos sobre el logotipo dependen del ratón, no del dedo.

Para probar en un dispositivo real desde Windows, la vía es un build de
development con EAS (`eas build --profile development`) instalado en el iPad, y
`npx expo start --dev-client` en la máquina.

## Variables de entorno

Copia la plantilla y rellena:

```bash
cp .env.example .env
```

```dotenv
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_SUPPORT_EMAIL=
EXPO_PUBLIC_PRIVACY_URL=
```

Reglas, no sugerencias:

- **solo las variables con prefijo `EXPO_PUBLIC_` llegan al cliente**, y cualquiera
  que descargue el `.ipa` puede leerlas. Por eso ahí solo van datos públicos: la
  URL del proyecto y la `anon key`, que sin RLS no sirve de nada y con RLS no
  puede saltarse las políticas;
- **la `service_role` NUNCA va en la app**, ni con prefijo, ni sin prefijo, ni
  "solo para probar". Vive en dos sitios: los secretos de las Edge Functions en
  Supabase, y tu terminal cuando corres `scripts/seed-demo-users.mjs`;
- `.env` está en `.gitignore`. `.env.example` es la única versión que se commitea,
  y va vacía;
- las variables se validan con Zod al arrancar (`src/lib/env.ts`). En desarrollo
  se muestra qué falta; en producción no se revelan valores.

Para los builds de EAS, las variables **no** se leen de tu `.env` local: se
configuran en el proyecto de EAS y `eas.json` selecciona el entorno
(`development`, `preview`, `production`) en cada perfil.

```bash
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref>.supabase.co"
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>"
```

Repetir para `production`. También se pueden gestionar desde el panel de
expo.dev. Aun siendo públicas, no se commitean.

## Configurar Supabase paso a paso

Hay dos rutas. La corta no necesita instalar nada y es la que sirve para ver la app
funcionando hoy; la larga usa el CLI de Supabase y es la que se usa para trabajar el
proyecto a diario.

### Ruta corta: sin CLI, pegando dos archivos en el panel

Cinco pasos, el último opcional. No hace falta la `service_role key` en ningún
momento: todo pasa dentro del propio panel de Supabase.

1. **Crear el proyecto.** En [supabase.com](https://supabase.com) → _New project_. El
   plan gratuito alcanza. Guarda la contraseña de base de datos que te pida, aunque
   para esto no la vas a usar.

2. **Crear el esquema.** Menú lateral → **SQL Editor** → _New query_ → pega TODO
   `supabase/instalar-todo.sql` → **Run**. Son las 22 migraciones y los datos de
   demostración en un solo archivo. Al terminar dice _Success. No rows returned_.

3. **Crear tu usuario.** Menú lateral → **Authentication** → **Users** → _Add user_ →
   _Create new user_:
   - tu correo y una contraseña;
   - marca **Auto Confirm User**. Sin eso el usuario queda sin confirmar y el acceso
     falla sin decir por qué.

   Después, otra vez en **SQL Editor**, pega `supabase/crear-mi-usuario.sql` —
   cambiando el correo de la primera línea por el tuyo — y **Run**. Eso te hace
   propietario de la organización de demostración y te da una ficha de empleado con
   PIN `246810`, para poder probar también el kiosco.

   El usuario se crea en el panel y no por SQL a propósito: una cuenta que pueda
   iniciar sesión necesita filas exactas en `auth.users` y en `auth.identities`, con
   el formato que espera la versión de GoTrue que corra tu proyecto. Desde el panel
   sale bien siempre.

4. **Apuntar la app al proyecto.** _Project Settings_ → _API_. Copia **Project URL** y
   **anon public** al `.env` del repositorio:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
   ```

   Y reinicia la previsualización con la caché limpia, porque esos valores se leen al
   empaquetar:

   ```powershell
   npx expo start --web --clear
   ```

5. **Habilitar el enlace de recuperación de contraseña** (opcional, un minuto).
   _Authentication_ → _URL Configuration_ → _Redirect URLs_ → _Add URL_, y agrega las
   dos:

   ```
   krealoshift://restablecer
   http://localhost:8081/restablecer
   ```

   La primera es la app en el iPad; la segunda, la previsualización web. Sin esto
   «Olvidé mi contraseña» **sí envía el correo**, pero el enlace lleva al _Site URL_
   del proyecto en vez de abrir la app, así que la pantalla para escribir la
   contraseña nueva no aparece. Es configuración del proyecto, no código: la app ya
   pide `krealoshift://restablecer` como URL de retorno.

Con eso el acceso ya funciona con tu correo y tu contraseña. Lo que sigue sin
funcionar en la web es el kiosco de verdad: necesita un dispositivo activado, y eso
va en el iPad (ver «Lo que NO se puede verificar en la web»).

`instalar-todo.sql` es un archivo **generado**. Si cambia una migración se regenera
con `python3 scripts/generar-instalacion.py`, y CI comprueba que no se haya quedado
viejo. No se edita a mano.

### Ruta larga: con el CLI de Supabase

### 1. Crear el proyecto

En [supabase.com](https://supabase.com) crea un proyecto. Anota:

- **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`;
- **anon public key** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`;
- **service_role key** → NO va en la app. Solo la usarás en tu terminal.

Fija la zona horaria mental del negocio en las ubicaciones, no en el proyecto:
cada `location` guarda su propio `timezone`.

### 2. Instalar y vincular el CLI

```bash
npm install -g supabase          # o: npx supabase@latest <comando>
supabase login
supabase link --project-ref <ref-del-proyecto>
```

El `<ref>` es el subdominio de la Project URL.

### 3. Aplicar las migraciones

```bash
supabase db push
```

Aplica, en orden, los archivos de `supabase/migrations/`:

| Migración                                   | Qué crea                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…000100_initial_schema.sql`                | 25 tablas, enums, restricciones, índices; `time_events` y `audit_logs` son _append-only_                                                          |
| `…000200_rls.sql`                           | Row Level Security en todas las tablas expuestas                                                                                                  |
| `…000300_functions.sql`                     | funciones `security definer`: PIN, kioscos, registro de eventos, correcciones, exportación                                                        |
| `…000400_guards.sql`                        | guardas que la interfaz no puede garantizar (no quedarse sin propietario, turnos que no se solapan, publicación sellada)                          |
| `…000500_kiosk_context.sql`                 | `kiosk_employee_context`, lo que ve la pantalla del empleado tras el PIN                                                                          |
| `…000600_offline_pin.sql`                   | verificador de PIN para uso sin conexión, su reparto por dispositivo y el registro de eventos offline                                             |
| `…000700_offline_verifier_device_key.sql`   | `offline_key` por dispositivo: el verificador que se reparte va atado al iPad que lo pidió                                                        |
| `…000800_attendance_photos.sql`             | bucket privado de fotos de fichaje, ruta firmada y purga por caducidad                                                                            |
| `…000900_scheduled_jobs.sql`                | la purga anterior como tarea de `pg_cron`; si la extensión no está, no rompe nada                                                                 |
| `…001000_kiosk_devices_admin.sql`           | vista de inventario de kioscos para el panel, sin exponer las credenciales                                                                        |
| `…001100_manager_alerts.sql`                | los siete hechos que generan alerta al encargado, con deduplicación y reclamo por lotes                                                           |
| `…001200_organization_logo.sql`             | bucket de logo de la organización, de lectura pública y escritura solo del administrador                                                          |
| `…001300_manager_add_time_event.sql`        | que un encargado pueda añadir un fichaje que faltó, idempotente y auditado                                                                        |
| `…001400_function_privileges.sql`           | quita `execute` a `public`, `anon` y `authenticated` de TODAS las funciones y lo devuelve por lista blanca                                        |
| `…001500_authorize_rpc.sql`                 | la comprobación de rol dentro de los RPC: conceder `execute` no es conceder permiso                                                               |
| `…001600_close_direct_writes.sql`           | cierra las dos políticas que permitían escribir horas y auditoría sin pasar por el camino auditable                                               |
| `…001700_notification_preferences_real.sql` | deja seis interruptores de notificación, uno por alerta que existe: dos de los ocho anteriores no controlaban nada                                |
| `…001800_kiosk_request_updates.sql`         | el kiosco devuelve el resultado de las solicitudes de esa persona: sin esto el empleado no se enteraba de en qué quedó lo que reportó             |
| `…001900_alertas_1106.sql`                  | implementa las dos alertas que §11.6 pide y §19 omite (entrada temprana, cambio de horario): nueve alertas, ocho interruptores                    |
| `…002000_aviso_ultimo_contacto.sql`         | el aviso de «reloj sin sincronizar» mide el último contacto y no la última vez que se vació la cola: antes disparaba a diario en kioscos sanos    |
| `…002100_truncar_minutos.sql`               | los segundos sueltos se truncan igual que en TypeScript: SQL redondeaba y había hasta un minuto de diferencia en lo que se paga                   |
| `…002200_autor_de_correcciones.sql`         | §11.4 exige conservar el AUTOR de cada corrección y no había forma de mostrarlo: `created_by` apunta a `auth.users`, que el cliente no puede leer |

La lista puede crecer: la fuente de verdad es el directorio, y `supabase db push`
aplica lo que falte en orden de nombre.

Alternativa sin CLI: `supabase/instalar-todo.sql`, que es exactamente estos
archivos concatenados en orden — ver la ruta corta más arriba.

### 4. Crear los usuarios demo

`supabase/seed.sql` no puede crear usuarios con contraseña —eso pasa por la Auth
API— así que va antes este script. **La contraseña se lee del entorno, nunca del
repositorio.**

```bash
SUPABASE_URL="https://<ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role>" \
DEMO_PASSWORD="<una contraseña larga que elijas tú>" \
node scripts/seed-demo-users.mjs
```

En PowerShell:

```powershell
$env:SUPABASE_URL="https://<ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<service_role>"
$env:DEMO_PASSWORD="<una contraseña larga que elijas tú>"
node scripts/seed-demo-users.mjs
```

`DEMO_PASSWORD` exige 12 caracteres como mínimo. El script es idempotente: si un
usuario ya existe, lo informa y sigue. Crea tres cuentas con correos en el TLD
reservado `.invalid` (propietaria, gerenta y una empleada con cuenta), para que
un demo no pueda escribirle a una persona real.

### 5. Aplicar los datos demo

```bash
psql "<cadena de conexión de Supabase>" -f supabase/seed.sql
```

La cadena de conexión está en el panel: _Project Settings → Database → Connection
string_. También se puede pegar el archivo en el SQL Editor.

El seed es idempotente y crea la organización Krealo Media Demo, dos ubicaciones
con políticas distintas (largo de PIN, formato de hora, tolerancias), cinco
empleados ficticios —uno trabajando, uno en descanso, uno atrasado y uno sin
turno—, dos semanas de turnos, un kiosco de demostración y una segunda
organización que existe solo para probar el aislamiento.

Los PIN y la credencial del kiosco demo son valores obvios definidos dentro de
`supabase/seed.sql`, marcados ahí como de demostración. **No sirven para
producción y no deben copiarse a un proyecto real.**

### 6. Desplegar las Edge Functions

```bash
supabase functions deploy activate-kiosk refresh-kiosk-roster verify-pin \
  submit-time-event sync-offline-events submit-time-edit-request
```

Son la única puerta entre la app y la base: la app nunca inserta en
`time_events`. El detalle de cada una está en `supabase/functions/README.md`.

### 7. Fijar el secreto `KIOSK_TOKEN_SECRET`

Firma los tokens de acción de 90 segundos que autorizan cada fichaje. Sin él las
funciones que escriben no arrancan.

```bash
supabase secrets set KIOSK_TOKEN_SECRET="$(openssl rand -hex 32)"
```

En PowerShell, sin `openssl`:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
supabase secrets set KIOSK_TOKEN_SECRET="$secret"
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen en el entorno de las
Edge Functions; no hay que configurarlas. Ninguno de estos secretos lleva prefijo
`EXPO_PUBLIC_` ni entra en el repositorio.

### 8. Comprobar que quedó bien

- en la app, el acceso administrativo con la cuenta `demo-owner@…` y la
  `DEMO_PASSWORD` que elegiste debe entrar al panel;
- _Table Editor → `employee_pin_credentials`_ debe mostrar hashes bcrypt, nunca
  PIN legibles;
- _Authentication → Policies_ debe mostrar RLS activo en todas las tablas;
- para activar el iPad como kiosco hace falta un código de activación emitido
  desde el panel administrativo (pantalla pendiente, ver
  [Qué falta](#qué-falta)); mientras tanto se puede emitir llamando a la función
  de activación desde el SQL Editor.

## Pruebas

### Pruebas de la app (Jest)

```bash
npm test              # o: npx jest --ci
npm run test:watch
```

Cubren la máquina de estados de asistencia, las utilidades de tiempo (turnos que
cruzan medianoche, zonas horarias), la paridad de claves entre es-PE e inglés y
los componentes del teclado de PIN y la cuenta regresiva.

### Pruebas de base de datos (SQL)

```bash
./scripts/db-test.sh              # esquema + datos demo + comprobaciones
./scripts/db-test.sh --schema     # solo aplicar las migraciones
```

El script levanta las migraciones sobre un **Postgres local**, sin nube y sin
Supabase CLI. Para lograrlo aplica primero `supabase/tests/00_supabase_shim.sql`,
un _shim_ que reproduce lo mínimo del esquema `auth` de Supabase que usan las
migraciones: la tabla `auth.users`, las funciones `auth.uid()` y `auth.role()`
—que leen la misma variable de sesión `request.jwt.claims` que usa Supabase— y
los roles `anon`, `authenticated` y `service_role`. Eso permite impersonar
usuarios reales y probar de verdad las políticas RLS. El shim **no** se aplica en
producción: en Supabase todo eso ya existe.

Después recrea la base `krealo_test`, aplica todas las migraciones en orden, aplica
`supabase/seed.sql` y corre `supabase/tests/10_rls.sql` y
`supabase/tests/20_functions.sql`.

Requisitos, porque el script **no** crea ni arranca el servidor:

- Linux (o WSL en Windows) con `su postgres` disponible, es decir se corre como
  root;
- PostgreSQL 16 instalado, con un clúster ya inicializado y **escuchando**;
- por defecto espera los binarios en `/usr/lib/postgresql/16/bin`, el directorio
  de datos en `/var/lib/postgresql/ks-test` y el socket en
  `/var/lib/postgresql/ks-test/run`, puerto `55432`.

Se puede reapuntar con variables de entorno: `KS_PGBIN`, `KS_PGDIR`, `KS_PGPORT`.

### Pruebas de flujo (Maestro)

Los ocho flujos críticos están en `e2e/` como especificaciones YAML de Maestro.
Cómo instalarlo, cómo correrlos y qué requisitos tienen: `e2e/README.md`.

## Modo kiosco de verdad: Acceso guiado de iPadOS

La app protege su propio flujo: el kiosco no muestra barra de navegación
personal, y para salir hay que mantener presionado el logotipo 3 segundos y
autorizar con un PIN de gerente. Eso evita salidas accidentales, pero **no puede
impedir** que alguien pulse el botón de inicio y abra Safari.

Eso lo impide el sistema operativo, y **Krealo Shift no intenta reemplazarlo con
trucos inseguros**. En el iPad de la tienda hay que activar Acceso guiado:

1. **Ajustes → Accesibilidad → Acceso guiado** → activar.
2. Entrar en **Ajustes de código** y fijar un código que el personal no conozca.
   Si el iPad tiene Face ID o Touch ID, se puede permitir como salida rápida para
   el gerente.
3. Opcional pero recomendado en un iPad de pedestal:
   - **Ajustes → Pantalla y brillo → Bloqueo automático → Nunca**;
   - **Ajustes → Accesibilidad → Toque → Toque asistido** desactivado;
   - desactivar el Centro de control en la pantalla bloqueada.
4. Abrir **Krealo Shift**.
5. Pulsar **tres veces el botón superior** (o el botón de inicio en los iPad que
   lo tienen).
6. En el panel de Acceso guiado, desactivar lo que no debe usarse —normalmente
   _Teclados_ no, _Toque_ sí, _Botones de volumen_ a criterio— y pulsar
   **Iniciar**.
7. Para salir: tres pulsaciones otra vez e ingresar el código.

Si se reinicia el iPad, Acceso guiado no se reactiva solo: hay que repetir los
pasos 4 a 6. Para varias tiendas conviene el **Modo de app individual** vía MDM
(Apple Business Manager), que sí sobrevive reinicios y no depende de que alguien
se acuerde.

Complemento físico, no software: un soporte con cerradura y el cable de carga
fijo.

## Builds con EAS y TestFlight

`eas.json` define tres perfiles, sin ningún secreto dentro:

| Perfil        | Para qué                                                      | Detalles                                        |
| ------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `development` | development client, para probar en un iPad real desde Windows | `developmentClient: true`, distribución interna |
| `preview`     | build instalable de revisión, sin App Store                   | distribución interna, `Release`                 |
| `production`  | App Store / TestFlight                                        | distribución `store`, `autoIncrement: true`     |

`cli.appVersionSource: "remote"` deja el número de build en manos de EAS: el
`version` (`1.0.0`) vive en `app.config.ts` y el build number lo lleva EAS. Cada
perfil declara además su `environment`, que es de dónde toma EAS las variables de
entorno; eso y `appVersionSource` necesitan un **EAS CLI reciente**
(`npm i -g eas-cli@latest`). Si el CLI se queja de un campo desconocido, es
versión vieja, no un error del archivo.

```bash
eas login
eas build:configure                                   # escribe el projectId en EAS
eas build --platform ios --profile preview
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

`app.config.ts` lee el `projectId` de la variable `EAS_PROJECT_ID`; si prefieres
fijarlo en el archivo, ese es el único lugar donde vive.

### Cambiar el bundle identifier

**Aviso: `com.krealomedia.krealoshift` es una sugerencia y NO está verificado
como disponible** en App Store Connect. Antes de registrar la app hay que
comprobarlo, y si está tomado, cambiarlo.

Está centralizado en `app.config.ts`:

```ts
const IOS_BUNDLE_IDENTIFIER = 'com.krealomedia.krealoshift';
const ANDROID_PACKAGE = 'com.krealomedia.krealoshift';
```

Se cambian esas dos constantes y nada más. Después:

1. registrar el identificador nuevo en el portal de Apple Developer;
2. volver a correr `eas build:configure` si el proyecto de EAS ya existía;
3. hacer un build nuevo — un cambio de bundle id no se puede publicar como
   actualización de la app anterior.

El slug (`krealo-shift`) y el esquema URL (`krealoshift`) están en el mismo
archivo. Cambiar el esquema rompe los enlaces profundos existentes.

### Checklist antes de subir

- [ ] cambiar IDs y URLs temporales: bundle identifier verificado,
      `EXPO_PUBLIC_PRIVACY_URL` y `EXPO_PUBLIC_SUPPORT_EMAIL` reales;
- [ ] cargar los secretos y variables en EAS (`eas env:create` por entorno);
- [ ] vincular el Supabase **productivo**, distinto del de desarrollo;
- [ ] aplicar las migraciones en ese proyecto (`supabase db push`);
- [ ] probar RLS: que un gerente no vea otra ubicación y que una organización no
      vea a la otra;
- [ ] verificar en dispositivo real la **cámara opcional** y las
      **notificaciones**;
- [ ] revisar las traducciones es-PE / en de punta a punta, incluidos errores y
      estados vacíos;
- [ ] revisar la política de privacidad y el Privacy Manifest frente a lo que la
      app realmente recoge (no declarar "no recopila datos" si Supabase procesa
      identificadores y fotos);
- [ ] generar capturas de pantalla originales —nunca de otra app— e icono
      1024×1024 propio;
- [ ] `npx tsc --noEmit`, `npx eslint .` y `npm test` en verde;
- [ ] `eas build --platform ios --profile production`;
- [ ] distribuir primero al **grupo interno de TestFlight**, no a testers
      externos.

## Qué falta

Esto no está terminado y no se disfraza. La lista se revisó archivo por archivo el
2026-08-28: la versión anterior decía que faltaban el panel administrativo, las
notificaciones y el almacenamiento de fotos, y las tres estaban hechas. Una lista de
pendientes equivocada es peor que no tenerla, porque se usa para decidir qué hacer.

**Bloqueado por credenciales o hardware que no tengo** (tarea `aP8PPsGC02bbePX5Oo9i`
y `NBTEQcPVN4AJ8X0Nyazk` en el Publisher):

- **verificación en dispositivo del circuito offline**: la cola local, la
  sincronización y la validación del PIN sin conexión están implementadas
  (`src/lib/offline/`) y con pruebas, pero el flujo completo —cortar la red,
  fichar, recuperarla y comprobar que sincroniza **una sola vez**— solo se puede
  confirmar en un iPad real: es el flujo E2E 2 de `e2e/`;
- **disparador de las alertas**: `send-manager-alerts` está escrita y probada, pero
  hay que llamarla cada 15 minutos desde fuera (documentado en
  `supabase/functions/README.md`). Sin eso las alertas se calculan y no se envían:
  no se pierden, pero nadie se entera;
- **`EAS_PROJECT_ID`**: sin él la app no puede pedir token de push, y el panel lo
  dice con un aviso honesto en vez de un botón que fallaría;
- **secretos de las Edge Functions**: `KIOSK_TOKEN_SECRET` y `MANAGER_ALERTS_TOKEN`.

**Trabajo pendiente de verdad, que sí se puede hacer aquí:**

- **capturas para la App Store del PANEL administrativo**: `scripts/capturas-store.mjs`
  genera 24 capturas —kiosco y acceso, en los tres tamaños que pide App Store Connect y
  en los dos idiomas— y comprueba el tamaño de cada PNG leyendo su cabecera, porque
  Apple rechaza una captura de un píxel de más. Las del panel necesitan una sesión real
  contra un Supabase real, así que el script las hace solo con credenciales:
  `KS_SHOT_EMAIL=... KS_SHOT_PASSWORD=... node scripts/capturas-store.mjs <export>`;
- **revisar el icono con Andree**: hay uno propio, generado por
  `scripts/generar-iconos.mjs` a partir de los tokens de color de la app, y ya no es
  el de la plantilla de Expo. Pero el motivo gráfico es una decisión de marca, y esa
  es suya: si tiene un logotipo de Krealo Shift, sustituirlo es cambiar los PNG o la
  geometría del script, y no toca código;
- **anuncios**: la tabla `announcements` existe, tiene RLS y el seed crea uno, y nada
  en la app los lee todavía. Eso NO es deuda: §26 manda «preparar arquitectura,
  implementar solo después de P0/P1 estable», el modelo de datos de §15 pide la tabla y
  el seed de §29 pide el anuncio de demostración. La tabla está donde debe estar; lo que
  falta es la pantalla, que ninguna sección de §9 ni §11 especifica. Cuando se
  especifique, el camino no es RLS directa: el kiosco no tiene sesión personal, así que
  el anuncio tendría que viajar en el paquete del kiosco, y eso es un cambio de Edge
  Function;
- **resultado de solicitudes sin conexión**: el kiosco muestra el resultado de las
  solicitudes solo con red, y es una decisión escrita (ver
  `20260827001800_kiosk_request_updates.sql`), no un olvido. Si se quisiera offline,
  habría que replicar en el iPad decisiones de un encargado.

**Lo que NO falta, por si la lista anterior confundió a alguien:** el esquema y las
22 migraciones, RLS con 265 aserciones, las 8 Edge Functions, el modo kiosco completo,
el editor de horarios semanal, hojas de tiempo con exportación CSV, correcciones y
aprobaciones, configuración, notificaciones —registro de token, cálculo de alertas y
envío—, fotos de fichaje con bucket privado y URLs firmadas, y español e inglés
completos.

Los nueve eventos de analítica de §31 están instrumentados en sus nueve sitios, con tipo
cerrado y sin un solo campo de texto libre, pero **no se envían a ningún servicio
todavía**: elegirlo y dar sus credenciales es de Andree, y conectarlo es una llamada a
`setAnalyticsSink`. El motivo está en `docs/DECISIONES.md`.

### Lo que necesita la cuenta Apple del propietario

Nada de esto se puede hacer sin las credenciales de Andree:

1. **Apple Developer Program** activo (99 USD/año) en la cuenta que será dueña de
   la app.
2. **Verificar y registrar el bundle identifier** en App Store Connect.
3. **Crear el registro de la app** en App Store Connect: nombre, SKU, idioma
   principal, categoría.
4. **`eas login` y credenciales de firma**: lo más simple es dejar que EAS
   gestione certificados y perfiles; requiere iniciar sesión con el Apple ID
   (con 2FA) una vez.
5. **`ascAppId`, `appleId` y `appleTeamId`** para `eas submit` — se pueden pasar
   de forma interactiva o añadir al perfil `submit.production` de `eas.json`. No
   los pongas en el repositorio si preferís mantenerlos fuera.
6. **Ficha de privacidad de App Store Connect**: declarar identificador de
   dispositivo, datos de uso y fotos, coherente con lo que hace la app.
7. **URL pública de política de privacidad**: obligatoria para publicar.
8. **Grupo interno de TestFlight** con los correos de quienes van a probar.
9. **iPad físico** de la tienda para verificar cámara, notificaciones y Acceso
   guiado.

## Estructura del repositorio

```text
app/            rutas de Expo Router: kiosco, acceso y panel administrativo
src/            componentes, dominio, i18n, stores, tema y utilidades
supabase/       migraciones, Edge Functions, seed y pruebas SQL
scripts/        db-test.sh (pruebas SQL) y seed-demo-users.mjs (usuarios demo)
e2e/            flujos críticos como especificaciones de Maestro
docs/           DECISIONES.md y referencias de diseño de solo lectura
assets/         iconos, splash y fuentes
app.config.ts   única fuente de configuración: nombre, bundle id, permisos, plugins
eas.json        perfiles development, preview y production
```

## Documentos relacionados

| Archivo                        | Qué contiene                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `SECURITY.md`                  | modelo de amenazas, secretos, PIN, credenciales del kiosco, retención, reporte |
| `docs/DECISIONES.md`           | decisiones técnicas y desviaciones, con su motivo                              |
| `supabase/functions/README.md` | contrato de las Edge Functions y la decisión offline pendiente                 |
| `e2e/README.md`                | cómo correr los flujos de Maestro y qué falta para que pasen                   |
| `docs/reference/`              | referencias de diseño traídas del Publisher, de solo lectura                   |
| `CLAUDE.md`                    | reglas del proyecto y de gestión de tareas para agentes                        |
