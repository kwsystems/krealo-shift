# Krealo Shift

Control de asistencia y horarios para tiendas pequeñas. Un iPad fijo en el local
funciona como **reloj compartido (kiosco)**: el personal marca entrada, descanso,
regreso y salida con un PIN personal. Gerentes y administradores usan la misma
app —o su previsualización web— para ver el equipo, armar el horario semanal y
revisar horas.

Aplicación única para iPhone y iPad, hecha con Expo (React Native) y Firebase
(Firestore, Auth con Google y Cloud Functions).

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

**EL RELOJ ES LA WEB PUBLICADA** (decisión de Andree, 2026-09-22). Se abre con su
enlace en el navegador del aparato que haga de reloj en la tienda, se activa una vez con
un código, y a partir de ahí la gente ficha con su PIN. No hay aplicación nativa que
instalar ni aparato dedicado que comprar.

Lo que **no** hace, a propósito:

- **un empleado no necesita cuenta ni instalar nada.** Ficha con su PIN en el reloj de
  la tienda; el acceso con Google es solo para quien administra;
- no hay geolocalización ni mapas. Con el iPad atornillado esto no hacía falta —el
  aparato era la prueba de estar en la tienda—; **con un navegador esa prueba pasa a
  ser la foto, que en web es obligatoria**. Lo que se gana y lo que se asume está en
  `SECURITY.md`, en «El reloj es un navegador, no un iPad atornillado»;
- no hay integración con Shopify, nómina ni chat (eso es P2);
- en web **no se ficha sin red**: la cola vive en memoria y no sobrevive a un recargado,
  así que se prefiere negarlo a la cara antes que prometer un fichaje que se puede
  evaporar.

Ver `docs/DECISIONES.md` para el registro de decisiones técnicas y desviaciones,
y `SECURITY.md` para el modelo de seguridad.

## Requisitos

| Herramienta            | Versión                               | Notas                                |
| ---------------------- | ------------------------------------- | ------------------------------------ |
| Node.js                | 20 LTS o superior                     | `node --version`                     |
| npm                    | 10 o superior                         | viene con Node                       |
| Git                    | cualquiera reciente                   |                                      |
| Cuenta Google          | con acceso al proyecto `krealo-shift` |                                      |
| Firebase CLI           | 14 o superior                         | `npm i -g firebase-tools`            |
| gcloud CLI             | cualquiera reciente                   | solo para Firestore y Secret Manager |
| Cuenta Expo (EAS)      | gratuita para empezar                 | solo para generar builds             |
| Cuenta Apple Developer | del propietario                       | solo para TestFlight                 |
| iPad con iPadOS 16.4+  |                                       | el mínimo lo fija Expo SDK 57        |

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
npm run web:demo                                        # LA WEB CON DATOS DE DEMOSTRACIÓN (sin backend)
npx expo start                                          # servidor de desarrollo (nativo)
npm run web                                             # la web contra Firebase (necesita .env)
npx expo-doctor                                         # revisa el proyecto Expo
npx tsc --noEmit                                        # typecheck (TypeScript strict)
npm test                                                # pruebas Jest
npm run emulador:check                                  # reglas, purga y funciones, con emulador
npx eslint .                                            # lint
npx prettier --check .                                  # formato (npm run format lo arregla)
npx tsc -p functions --noEmit                           # tipos del servidor

node scripts/generar-iconos.mjs                         # regenera icono, splash y favicon
node scripts/render-check.mjs <dir-export>               # ¿pinta cada ruta sin errores de consola?
node scripts/interaccion-check.mjs <dir-export>          # abre la app y la USA: teclea un PIN, toca botones
node scripts/a11y-check.mjs <dir-export>                # contraste, nombres, objetivos táctiles, texto 150%
node scripts/e2e-ids-check.mjs                          # testIDs referenciados que ya no existen
node scripts/coherencia-check.mjs                       # claves i18n huérfanas y controles que no hacen nada
node scripts/capturas-store.mjs <dir-export>            # capturas para la App Store, en los tamaños exactos
node functions/scripts/sembrar.mjs                      # crea las colecciones de Firestore

