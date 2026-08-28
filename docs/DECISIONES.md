# Decisiones técnicas y desviaciones

Registro breve de lo que se decidió, por qué, y qué costó. Existe para que dentro
de seis meses nadie "arregle" a ciegas algo que se hizo así a propósito, y para
que las desviaciones respecto de la especificación maestra estén a la vista en
lugar de escondidas en un commit.

Formato de cada entrada: la decisión, el motivo, el costo aceptado y dónde vive.

Última actualización: 2026-08-27.

---

## Plataforma y configuración

### iOS deployment target 16.4, no 16.0

La especificación (§29) pide "iOS/iPadOS 16 o la versión estable que exijan las
dependencias". **Expo SDK 57 exige 16.4 como mínimo**, así que 16.0 no era una
opción: no es una preferencia nuestra.

- **Costo:** los iPad que se quedaron en iPadOS 16.0–16.3 no pueden instalar la
  app. En la práctica es un conjunto casi vacío, porque 16.4 salió en marzo de
  2023 y llega a todos los iPad que soportan iOS 16.
- **Dónde:** `app.config.ts`, plugin `expo-build-properties`.

### `app.config.ts` como única fuente de configuración

Se eliminó `app.json`. Tener dos archivos que definen el mismo campo termina
siempre igual: alguien edita el que no se usa.

- **Dónde:** `app.config.ts` — nombre, slug, esquema, bundle identifier, permisos
  iOS, plugins, Privacy Manifest.
- **Consecuencia útil:** el bundle identifier vive en una sola constante, así que
  cambiarlo es una línea. **No está verificado como disponible** en App Store
  Connect; el README explica cómo cambiarlo.

### Expo Web como superficie de desarrollo, no como producto

El propietario trabaja desde Windows y necesita revisar pantallas sin un Mac.
`npx expo start --web` abre la app completa; las funciones nativas tienen
adaptadores seguros para que la previsualización no se rompa.

- **Costo:** cámara, notificaciones, SecureStore y Acceso guiado **no** se pueden
  verificar en web. Hay que probarlas en dispositivo real, y está escrito en el
  README para que nadie confunda "funciona en Chrome" con "funciona".
- **Límite explícito:** el respaldo web de SecureStore usa `localStorage`, avisa
  por consola que no es seguro y se niega a funcionar en un build web de
  producción.

### Una precondición no vive en una ruta: vive en su layout

Cuatro veces apareció el mismo fallo, así que quedó como regla. Lo que la app
necesita para funcionar se comprueba en el layout que cubre todas las rutas
afectadas, nunca en una pantalla.

Se llega a una ruta interior sin pasar por la de inicio de cuatro formas
perfectamente normales: un enlace directo, la restauración de ruta al reiniciar la
app, una recarga en la previsualización web —que es como se revisa esto desde
Windows— y un `router.push` de otra pantalla.

Los cuatro casos, y qué se veía en cada uno:

| Precondición              | Estaba en                                                  | Se veía                                                                                                    |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| configuración del entorno | `app/index.tsx`                                            | el kiosco completo; al teclear el PIN, "inténtalo otra vez", que es imposible sin servidor                 |
| arranque de la sesión     | `app/index.tsx`                                            | entrar por otra ruta no arrancaba nunca la sesión                                                          |
| resolución de rol         | duplicada en `app/index.tsx` y `app/(manager)/_layout.tsx` | una cuenta de empleado rebotaba al acceso, iniciaba sesión bien y volvía al acceso: encerrada, sin mensaje |
| credencial del kiosco     | `app/kiosk/index.tsx`                                      | `/kiosk/actions` y `/kiosk/exit` pintaban su teclado y al completar el PIN no pasaba nada                  |

Las tres primeras subieron a `app/_layout.tsx`; la cuarta, a `app/kiosk/_layout.tsx`.
La de rol, además, estaba escrita DOS veces y las dos copias divergían a partir del
tercer paso: ahí nació el callejón sin salida. Vive en
`src/features/boot/resolve.ts`, es una función pura, y las dos rutas la leen — por
eso ya no pueden contestar cosas distintas ni rebotarse la una a la otra.

- **Costo:** la guarda del layout del kiosco necesita una lista de rutas exentas
  (`setup` crea la credencial, `help` es texto, `exit` la borra). Una lista de
  excepciones se degrada si crece sin que nadie mire, así que hay una prueba que
  exige que sigan siendo exactamente esas tres.
- **Cómo se encontraron:** usando la app en un navegador, no renderizándola.
  `scripts/render-check.mjs` daba las cuatro pantallas por buenas, porque se pintan
  perfectas; `scripts/interaccion-check.mjs` teclea un PIN de verdad y las cuatro
  fallaron. Un control que no hace nada es invisible para cualquier chequeo que solo
  mire píxeles.

### El kiosco en iPad horizontal usa dos columnas

En horizontal el reloj y el teclado se apilaban en una columna centrada, así que quedaban
dos franjas vacías a los lados. §33 lo prohíbe: «No aparecen formularios estrechos
flotando en un iPad vacío; usar composición adaptable». Ahora, con `isWide && isLandscape`,
el reloj va a un lado y el teclado al otro.

- **Cómo se encontró:** haciendo las capturas para la App Store a 2732×2048. Ninguna
  prueba lo veía, porque la pantalla renderizaba perfectamente: lo que estaba mal era la
  composición, y eso solo se ve mirándola al tamaño real.
- **`isLandscape` ya existía en `useResponsive` y no la usaba nadie:** la adaptación
  estaba prevista y sin hacer.
- **Costo, y el ajuste que hizo falta:** al pasar a dos columnas el reloj a 64 dejó de ser
  el elemento dominante que pide §9.1 —el título de la otra columna se leía primero—, así
  que en dos columnas sube a 120. Se comprobó en la captura, no se supuso.
- **Vertical no cambia:** ni en iPad ni en teléfono.

### El nombre de la organización, no el de la app, en el reloj de la tienda

Sin logotipo cargado, la cabecera del kiosco mostraba «Krealo Shift». El comentario justo
encima decía lo contrario: «Quien entra a la tienda tiene que reconocer el negocio, no la
herramienta que usa el negocio». Ahora muestra el nombre de la organización, que el
binding ya trae, y el de la app queda como último recurso.

- **Por qué se anota:** el código contradecía su propio comentario, y esa clase de fallo
  sobrevive porque quien lee el comentario da por hecho que el código hace lo que dice.

### La analítica mide, pero todavía no envía a ningún sitio

Los nueve eventos de §31 están instrumentados en sus nueve sitios, con tipo cerrado y
pruebas. El destino es un `sink` reemplazable: en desarrollo escribe en consola, en
producción no hace nada.

- **Por qué así:** elegir el servicio —Amplitude, PostHog, otro— y dar sus credenciales
  es de Andree, y no se puede inventar. Lo que sí se podía hacer es la parte que se
  pudre si se deja: SABER CUÁNDO se envía cada evento. Un `time_action_completed` puesto
  en el sitio equivocado se descubre meses después, cuando los números no cuadran y ya
  nadie recuerda qué se quiso medir.
- **Qué falta para conectarlo:** una llamada a `setAnalyticsSink`, no buscar nueve
  sitios.
- **Costo aceptado:** hoy no se mide nada en producción. La alternativa era no
  instrumentar, y entonces conectar el servicio el día que exista seguiría siendo el
  trabajo entero.
- **Lo que la analítica NO puede llevar:** §31 prohíbe nombre, PIN, foto y notas. Las
  propiedades de los nueve eventos son números, booleanos y enumerados cerrados: no hay
  ni un campo de texto libre, y hay una prueba que lo comprueba leyendo el tipo. Un
  `sync_failed` manda la CATEGORÍA del fallo y no el mensaje del servidor, porque un
  mensaje es texto libre y basta con que una restricción de la base incluya un nombre
  algún día.

### Sin crash reporting, y sin la variable que lo prometía

`EXPO_PUBLIC_SENTRY_DSN` estaba declarada y validada en `src/lib/env.ts`, y no la leía
nadie: no hay SDK de crash reporting en el proyecto. Se quitó.

- **Por qué quitarla y no dejarla:** una variable de entorno que no se usa es una
  promesa. Alguien pega un DSN, reinicia, y no se reporta nada —y es peor en esta que en
  cualquier otra, porque es la que sirve justo para saber que la app se rompió—.