npm run demo:export                                     # compila la demostración a dist-demo/
npm run demo:check                                      # la recorre en Chromium: ¿hay contenido y son distintas?
npm run demo:export:prod                                # la compila COMO PRODUCCIÓN (dist-demo-prod/)
npm run demo:check:prod                                 # además: ¿arranca la web publicada? ¿el kiosco explica su límite?

npm run web:build                                       # compila la web de producción a dist/
npm run web:deploy                                      # compila y publica en Firebase Hosting

eas login                                               # autenticarse en EAS
eas build:configure                                     # crea/asocia el projectId de EAS
eas build --platform ios --profile preview              # build interno instalable
eas build --platform ios --profile production           # build para App Store/TestFlight
eas submit --platform ios --profile production          # subir el build a App Store Connect
```

Atajos equivalentes definidos en `package.json`: `npm start`, `npm run web`,
`npm run typecheck`, `npm run lint`, `npm run doctor`, `npm test`.

**`npm run demo:check:prod` es el que hay que correr antes de publicar.** Compila la
web como se publica y comprueba que arranca: una guarda mal puesta ya dejó una vez la
web publicada en una página completamente en blanco, y en desarrollo no se notaba.

**Si empaquetas a mano, pon `--clear`.** `expo export` reutiliza la caché de Metro, y
las variables `EXPO_PUBLIC_*` se incrustan al TRANSFORMAR cada módulo, no al
empaquetar. O sea que un `npm run demo:export` previo —que sí lleva
`EXPO_PUBLIC_DEMO=1`— deja en la caché los módulos ya transformados en modo
demostración, y el siguiente `npx expo export` los reutiliza aunque no le pases la
variable: sale un build que se declara de producción y trae la demostración dentro,
con el mismo hash de bundle que el de la demo. Los scripts de `package.json` ya llevan
`--clear`; el que no lo lleva es el comando suelto que copia el CI, y en el CI no
importa porque cada runner empieza con la caché vacía.

**Los ocho arneses de la demostración corren en el CI en cada push**, uno por
runner: `demo`, `kiosco`, `reportes`, `inicio`, `tema`, `contraste`, `responsive` y
`salida`.
Hasta ahora solo corrían a mano y eso costó caro: un commit dejó el reloj web sin
poder fichar —la foto de verificación fallaba siempre— y su CI estuvo en verde; lo
destapó `kiosco:check` corrido a mano un día después. El último, `salida`, vigila otro
modo de fallo: que la hoja que pregunta por qué te vas antes de hora **aparezca**. El
dato puede existir en los dos extremos y la pantalla no salir nunca — ya pasó cinco
veces en este proyecto con campos que compilaban perfectamente. Correrlos en local sigue
siendo lo suyo mientras se trabaja (son más rápidos que esperar al CI), pero ya no
hace falta acordarse.

Ninguna dependencia actual requiere `expo prebuild`: el proyecto sigue en
workflow administrado y todo lo nativo se configura desde `app.config.ts`
(plugins de Expo). Si en el futuro se agrega una dependencia que sí lo exija,
hay que documentarlo aquí; los directorios `/ios` y `/android` están en
`.gitignore` justamente para que el repositorio siga siendo reproducible con EAS.

## Primera vez en Windows

Tres pasos, desde cero, en PowerShell. No hace falta nada más que
[Node.js LTS](https://nodejs.org) y [Git](https://git-scm.com/download/win).

```powershell
# 1. Descargar el proyecto (crea la carpeta krealo-shift en tu usuario)
cd $HOME
git clone https://github.com/kwsystems/krealo-shift.git
cd krealo-shift