- **Qué haría falta:** elegir el servicio y dar el DSN es de Andree; añadir el SDK toca
  la compilación nativa. Cuando exista, la variable vuelve JUNTO al SDK que la use.

### La tabla `announcements` sin pantalla es lo pedido, no un olvido

Existe con RLS y el seed crea un anuncio, y nada en la app los lee. Se revisó por si era
deuda y no lo es: §26 manda «preparar arquitectura, implementar solo después de P0/P1
estable», §15 pide la tabla con vigencia, autor y confirmación opcional, y §29 pide el
anuncio de demostración. Ninguna sección de §9 ni §11 especifica una pantalla.

- **Por qué se anota:** porque una tabla que nadie consulta parece un descuido, y quien
  la encuentre va a suponer que hay una función detrás y buscarla.
- **Qué haría falta para mostrarla:** NO se resuelve con RLS directa. El kiosco es la
  única superficie que ven los empleados y no tiene sesión personal —usa credencial de
  dispositivo contra Edge Functions—, así que el anuncio vigente tendría que viajar en el
  paquete del kiosco. Es un cambio de Edge Function y un despliegue, no una pantalla.

### Build number administrado por EAS

`eas.json` usa `cli.appVersionSource: "remote"` y `autoIncrement: true` en
`production`. El `version` legible (`1.0.0`) sigue en `app.config.ts`.

- **Por qué:** un número de build en Git es una fuente de conflictos de merge y de
  builds rechazados por número repetido.

---

## Seguridad

### bcrypt coste 12 en lugar de Argon2id

La especificación (§8) pide Argon2id "o un mecanismo robusto disponible en la
función segura". **Argon2 no existe en PostgreSQL ni en pgcrypto**, y Supabase no
permite instalar extensiones arbitrarias. La alternativa era mover el hash a una
Edge Function con una implementación de Argon2 en Deno.

- **Decisión:** bcrypt coste 12 dentro de la base, vía `crypt()` y
  `gen_salt('bf', 12)`.
- **Por qué:** mantener el hash, el contador de intentos y el bloqueo en la misma
  transacción vale más que ganar un algoritmo. Para un secreto de 4–6 dígitos, el
  límite de 5 intentos y el bloqueo de 15 minutos pesan mucho más que la función
  de derivación.
- **Costo:** desviación consciente de la letra de la especificación.
- **Dónde:** `supabase/migrations/20260827000300_functions.sql`, cabecera del
  archivo y `set_employee_pin`.

### Dos credenciales distintas para el kiosco

Credencial de dispositivo de larga vida (ligada a un iPad y a **una** ubicación) +
token de acción de 90 segundos (ligado a empleado, kiosco y ubicación, firmado con
HMAC y comparado en tiempo constante).

- **Por qué:** con una sola credencial, quien conociera la del iPad podría fichar
  por cualquiera.
- **Dónde:** `supabase/functions/_shared/kiosk-auth.ts`, `SECURITY.md`.

### Validación del PIN sin conexión: verificador ligado al dispositivo

El servidor guarda el PIN con bcrypt, o sea de forma irreversible, así que no
puede derivar un verificador por dispositivo sin conocer el PIN en claro. Había
cuatro salidas (están en `SECURITY.md`). Se eligió la cuarta: el servidor manda el
**salt** de bcrypt y `sha256(clave_del_dispositivo || ':' || hash)`, nunca el hash.
El iPad calcula `bcrypt(PIN, salt)`, lo re-deriva con su clave del Keychain y
compara.

- **Por qué:** descarta guardar el PIN de forma reversible, que era el peor final;
  funciona en cualquier iPad, incluso activado después de que el equipo ya tenía
  PIN — la alternativa dejaba esos iPad sin offline "hasta la próxima rotación de
  PIN", que en una tienda real es nunca; y el archivo local por sí solo no sirve
  para comprobar ni un intento.
- **Se implementó primero la opción 3 —el hash bcrypt en el dispositivo— y se
  cambió:** dejaba el hash en el SQLite del iPad, y un archivo SQLite se exfiltra
  mucho más fácil que el Keychain (un backup sin cifrar, un bug de compartición).
  Con el hash en mano se prueban los 10⁶ PIN sin volver a tocar el iPad. El cambio
  no cuesta nada en el dispositivo: el mismo bcrypt, un sha256 más.
- **Costo aceptado:** quien extraiga **también** la clave del Keychain —acceso
  físico y jailbreak, no solo un backup— vuelve al escenario anterior: 10⁶ PIN
  contra bcrypt coste 10, o sea horas por empleado. Revocar el dispositivo lo corta.
- **Coste 10 y no 12 solo para el hash offline:** lo calcula `bcryptjs` en
  JavaScript sobre el dispositivo; con coste 12 son segundos por intento con gente
  esperando para fichar. El hash del servidor sigue en coste 12.
- **Digest con clave y no HMAC formal:** `expo-crypto` solo expone digest sobre
  cadenas UTF-8, así que un HMAC real no se puede calcular igual en Postgres y en
  Hermes sin otra dependencia de criptografía. La extensión de longitud —la
  debilidad conocida frente a HMAC— no aplica: mensaje de formato fijo y
  comparación de igualdad.
- **La clave es un secreto separado de la credencial de peticiones:** rotar una no
  invalida la otra, y la que viaja en cada llamada no es la que protege los
  verificadores guardados.
- **Y lo que no se relajó:** el límite de 5 intentos y el bloqueo de 15 minutos se
  aplican también offline, contados en el dispositivo. Si el bloqueo viviera solo
  en el servidor, quedarse sin red sería la forma de saltárselo.
- **Cómo se comprueba que las dos puntas coinciden:** vector de prueba real en
  `src/lib/offline/__tests__/pin-derivation.test.ts` (generado con pgcrypto) y
  aserciones en `supabase/tests/20_functions.sql`, entre ellas que el hash completo
  nunca sale de la base.
- **Dónde:** `supabase/migrations/20260827000700_offline_verifier_device_key.sql`,
  `src/lib/offline/pin.ts`, `supabase/functions/refresh-kiosk-roster/`.

### La foto se sube después del fichaje, no con él

`attach-photo` recibe la imagen aparte, cuando el evento ya existe, y solo entonces
escribe `photo_path`.

- **Por qué no con el fichaje:** obligaría a apuntar la columna antes de que el
  archivo exista, y cada subida fallida dejaría `photo_path` señalando a un objeto
  inexistente, indistinguible de una foto ya purgada. Además haría esperar a la
  persona por una imagen de hasta 2 MB con la red de una tienda.
- **Por qué no con URL firmada de subida, que es lo habitual:** mismo problema de
  orden, y le daría al iPad una capacidad de escritura sobre Storage que no
  necesita. El costo de pasar la imagen por la función es ancho de banda, y con el
  bucket limitado a 2 MB es asumible.
- **Lo que arregló por el camino:** el cliente enviaba como `photo_path` el URI
  local del archivo en el iPad, que en la base de datos no significa nada; y la
  cola local marcaba la foto como subida en cuanto el fichaje se aceptaba, sin que
  nadie hubiera subido nada. Las fotos se quedaban en el iPad para siempre mientras
  la cola decía que estaban en el servidor.
- **Costo aceptado:** una foto puede tardar en llegar, o no llegar. Se reintenta
  indefinidamente y no se descarta por número de intentos, porque una foto
  pendiente no impide contar las horas.
- **Dónde:** `supabase/functions/attach-photo/`,
  `supabase/migrations/20260827000800_attendance_photos.sql`, `src/lib/offline/sync.ts`.

### Una sola excepción a append-only, del tamaño exacto de la retención

`time_events` acepta un update solo si la única columna que cambia es `photo_path`.

- **Por qué hacía falta:** el disparador rechazaba TODO update, así que la purga por
  retención no podía borrar la foto. Sin excepción, la app guardaba fotos de
  personas para siempre. Es un conflicto real entre dos reglas correctas.
- **Por qué esa columna y no otra:** no es un dato del fichaje, es un puntero a un
  archivo cuyo ciclo de vida es mutable por naturaleza —se sube después, se borra
  antes—. Las horas trabajadas, que es lo que append-only protege, no se tocan.
- **Por qué en las dos direcciones:** solo hacia null bastaría para la purga, pero
  obligaría a escribir el puntero antes de que el archivo exista.