# Si YA lo tenías clonado de antes, en vez del clone:
#   cd $HOME\krealo-shift
#   git checkout main
#   git pull
#   npm install     # hay dependencias nuevas desde la última vez

# 2. Instalar dependencias (tarda unos minutos la primera vez)
npm install

# 3. Arrancar con datos de demostración
npm run web:demo
```

Y ya está: se abre el navegador y **estás dentro**, sin crear ninguna cuenta y sin
pegar ninguna clave. Verás el panel completo con datos inventados —quién está
trabajando ahora, el equipo, el horario de la semana, las horas y las solicitudes—
con un aviso permanente de que nada de eso es real.

Es la forma de mirar la aplicación, criticarla y decidir sobre ella sin montar antes
una base de datos. Los datos viven en la memoria de la pestaña y se pierden al
recargar, que es justo lo que uno quiere cuando está probando.

Cuando abra, añade `/kiosk` a la URL para ver el reloj de fichaje:
`http://localhost:8081/kiosk`.

### Con datos de verdad

Con el proyecto de Firebase configurado (ver «Configurar Firebase paso a paso»):

```powershell
Copy-Item .env.example .env
notepad .env    # pega la URL y la anon key
npm run web
```

**Si te equivocas de carpeta**, el síntoma es
`fatal: not a git repository`: significa que no estás dentro de `krealo-shift`.
`cd $HOME\krealo-shift` y vuelve a intentarlo.

### El script que hace los pasos 2 y 3 de una

```powershell
.\scripts\windows-empezar.ps1
```

Si PowerShell responde _"no se puede cargar porque la ejecución de scripts está
deshabilitada"_, es la política de ejecución de Windows, no un problema del proyecto.
Para permitirlo solo en esta ventana:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Los comandos de arriba funcionan siempre y no dependen de esa política.

### Qué se ve y qué no

Con `npm run web:demo` se recorre **todo**: las cinco pestañas del panel con datos, el
kiosco y los dos idiomas. Lo único que no hace es hablar con un servidor de verdad.

| Funciona con `web:demo`                                      | Sigue necesitando Firebase                       |
| ------------------------------------------------------------ | ------------------------------------------------ |
| El panel entero: inicio, equipo, horario, horas, solicitudes | Datos reales de tu negocio                       |
| El kiosco: reloj, teclado de PIN, ayuda, activación          | Validar un PIN de verdad contra la base          |
| Los dos idiomas y el cambio en caliente                      | Que lo que fiches quede guardado en alguna parte |
| Redimensionar la ventana: escritorio, iPad y teléfono        | Correos de recuperación de contraseña            |

Sin `web:demo` **y** sin `.env`, la app se para en «Falta configuración del entorno» y
te dice exactamente qué variables faltan. Eso es a propósito.

## Trabajar desde Windows

El desarrollo diario se puede hacer entero en Windows con la previsualización
web:

```bash
npx expo start --web
```

Se abre en Chrome o Edge. Para revisar el diseño responsive **a mano**, usa las
herramientas de desarrollo del navegador (F12 → _Toggle device toolbar_) con
viewports equivalentes a:

| Objetivo                  | Viewport aproximado |
| ------------------------- | ------------------- |
| iPhone SE / ancho pequeño | 375 × 667           |
| iPhone moderno            | 393 × 852           |
| iPad 10–11" vertical      | 834 × 1194          |
| iPad 10–11" horizontal    | 1194 × 834          |

Pero mirar no basta, y eso está medido: el panel llevaba meses con dieciocho
fallos de ancho que ninguna revisión a ojo había encontrado, entre ellos un
horario que mostraba «03:00 – 09:…» en un portátil y una barra de pestañas que
decía «Hora…» al lado de «Horas». Mirar encuentra lo que revienta; lo que falta
por dos píxeles se lee como «casi bien» y nadie lo reporta.

Para eso está el arnés, que pregunta al navegador la coordenada de cada
elemento en ocho pantallas × siete anchos:

```bash
npm run demo:export
npm run responsive:check
```

Comprueba cuatro cosas: nada se sale de la ventana, ningún texto se recorta sin
haberlo decidido, todo lo que se pulsa llega a 44 × 44, y ningún contenedor
esconde contenido tras un arrastre sin indicio. **El ancho mínimo soportado del
panel son 360 px**; el reloj de fichaje sí baja a 320 y eso lo comprueba
`npm run kiosco:check`. Las seis reglas y su porqué están en
`docs/DECISIONES.md` → «El contrato responsive».

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

## Publicar la web

La web se aloja en **Firebase Hosting** y el backend también es Firebase (decidido con
Andree el 2026-09-14). La configuración está en `firebase.json` y el paso a paso, con
lo que hace falta de tu parte, en **[`docs/FIREBASE-HOSTING.md`](docs/FIREBASE-HOSTING.md)**.

En corto, una vez que exista el proyecto de Firebase:

```powershell
npm install -g firebase-tools   # una sola vez
firebase login                  # una sola vez
firebase use --add              # una sola vez: elige el proyecto

cp .env.example .env            # ANTES de compilar. Ver el aviso de abajo.
npm run web:deploy
npm --prefix functions ci
firebase deploy --only functions
```

**EL `.env` NO ES OPCIONAL Y SU AUSENCIA NO DA ERROR.** Las `EXPO_PUBLIC_*` se hornean
dentro del paquete al compilar; sin `.env`, `expo export` las hornea VACÍAS y termina
en verde. Lo publicado no es la aplicación sino la pantalla «Falta configuración del
entorno». Pasó el 2026-09-21. Por eso `despliegue:check` —que `web:deploy` ejecuta al
final— mira ahora DENTRO del paquete publicado y falla si no encuentra la clave de API
y el identificador del proyecto.

**Y las funciones se despliegan aparte.** `web:deploy` publica solo el alojamiento; si
el cambio tocó `functions/`, la web nueva acaba hablando con funciones viejas. Mirar
`git log <ultimo-despliegue>..HEAD -- functions/` antes de decidir si hace falta.

**Si el despliegue de funciones muere con «Cannot determine backend specification.
Timeout after 10000», no es tu código.** El CLI arranca las funciones en un servidor
local, le pide `/__/functions.yaml` y ese `GET` —que es el que carga los módulos— tiene
**10 segundos fijos**. En Linux el código carga en 632 ms; en Windows, con el antivirus
revisando 1200 paquetes y el disco frío, se pasa de largo y el CLI culpa al código. El
límite se sube con una variable, y va en segundos
(`firebase-tools/lib/deploy/functions/runtimes/discovery/index.js:15`):

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT=300
firebase deploy --only functions
```

Solo vive en esa ventana de PowerShell. Pasó el 2026-09-22 y con eso salió a la primera.

Dos cosas que conviene saber antes:

- El **reloj SÍ funciona en la web publicada** desde el 2026-09-21 (decisión de
  Joseph), con dos límites que la app aplica sola: en web la **foto es obligatoria**
  —es la única prueba de que quien ficha estaba delante, porque la dirección se abre
  desde cualquier sitio— y **no se ficha sin red**, porque la cola en web vive en
  memoria y no sobrevive a un recargado. El porqué completo está en
  `src/lib/kiosk/disponibilidad.ts`.
- **Recargar la página en una ruta interna** (`/team`, `/schedule`) depende del
  reenvío a `index.html` de `firebase.json`. Si alguien quita esa regla, la web
  publicada da 404 al recargar y navegando desde la raíz todo parece correcto. Hay una
  prueba que lo vigila.

## Variables de entorno

Copia la plantilla y rellena:

```bash
cp .env.example .env
```

```dotenv
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
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
  Firebase, y tu terminal cuando corres los scripts de `functions/scripts/`;