- **Cómo se comprueba que la excepción no se ensanchó:** la comparación es sobre las
  filas en jsonb con `photo_path` anulado, así que una columna nueva queda protegida
  sin que nadie tenga que acordarse. Hay pruebas de que no se puede cambiar hora,
  tipo ni empleado, ni colar otro cambio junto con la foto.
- **Dónde:** `supabase/migrations/20260827000800_attendance_photos.sql`,
  `supabase/tests/20_functions.sql`.

### Quién es gerente lo decide el servidor

`kiosk_employee_context` devuelve `canManageLocation`, y la autorización de
entrada temprana exige además que quien autoriza sea distinto de quien ficha.

- **Por qué:** dejárselo deducir al cliente habría convertido cualquier PIN en un
  PIN de gerente.
- **Dónde:** `supabase/migrations/20260827000500_kiosk_context.sql`,
  `app/kiosk/actions.tsx`.

### Errores traducidos desde el `errcode`, nunca desde el texto

Las Edge Functions traducen el error de Postgres por su código, no comparando
mensajes, y jamás devuelven el mensaje crudo de la base al cliente.

- **Por qué:** comparar textos se rompe con un cambio de idioma o de versión de
  Postgres, y filtrar el mensaje interno es una fuga de información.

### `time_events` y `audit_logs` son append-only

Triggers rechazan `update` y `delete`. Una corrección es una fila nueva en
`time_adjustments`, con valor anterior, autor y motivo.

- **Por qué:** los eventos crudos son la única prueba de lo que pasó. Si se pueden
  editar, no prueban nada.

---

## Modelo de datos y lógica

### `clock_timestamp()` y una secuencia monótona para ordenar eventos

`now()` devuelve el **mismo** valor durante toda una transacción, y la
sincronización offline procesa un lote entero en una sola transacción. Con `now()`
varios eventos compartían instante y el estado se resolvía mal.

- **Decisión:** `clock_timestamp()` más una secuencia monótona como criterio de
  desempate.
- **Cómo se encontró:** una prueba, no la lectura del código.
- **Dónde:** `supabase/migrations/20260827000300_functions.sql`.

### Un `record` de plpgsql no es nulo solo si TODOS sus campos lo son

La rama "salir con un descanso abierto" nunca se activaba: un descanso abierto
tiene `ends_at` nulo, así que el `record` daba por nulo el registro entero. Se
comprueba la clave primaria.

- **Dónde:** misma migración de funciones.

### Se pregunta el tipo de descanso; no se asume

Comida, pagado o no pagado. De eso depende si esos minutos cuentan como
trabajados, y adivinarlo es adivinar el sueldo de alguien.

- **Dónde:** `src/components/attendance/kiosk-sheets.tsx`, `app/kiosk/actions.tsx`.

### El descanso obligatorio no se inventa al marcar salida

Si al salir falta el descanso obligatorio, la app pregunta. Si la persona dice que
lo tomó y no lo registró, se crea una **solicitud auditable**, no una corrección
silenciosa de la hoja de tiempo.

- **Por qué:** corregir la hoja sin dejar rastro es exactamente lo que la
  auditoría existe para impedir.

### La foto del fichaje es opcional, está apagada por defecto y nunca bloquea

Se toma solo en el paso de confirmación. Si falta el permiso o la cámara falla, el
fichaje sigue y se avisa.

- **Pendiente:** el bucket privado de Storage, las URLs firmadas y el purgado por
  retención. Hasta que existan, no activar `photoEnabled` en una tienda real.

---

## Pruebas y proceso

### Maestro para los flujos E2E, no Detox

La especificación (§4) prioriza Maestro "por facilidad de mantenimiento". Se
siguió: YAML, sin compilar una variante de pruebas, corriendo contra el binario
instalado.

- **Costo:** en iOS, Maestro no puede conmutar la red, así que el flujo offline
  tiene un paso manual documentado.
- **Dónde:** `e2e/`.

### Tres trampas de React Native Testing Library 14

`render`, `cleanup` y `fireEvent` son **asíncronos**, y el objeto que devuelve
`render` ya no trae las consultas. Sin los `await`, solo pasa la primera prueba de
cada archivo y el error apunta al sitio equivocado.