- `.env` está en `.gitignore`. `.env.example` es la única versión que se commitea,
  y va vacía;
- las variables se validan con Zod al arrancar (`src/lib/env.ts`). En desarrollo
  se muestra qué falta; en producción no se revelan valores.

Para los builds de EAS, las variables **no** se leen de tu `.env` local: se
configuran en el proyecto de EAS y `eas.json` selecciona el entorno
(`development`, `preview`, `production`) en cada perfil.

```bash
eas env:create --environment preview --name EXPO_PUBLIC_FIREBASE_PROJECT_ID --value "krealo-shift"
eas env:create --environment preview --name EXPO_PUBLIC_FIREBASE_API_KEY --value "<api key>"
```

Repetir para `production`. También se pueden gestionar desde el panel de
expo.dev. Aun siendo públicas, no se commitean.

## Configurar Firebase paso a paso

El proyecto `krealo-shift` ya existe y está configurado: Firestore en
`southamerica-east1`, reglas e índices desplegados, 21 Cloud Functions vivas y las
28 colecciones creadas. Esta sección es para saber qué hay y cómo repetirlo, no un
trámite pendiente.

### Lo que ya está hecho

| Pieza                    | Estado                                                               |
| ------------------------ | -------------------------------------------------------------------- |
| Base Firestore           | `southamerica-east1`, modo nativo. **La región no se puede cambiar** |
| `firestore.rules`        | desplegadas — las políticas RLS traducidas                           |
| `firestore.indexes.json` | 16 índices compuestos, uno por consulta real de la app               |
| `storage.rules`          | desplegadas — fotos cerradas, logo público                           |
| Cloud Functions          | 21, en `southamerica-east1`                                          |
| Colecciones              | 28, creadas por `functions/scripts/sembrar.mjs`                      |
| `KIOSK_TOKEN_SECRET`     | en Secret Manager, declarado en las 4 funciones que lo usan          |

### Lo que falta y solo puede hacer el dueño de la cuenta

**Habilitar el proveedor de Google en Firebase Auth.** Son tres clics y no hay API
pública que los haga: al activarlo, Firebase crea solo el cliente OAuth de web.

1. [console.firebase.google.com/project/krealo-shift/authentication/providers](https://console.firebase.google.com/project/krealo-shift/authentication/providers)
2. **Google** → activar → elegir correo de soporte → **Guardar**.

Hasta que eso pase, nadie puede entrar: el botón está y la ventana de Google
responde que el proveedor está deshabilitado.

Para entrar con Google **en iPad** hace falta además un cliente OAuth de iOS, y su
identificador va en `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Sin él la app lo dice en
pantalla en vez de abrir un navegador que acabaría en un error de Google.

### Arrancar desde cero en otro proyecto

```bash
gcloud auth application-default login
firebase login

gcloud firestore databases create --location=southamerica-east1 --type=firestore-native
firebase deploy --only firestore,storage
npm --prefix functions ci && firebase deploy --only functions

node functions/scripts/sembrar.mjs
```

`sembrar.mjs` es idempotente: usa identificadores fijos y escribe con `merge`, así
que se puede volver a lanzar sin duplicar nada. Con `--solo-ver` dice qué haría sin
escribir.

### Dar acceso a alguien

```bash
node functions/scripts/dar-acceso.mjs alguien@empresa.com --rol admin
node functions/scripts/dar-acceso.mjs --listar
```

Los roles son `owner`, `admin`, `manager` y `employee`; sin `--rol` se asume
`manager`.

**El script resuelve los dos casos y no crea cuentas.** La membresía se identifica
por el `uid` que Firebase asigna al entrar con Google, y ese `uid` no existe antes de
la primera vez:

- si esa persona **ya entró**, le escribe la membresía y tiene efecto al recargar;
- si **no ha entrado nunca**, deja una invitación con su correo. La reclama sola la
  primera vez que entre, y no hay que volver a lanzar nada.

La alternativa a las invitaciones sería fabricarle la cuenta con su correo desde el
servidor. No se hace: es crear la identidad de otra persona en un sistema donde esa
identidad firma horas que se pagan.

### El secreto del token de kiosco

`KIOSK_TOKEN_SECRET` firma los tokens de acción de 90 segundos que emite `verifyPin`
y consumen las funciones que escriben fichajes. Ya está en Secret Manager. Para
rotarlo:

```bash
openssl rand -hex 32 | gcloud secrets versions add KIOSK_TOKEN_SECRET --data-file=-
firebase deploy --only functions
```

Rotarlo invalida los tokens de acción en vuelo, o sea que quien esté con el teclado
del PIN abierto en ese instante tiene que volver a marcarlo. Dura 90 segundos.

### Comprobar que quedó bien

```bash
gcloud firestore indexes composite list --project krealo-shift     # 16, en READY
firebase functions:list --project krealo-shift                      # 21
node functions/scripts/sembrar.mjs --solo-ver                       # 28 colecciones
```

## Pruebas

### Pruebas de la app (Jest)

```bash
npm test              # o: npx jest --ci
npm run test:watch
```

Cubren la máquina de estados de asistencia, las utilidades de tiempo (turnos que
cruzan medianoche, zonas horarias), la paridad de claves entre es-PE e inglés y
los componentes del teclado de PIN y la cuenta regresiva.

### Pruebas con emulador (reglas, purga y Cloud Functions)

```bash
npm run emulador:check
```

Necesita Java —el emulador de Firestore es una JVM— y la CLI de Firebase. Levanta los
emuladores de Firestore y Storage, corre las 42 pruebas y **comprueba que corrieron**:
falla si alguna quedó pendiente o si una suite ni siquiera cargó. Lo segundo no es
paranoia, es que ya pasó dos veces.

Qué cubren:

- **Las reglas de `firestore.rules`**, con `@firebase/rules-unit-testing`: abre una
  sesión falsa con un `uid` concreto y mira qué le deja hacer. Que el hash del PIN no se
  lea desde el cliente, que nadie escriba un fichaje a mano, que alguien de otra empresa
  no vea tus sedes.
- **La purga de fotos de fichaje**, borrando archivos de verdad contra el emulador de
  Storage. La app promete que las fotos se borran a los N días y esto es lo que
  respalda esa frase.
- **Tres Cloud Functions**: `verifyPin` (el PIN de alguien desactivado no abre el reloj,
  el bloqueo por intentos), `submitTimeEvent` (la idempotencia y la forma exacta que el
  reloj valida) y `setMemberRole` (quién puede repartir el poder).

**ESTO REEMPLAZA A LAS 265 ASERCIONES SQL, y no del todo.** Las políticas RLS se
probaban contra un Postgres local con `scripts/db-test.sh`, fila por fila. Ese arnés se
fue con Postgres, y lo de aquí cubre lo mismo en espíritu pero no en extensión: quedan
26 de las 29 funciones sin una sola prueba. El que las escriba, que empiece por las que
tocan horas o accesos.

Y una advertencia por si alguien las mueve: **no pueden correr dentro de `npm test`**.
Ese Jest usa el preset `jest-expo`, que carga los polyfills de React Native en cualquier
entorno y reemplaza `fetch` por uno que aquí no funciona. Viven en
`jest.emulador.config.js` por ese motivo, no por orden.

Lo demás: `npm test` cubre la máquina de estados, las utilidades de tiempo, la paridad
de idiomas y los componentes; y `npx tsc -p functions` cubre que el servidor compile.

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
- [ ] crear el proyecto de Firebase **productivo**, distinto del de desarrollo;
- [ ] desplegar reglas, índices y funciones en ese proyecto, y sembrar sus colecciones;
- [ ] probar RLS: que un gerente no vea otra ubicación y que una organización no
      vea a la otra;
- [ ] verificar en dispositivo real la **cámara opcional** y las
      **notificaciones**;
- [ ] revisar las traducciones es-PE / en de punta a punta, incluidos errores y
      estados vacíos;
- [ ] revisar la política de privacidad y el Privacy Manifest frente a lo que la
      app realmente recoge (no declarar "no recopila datos" si Firebase procesa
      identificadores y fotos);
- [ ] generar capturas de pantalla originales —nunca de otra app— e icono
      1024×1024 propio;
- [ ] `npx tsc --noEmit`, `npx eslint .` y `npm test` en verde;
- [ ] `eas build --platform ios --profile production`;
- [ ] distribuir primero al **grupo interno de TestFlight**, no a testers
      externos.

## Qué falta

Esto no está terminado y no se disfraza. **La lista se revisó entera el 2026-09-21**,
después de mover el backend a Firebase: una lista de pendientes equivocada es peor que
no tenerla, porque se usa para decidir qué hacer.

### Bloquea que alguien pueda entrar

- **Habilitar el proveedor de Google en Firebase Auth.** Tres clics en la consola y
  no hay API que los haga. Hasta entonces el botón está y la ventana de Google
  contesta que el proveedor está deshabilitado. Ver «Configurar Firebase paso a paso».
- **Dar acceso al primer propietario**, con `functions/scripts/dar-acceso.mjs`. Si ya
  entró se aplica al instante; si no, queda invitación y se canjea sola al entrar.

### Lo que dejó a medias la migración a Firebase

- **Las pruebas de las reglas de seguridad.** Eran 265 aserciones SQL que
  impersonaban usuarios contra Postgres, y se fueron con él. Su equivalente
  —`@firebase/rules-unit-testing` sobre el emulador— no está escrito. **Es la deuda
  más grande del proyecto ahora mismo:** las reglas están razonadas y desplegadas,
  pero nada las vigila contra una edición futura.
- **`sendManagerAlerts` no se portó.** Son unas 600 líneas entre cálculo,
  deduplicación y reclamo por lotes. Sin ella las alertas no se calculan ni se envían.
  No rompe la app —la disparaba un programador externo, no el cliente— y su catálogo
  de textos traducidos sí se conservó, en `functions/src/shared/alert-messages.ts`.
- **La purga de fotos de fichaje no está programada.** La hacía `pg_cron` a diario;
  Firestore no tiene equivalente dentro de la base y hace falta un Cloud Scheduler.
  Lo que se olvida aquí son caras de personas guardadas indefinidamente.
- **Entrar con Google en iPad** necesita un cliente OAuth de iOS y su
  `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. La app lo dice en pantalla mientras falte.

### Bloqueado por credenciales o hardware que no tengo

- **verificación en dispositivo del circuito offline**: la cola local, la
  sincronización y la validación del PIN sin conexión están implementadas
  (`src/lib/offline/`) y con pruebas, pero el flujo completo —cortar la red,
  fichar, recuperarla y comprobar que sincroniza **una sola vez**— solo se puede
  confirmar en un iPad real: es el flujo E2E 2 de `e2e/`;
- **`EAS_PROJECT_ID`**: sin él la app no puede pedir token de push, y el panel lo
  dice con un aviso honesto en vez de un botón que fallaría;
- **capturas para la App Store del PANEL administrativo**: `scripts/capturas-store.mjs`
  genera 24 capturas y comprueba el tamaño de cada PNG leyendo su cabecera, porque
  Apple rechaza una captura de un píxel de más. Las del panel necesitan una sesión
  real contra Firebase;
- **revisar el icono con Andree**: hay uno propio, generado por
  `scripts/generar-iconos.mjs` a partir de los tokens de color de la app. El motivo
  gráfico es una decisión de marca, y esa es suya.

### Las pruebas que dependían de CUÁNDO y DÓNDE se corren

- **`week.test.ts` solo pasaba con `TZ=UTC`: arreglado**, y no era la prueba sino el
  código. `formatDateKeyShort('2026-08-27')` devolvía el día ANTERIOR en `America/Lima`
  —la zona del producto—, así que el día equivocado se veía en producción y en CI no,
  porque los runners van en UTC. Una clave `yyyy-MM-dd` es una fecha de calendario y
  lo que se enseña de ella no puede depender de dónde esté el aparato. Ahora el CI
  corre `jest` además en `America/Lima` y en `Europe/Madrid`, y la suite pasa en las
  siete zonas probadas, de UTC-9 a UTC+14.
- **el test de pausas de la demostración fallaba los lunes**: la causa ya no existe.
  Fallaba porque la semilla sembraba «de lunes hasta ayer» y el lunes eso es un rango
  vacío; hoy siembra catorce días (de hace una semana a dentro de seis) y la prueba
  consulta la quincena entera, así que ningún día de la semana deja el rango sin
  filas. **No se ha vuelto a correr un lunes**, que es lo único que lo confirmaría del
  todo: no se puede simular, porque la prueba calcula el lunes de la semana al importar
  el módulo y ninguna zona horaria mueve hoy hasta un lunes. Queda la tarea
  `W3XrXBW0iGe8NDu8kQps` para correrlo un lunes y cerrarlo.

### Decidido, no pendiente

- **anuncios**: la colección `announcements` existe y nada en la app los lee todavía.
  §26 manda «preparar arquitectura, implementar solo después de P0/P1 estable». Lo que
  falta es la pantalla, que ninguna sección de §9 ni §11 especifica. Cuando se
  especifique, el camino no son las reglas: el kiosco no tiene sesión personal, así
  que el anuncio tendría que viajar en el paquete del kiosco;
- **resultado de solicitudes sin conexión**: el kiosco lo muestra solo con red, y es
  una decisión escrita, no un olvido. Si se quisiera offline, habría que replicar en
  el iPad decisiones de un encargado.

### Lo que NO falta, por si la lista anterior confundió a alguien

Las 28 colecciones con sus reglas e índices desplegados, las 21 Cloud Functions, el
modo kiosco completo, el editor de horarios semanal, hojas de tiempo con exportación
CSV, correcciones y aprobaciones, configuración, registro de token de push y cálculo
de alertas en el cliente, fotos de fichaje con URLs firmadas, y español e inglés
completos.

Los nueve eventos de analítica de §31 están instrumentados en sus nueve sitios, con
tipo cerrado y sin un solo campo de texto libre, pero **no se envían a ningún servicio
todavía**: elegirlo y dar sus credenciales es de Andree, y conectarlo es una llamada a
`setAnalyticsSink`.

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
functions/      Cloud Functions, reglas de negocio del servidor y scripts de arranque
scripts/        comprobaciones del paquete web (render, a11y, contraste, interaccion)
e2e/            flujos críticos como especificaciones de Maestro
docs/           DECISIONES.md y referencias de diseño de solo lectura
assets/         iconos, splash y fuentes
app.config.ts   única fuente de configuración: nombre, bundle id, permisos, plugins
eas.json        perfiles development, preview y production
```

## Documentos relacionados

| Archivo              | Qué contiene                                                                   |
| -------------------- | ------------------------------------------------------------------------------ |
| `SECURITY.md`        | modelo de amenazas, secretos, PIN, credenciales del kiosco, retención, reporte |
| `docs/DECISIONES.md` | decisiones técnicas y desviaciones, con su motivo                              |
| `firestore.rules`    | el modelo de permisos, y las tres diferencias con RLS que importan             |
| `e2e/README.md`      | cómo correr los flujos de Maestro y qué falta para que pasen                   |
| `docs/reference/`    | referencias de diseño traídas del Publisher, de solo lectura                   |
| `CLAUDE.md`          | reglas del proyecto y de gestión de tareas para agentes                        |