- **Dónde:** `jest.setup.ts` (el `afterEach` con `await cleanup()`) y
  `src/test-utils/render.tsx`.

### CI sin secretos

`.github/workflows/ci.yml` corre lint, typecheck, pruebas y validación del YAML de
Maestro. No pide credenciales de Supabase, Expo ni Apple, así que funciona en un
clon recién hecho y en un fork.

- **Costo:** las pruebas SQL (`scripts/db-test.sh`) y los builds de EAS quedan
  fuera de CI. Son tareas locales documentadas en el README.

### Las pruebas SQL corren contra un Postgres real con un shim de `auth`

`supabase/tests/00_supabase_shim.sql` reproduce lo mínimo del esquema `auth` de
Supabase que usan las migraciones —`auth.users`, `auth.uid()`, `auth.role()` y los
roles `anon`, `authenticated`, `service_role`— para poder impersonar usuarios y
probar RLS de verdad sin la nube ni el CLI.

- **Costo:** el script asume Linux, `su postgres` y un clúster de PostgreSQL 16 ya
  inicializado y escuchando; **no** lo crea ni lo arranca. Desde Windows hay que
  usar WSL.

---

## Datos demo

### Contraseñas de demo desde el entorno, correos en `.invalid`

`scripts/seed-demo-users.mjs` lee `DEMO_PASSWORD` de una variable de entorno y
exige 12 caracteres. Los correos usan el TLD reservado `.invalid`.

- **Por qué:** ninguna contraseña en Git, y ningún demo puede escribirle a una
  persona real.
- **Nota:** los PIN y la credencial del kiosco demo sí son valores obvios dentro de
  `supabase/seed.sql`, marcados ahí como de demostración. No sirven para
  producción.

### Los turnos demo son relativos a `now()`

Así el demo siempre muestra a alguien trabajando, alguien en descanso, alguien
atrasado y alguien sin turno, sin regenerar datos cada semana. El seed es
idempotente.

---

## Referencias de diseño

### Contradicciones entre los dos documentos del Publisher

`docs/reference/` trae `DESIGN.md` y `DESIGN-SYSTEM.md` de
`kwsystems/krealo-publisher` como referencia de **solo lectura**. Se documentaron
tres contradicciones entre ambos (radio de tarjetas, origen de los toasts y
retícula de espaciado), resueltas a favor del documento más reciente.

- **Dónde:** `docs/reference/README.md`.

---

## Gestión del proyecto

### Empresa temporal en Krealo Publisher: "Universo Tutu"

Las tareas creadas con `companyName: "Krealo Shift"` **no se renderizan en la UI
de Publisher**, aunque la API las devuelve correctamente. Verificado creando una
tarea de prueba en otra empresa, que apareció sin problema.

Por indicación de Andree, mientras no se arregle: las tareas van a
`companyName: "Universo Tutu"` con el prefijo **`Krealo Shift · `** en el título,
porque Universo Tutu es un cliente real y su tablero no debe confundirse con
trabajo del proyecto.

- **Costo:** las 10 tareas originales quedaron cerradas en `done` con una nota de
  migración. No se pudieron mover: `companyName` no es editable en `/tasks/update`
  y la API no tiene endpoint de borrado.
- **Cómo revertirlo:** cuando la empresa Krealo Shift funcione, volver a
  `companyName: "Krealo Shift"`, quitar el prefijo y recrear allí las tareas
  abiertas.
- **Dónde:** `CLAUDE.md`, sección "Excepción temporal de empresa".

### Los 219 skills no están commiteados

Están en disco y funcionando, pero 34 contienen material interno de clientes y
este repositorio es público. Quedan excluidos de git (`.git/info/exclude`) hasta
que el repositorio pase a privado.

- **Dónde:** `CLAUDE.md`, sección "Skills instalados".

---

## Cómo agregar una entrada

Una decisión entra acá si alguien podría querer revertirla sin conocer el motivo:
una desviación de la especificación, una limitación de una herramienta, un bug
sutil que costó encontrar, o un costo que se aceptó a sabiendas. Escribí el
motivo y el costo, no solo la conclusión — la conclusión ya está en el código.
