# Decisiones técnicas y desviaciones

Registro breve de lo que se decidió, por qué, y qué costó. Existe para que dentro
de seis meses nadie "arregle" a ciegas algo que se hizo así a propósito, y para
que las desviaciones respecto de la especificación maestra estén a la vista en
lugar de escondidas en un commit.

Formato de cada entrada: la decisión, el motivo, el costo aceptado y dónde vive.

Última actualización: 2026-09-22.

> **LAS RUTAS DE LAS ENTRADAS ANTERIORES A 2026-09-21 APUNTAN A ARCHIVOS BORRADOS.**
> Casi todas dicen `supabase/migrations/…` o `supabase/functions/…`, y ese directorio
> ya no existe. No se han corregido una por una a propósito: cada entrada dice qué se
> decidió **en su momento y con qué información**, y reescribirle la ruta a una
> decisión de agosto para que apunte a código de septiembre convierte un registro
> histórico en una ficción ordenada. Lo que se decidió sigue siendo cierto; dónde
> vive, no. La entrada de abajo explica el traslado.

---

## Producto

### El reloj de la tienda es la web, no un iPad (2026-09-22)

**Decisión.** Por indicación de Andree, el reloj es la aplicación web publicada, abierta
con su enlace en el navegador del aparato que haga de reloj. Se acaba la vía del iPad:
no hay compilación con EAS, ni App Store, ni aparato dedicado que comprar.

**Motivo.** Sin build no hay reloj, ni bueno ni malo. Un reloj con límites conocidos vale
más que ninguno, y la vía nativa exigía cuenta de Apple, un aparato y un ciclo de
revisión antes de que nadie pudiera fichar por primera vez.

**Costo aceptado, y es de verdad.** El modelo de seguridad descansaba en un objeto
físico: un iPad en la pared, credencial en el Keychain y Acceso Guiado impidiendo salir
de la app. Estar delante del reloj era, por sí solo, prueba de estar en la tienda. Con
una dirección web eso deja de ser cierto.

Lo que ocupa ese sitio es **la foto, que en web es obligatoria** —en el iPad era
opcional—, y sigue haciendo falta activar el navegador con un código de un solo uso y
acertar un PIN para cada acción. Lo que queda asumido: la credencial vive en
`localStorage` en vez del Keychain, y un navegador activado y llevado a otro sitio sigue
fichando, porque la foto muestra una cara y no un lugar. Si eso llega a importar, las
salidas son geolocalización al fichar o restricción por IP de la tienda; ninguna está
hecha.

Tampoco se ficha sin red en web: la cola vive en memoria y no sobrevive a un recargado,
así que se niega a la cara en vez de prometer un fichaje que se puede evaporar.

**Dónde vive.** `src/lib/kiosk/disponibilidad.ts` tiene el porqué de cada límite;
`SECURITY.md` («El reloj es un navegador, no un iPad atornillado») tiene el modelo de
amenazas actualizado; el README, el alcance.

**Lo que NO se borra por esto.** La app sigue siendo Expo y el CI sigue empaquetando
para iOS: cuesta poco y deja la puerta abierta si algún día se quiere la vía nativa.
Quitarlo sería cerrarla a cambio de nada.

---

## Backend

### Todo el backend pasa de Supabase a Firebase (2026-09-21)

**Decisión.** Por indicación de Joseph, el backend deja de ser Supabase y pasa a ser
Firebase en el proyecto `krealo-shift`: Firestore en `southamerica-east1`, Auth con
Google y 21 Cloud Functions. Se borró `supabase/` entero — 22 migraciones, 8 Edge
Functions y 5 archivos de pruebas SQL.

**Qué se conservó, y no por comodidad.** Los nombres de las colecciones y de los
campos son EXACTAMENTE los de las tablas y columnas de Postgres. Eso dejó intactos
los esquemas Zod, las pruebas y los 62 puntos de llamada, y concentró todo el riesgo
del cambio en un solo archivo (`src/lib/firebase/query.ts`). Se pudo hacer porque las
consultas de esta app son planas: se comprobó que no hay ni un `select` anidado de
PostgREST en el repositorio antes de decidirlo.

La máquina de estados de asistencia tampoco se reescribió: `functions/` la importa de
`src/domain/`, la misma que usa el iPad. Antes había dos copias —una en SQL y otra en
TypeScript— con una prueba de paridad vigilándolas; ahora no hay dos cosas que puedan
desalinearse.

**Costo aceptado, y es real.**

1. **Las 265 aserciones de RLS desaparecieron.** Se probaban contra un Postgres local
   impersonando usuarios. Su equivalente —`@firebase/rules-unit-testing` sobre el
   emulador— no está escrito. Las reglas están razonadas y desplegadas, pero nada las
   vigila contra una edición futura. Es la deuda más grande que deja el traslado.
2. **`sendManagerAlerts` no se portó.** Son unas 600 líneas entre cálculo,
   deduplicación y reclamo por lotes. Sin ella las alertas no salen. No rompe la app:
   nadie la llamaba desde el cliente.
3. **Se acabó «olvidé mi contraseña».** Con Google no hay contraseña nuestra que
   recuperar, así que `password-reset.ts` y `/restablecer` se borraron en lugar de
   quedarse como botones muertos.
4. **`z.string().uuid()` pasó a `docId()`.** Los id deterministas —`{orgId}_{uid}`
   para una membresía, `{orgId}_{clave}` para un fichaje— son lo que permite que una
   regla resuelva permisos con UN `get()` y que reintentar un fichaje no lo duplique.
   Eso es incompatible con la forma de UUID, y se eligió la idempotencia. No se pierde
   ninguna defensa: `.uuid()` era una comprobación de forma, no un control.

**Dónde:** `firestore.rules`, `firestore.indexes.json`, `storage.rules`,
`functions/`, `src/lib/firebase/`.

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

### Los seis componentes de §25 que no existen con ese nombre

§25 lista 23 componentes reutilizables mínimos. Seis no existen con ese nombre —`AppHeader`,
`Avatar`, `TimeDisplay`, `AttendanceStatusCard`, `TimelineEvent`, `ResponsiveSidebar`— y se
revisó uno por uno si eso era un hueco. No lo es: la capacidad está, repartida en piezas más
pequeñas o resuelta por el framework.

- **`AppHeader` y `TimeDisplay`:** las piezas compartidas ya existen y son `AppText` con sus
  variantes (`variant="title"`, `tabular`). Envolverlas en un componente por cada uso de una
  línea añade una capa que no quita ninguna duplicación.
- **`Avatar`:** las iniciales se pintan en UN solo sitio, la identificación del kiosco. Un
  componente reutilizable con un uso no es reutilizable, es una indirección.
- **`AttendanceStatusCard`:** existe como composición —avatar, saludo, `StatusBadge` con el
  color del estado y «trabajando desde HH:mm»— y es lo que cumple el primer criterio visual
  de §33: entender en menos de tres segundos si estás fuera de turno, trabajando o en
  descanso.
- **`TimelineEvent`:** el historial de eventos usa `KeyValueRow`, que hace lo mismo.
- **`ResponsiveSidebar`:** lo da Expo Router con `tabBarPosition: 'left'` y
  `tabBarVariant: 'material'`, decidido por `useResponsive().useSidebar`. Un componente
  propio sería reimplementar la navegación del framework para que el nombre coincida.

- **Por qué se anota:** porque la lista de §25 es una lista de nombres y alguien va a
  comprobarla. Crear seis envoltorios finos para que los nombres cuadren es justo la deuda
  que este proyecto pasó una sesión entera quitando: cosas declaradas que nadie usa.
- **Lo que sí se hizo:** extraer los componentes cuando había un motivo real —las filas de
  las listas, para poder virtualizar y probar—, no para completar una lista.

### Dos listas virtualizadas de tres, y por qué la tercera no

§23 pide listas virtualizadas y no había ni un `FlatList` en la app: las tres listas se
pintaban con `.map()` dentro de un `ScrollView`, o sea montando todas las filas de golpe.
Con los cuatro empleados del seed no se nota nada, que es por lo que sobrevivió.

Se virtualizaron las dos que crecen sin techo:

- **hoja de tiempo**: un mes de un local con cincuenta personas son más de mil filas;
- **equipo**: una empresa de verdad tiene cientos de empleados.

**La bandeja de solicitudes NO**, y es una decisión, no un olvido: comparte pantalla con
el panel de configuración, que es un formulario largo y tiene que scrollear entero. Una
lista virtualizada dentro de ese `ScrollView` no virtualizaría nada —React Native lo avisa
por consola— así que habría que partir la pantalla en dos, y lo que se gana es poco: la
bandeja solo contiene lo que un gerente todavía no ha resuelto.

- **Cómo se comprueba, sin backend:** las listas son componentes que reciben un array, así
  que una prueba les da 300 filas y comprueba que la 250 NO está montada. Con `.map()`
  estarían las 300 y la prueba falla — verificado volviendo a poner el `.map()`. La otra
  mitad también se prueba: una lista corta se monta entera, porque una prueba que solo
  exige filas ausentes pasaría con una lista que no muestra nada.
- **Lo que NO se puede verificar aquí:** cómo queda la pantalla completa con datos reales,
  porque necesita una sesión de Supabase. El scroll de la pantalla pasa a ser el de la
  lista, con la cabecera y los filtros fijos arriba — que en iPad es mejor y en teléfono
  hay que mirarlo en el dispositivo (tarea `NBTEQcPVN4AJ8X0Nyazk`).

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

`.github/workflows/ci.yml` corre lint, formato, typecheck, pruebas, los empaquetados
de web e iOS, seis chequeos de Chromium sobre el export sin demostración, los siete
arneses de la demostración y la validación del YAML de Maestro. No pide credenciales
de Firebase, Expo ni Apple, así que funciona en un clon recién hecho y en un fork.

- **Costo:** las pruebas de las reglas de Firestore y los builds de EAS quedan fuera
  de CI. Son tareas locales documentadas en el README.

### Los arneses esperan POR LA PANTALLA, nunca un número de milisegundos (2026-09-22)

Cada arnés de navegador esperaba un tiempo fijo después de cada navegación —49 en
total, de 150 a 3.200 ms— afinado en una máquina concreta. Eso los mantuvo FUERA del
CI durante meses, y con razón: en un runner compartido más lento una espera corta
hace que el arnés mida una pantalla a medio montar, y el rojo que sale no es de la
app, es del reloj. Un arnés que da rojos que no son culpa de nadie se acaba
ignorando, y uno ignorado es peor que no tenerlo.

Ahora toda espera de navegación es por el MARCADOR de la pantalla —un texto o un
`testID` que solo sale ahí—, declarado una sola vez en `MARCADORES`
(`scripts/lib/arnes-web.mjs`), con el número solo como techo. Una máquina lenta
tarda más en vez de fallar.

- **La regla:** un arnés nuevo NO añade un `waitForTimeout` después de un `goto` ni
  de un clic que cambie de pantalla. Usa `irA`, `entrarComoDemo` o
  `esperarPantalla`. Si la pantalla no tiene marcador, se le añade uno a `MARCADORES`
  antes que la espera.
- **Lo que sí sigue siendo fijo:** 17 esperas dentro de una pantalla ya montada
  —abrir una hoja, teclear un PIN, cambiar de pestaña— y el `asentar` de 300-800 ms
  que deja terminar la animación de entrada antes de medir anchos o colores.
- **Costo:** un marcador mal elegido planta el arnés hasta el tope (30 s) en vez de
  medir mal. Se prefiere: `demo:check` abre el reloj SIN activar, así que ahí sale su
  pantalla de activación y no el teclado, y está exceptuado a propósito.

### El escenario de ausentes GARANTIZA sus ausencias, no las espera (2026-09-22)

El tablero solo cuenta como ausencia un turno de hoy que YA TERMINÓ sin que nadie
fichara. `?escenario=ausentes` se limitaba a buscar esos turnos, y medido hora a hora
los siete días la semilla no los tiene casi nunca: entre semana solo a partir de las
20:00 UTC, y sábado y domingo nunca —el domingo la tienda cierra y el sábado se
siembra en borrador—. Así que `inicio:check` pasaba o fallaba según cuándo se
corriera.

Ahora el escenario COLOCA los turnos que hagan falta en el trozo de día que ya ha
pasado. Son datos sembrados: se pueden poner donde convenga.

- **Por qué no bajar el número que el arnés exige:** es la forma fácil de que deje de
  fallar y también de que deje de comprobar.
- **Lo que no se puede garantizar:** en el instante exacto en que empieza el día de
  la tienda no puede haber ninguna ausencia —«hoy» y «ahora» son el mismo punto—.
  Antes el agujero eran horas y días; ahora es un milisegundo, y hay una prueba que
  lo fija.
- **Costo:** el domingo el escenario enseña turnos en un día en que la tienda cierra.
  Es un día de mentira pedido a propósito para ver la pantalla con ausencias, no una
  afirmación sobre el calendario.

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

### El contrato responsive: qué se soporta y qué no puede decidir un punto de quiebre (2026-09-22)

**Decisión.** Se fija por escrito lo que el panel promete en cada ancho, porque no
existía y eso costó dieciocho fallos que ningún chequeo veía. Seis reglas, y cada una
sale de un fallo medido:

1. **El ancho mínimo soportado del panel son 360 px.** 320 px queda fuera: un iPhone SE
   de 2016 ya no recibe iOS actual, y el panel lo usa quien administra desde un iPad o un
   ordenador. **El reloj de fichaje sí cabe en 320** y eso no cambia — es lo que usa el
   equipo de la tienda, y `kiosco:check` lo comprueba en 320×568. Los dos mínimos son
   distintos a propósito.
2. **Un ancho mayor nunca puede mostrar menos que un ancho menor.** Pasaba dos veces: a
   414 px se recortaba «Héctor Ramírez Pinto» y a 390 px no; a 414 px se recortaba
   «dom 27» y a 390 px no.
3. **Ningún texto se recorta sin que alguien lo haya decidido.** El recorte es una
   decisión de diseño —una etiqueta corta elegida a mano—, no el resultado de que no
   quepa. Veinticuatro turnos mostraban «03:00 – 09:…» y nadie lo había decidido.
4. **Todo lo que se pulsa mide 44×44**, en el panel igual que en el kiosco. Las marcas de
   un gráfico no son controles: les aplica el mínimo de WCAG 2.5.8, 24×24.
5. **Un contenedor que se arrastra en horizontal lleva indicio visible**, o no se
   arrastra. El filtro de empleados escondía seis de nueve sin decirlo.
6. **Los puntos de quiebre deciden la FORMA de una pantalla, no si un texto cabe.** Si la
   pregunta es «¿cabe esto aquí?», se mide el sitio donde va, no la ventana.

**Motivo.** La regla 6 es la que de verdad importa y es la que faltaba. `breakpoints`
existía con cuatro números y un comentario que los llamaba «iPhone SE», «iPhone moderno»,
«iPad vertical» y «iPad horizontal»: nombres de aparatos, no reglas de contenido. Usarlos
para decidir si un nombre cabe en una casilla produjo el síntoma más desconcertante de
todos —una pantalla más ancha mostrando menos— dos veces en la misma pantalla.

**Costo aceptado.** 320 px se queda sin arreglar, con sus cuatro fallos medidos y
escritos. Si se decide soportarlo, hace falta un punto de quiebre por debajo de 360 y
apretar cuatro pantallas.

- **Dónde:** el contrato vive en el comentario de `breakpoints` en `src/theme/tokens.ts`,
  junto a los números que gobierna. Lo comprueba `scripts/responsive-check.mjs`, que
  mide ocho pantallas por siete anchos y distingue **deuda** (esto está mal y se va a
  arreglar) de **exención razonada** (la regla no aplica a esto, y por qué).

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

### El motivo de la salida anticipada no decide nómina

El reloj pregunta por qué te vas cuando sales más de `earlyDepartureReasonMinutes`
antes del fin de tu turno (30 por defecto, configurable por sede; 0 lo apaga). Los seis
motivos —fin de jornada acordado, mandado / otra sede, cita médica, permiso personal,
emergencia, otro— son **información para el gerente y nada más**: a diferencia de los
motivos de pausa, no se traducen a pagado o no pagado.

- **Motivo:** una salida anticipada resta horas de verdad. Dejar que quien se va elija
  de una lista si esas horas se le pagan es pedirle que firme su propia planilla, y es
  exactamente el error que ya se corrigió en las pausas —donde antes se le preguntaba al
  empleado si su descanso era pagado— solo que con más dinero en juego.
- **Costo:** el caso legítimo de «me mandaron al almacén, esas horas son trabajo» no se
  resuelve solo. Lo resuelve el gerente reclasificando la salida como pausa, que ya sabe
  si cuenta como trabajado y deja la corrección auditada con autor y motivo.
- **Por qué el umbral es otro número que `lateGraceMinutes`:** la marca
  `early_departure` aparece con cualquier salida temprana porque su costo lo paga el
  gerente mirando una tabla. La pregunta lo paga el empleado delante de una cola.
- **Dónde:** `src/domain/early-departure-reason.ts`.

### Las políticas guardadas de un reloj se completan con las de fábrica

`politicasDelVinculo` mezcla `DEFAULT_KIOSK_POLICIES` con lo que trae el vínculo
guardado, en vez del `binding?.policies ?? DEFAULT_KIOSK_POLICIES` que había en las tres
pantallas del reloj.

- **Motivo:** ese `??` solo entra cuando NO hay vínculo. Un reloj ya montado tiene uno,
  escrito el día de su activación, así que **cada política nueva vale `undefined` en los
  aparatos que ya están en la tienda** — que son todos los que importan. La función que
  dependa de ella no corre nunca, sin error y sin aviso, y funciona perfectamente en un
  aparato recién activado, que es donde se prueba.
- **Cómo se descubrió:** el umbral de salida anticipada no disparaba la pregunta. No era
  la regla ni la pantalla: era que el vínculo guardado no traía el número.
- **Dónde:** `src/stores/kiosk-store.ts`, con su prueba en
  `src/stores/__tests__/politicas-del-vinculo.test.ts`.

### Un fichaje no se edita: se reclasifica

Para convertir una salida en pausa —«se fue al almacén, no se fue a casa»— los dos
fichajes se quedan intactos y ganan un campo `reclassified_as`. El evento sigue diciendo
`clock_out` para siempre; el cálculo de horas usa `tipoEfectivo()`.

- **Motivo:** la regla de oro del proyecto es que `time_events` es append-only, porque el
  evento crudo es la única prueba de lo que pasó y reescribirlo borra la diferencia entre
  un error honesto y un fraude. Dos verdades distintas conviven porque son dos preguntas
  distintas: **qué hizo la persona** (lo que marcó) y **cómo se cuenta** (lo que el
  gerente corrigió). La pantalla enseña las dos, una debajo de la otra, nunca una en
  lugar de la otra.
- **Costo:** todo sitio que decida algo según el tipo tiene que usar `tipoEfectivo()`.
  Son 14 y están en `shared/attendance.ts` y `views.ts`. Uno solo leyendo `event_type` a
  pelo bastaría para que Horas y Reportes dijeran cosas distintas del mismo día.
- **Dónde:** `functions/src/shared/eventos.ts`.

### La reclasificación funde las dos sesiones a mano, no reconstruyendo

`managerReclassifyDeparture` alarga la sesión cortada y borra la siguiente, en lugar de
recalcular todo desde los eventos.

- **Motivo:** reconstruir sería lo elegante y es lo que promete el comentario de
  `rebuildWorkSession`, pero **hoy la proyección no es pura**: `managerAdjustTime`
  escribe las correcciones de hora DENTRO de `work_sessions`, no en los eventos. Una
  reconstrucción general las borraría todas, sin avisar y sin forma de recuperarlas.
- **Costo:** dos caminos que calculan minutos de sesión en vez de uno. Vale la pena hasta
  que las correcciones de hora vivan también en los eventos.

### El hueco reclasificable se limita con el descanso mínimo entre turnos

No se puede convertir en pausa un hueco igual o mayor que `minimumRestMinutes` (11 h de
fábrica, configurable por sede).

- **Motivo:** «la entrada siguiente» de quien sale a las 21:00 un lunes es la de las 09:00
  del martes. Sin límite, reclasificar la salida del lunes creaba una pausa de doce horas
  y fundía dos jornadas en una de veinticuatro — y con un motivo que cuenta como
  trabajado, son doce horas regaladas de un clic.
- **Por qué ese número y no uno nuevo:** `minimumRestMinutes` ya significa exactamente
  «a partir de aquí esto es tiempo libre entre dos jornadas», y ya lo configura cada sede.
- **Dónde:** `functions/src/manager.ts`, con sus dos pruebas de emulador.

### La zona horaria es de la sede, y se guarda canónica

Cada sede tiene su propia zona horaria, editable en Ajustes, y al crear una sede se pide
en vez de copiar la de la sede que estuvieras mirando. Lo que se guarda es lo que `Intl`
resuelve, no lo que se tecleó.

- **Motivo:** la zona decide a qué día pertenece cada jornada en los resúmenes, que es lo
  que se usa para pagar. Hasta el 2026-09-23 solo se podía poner la de la empresa, así
  que con tiendas en Perú y Canadá (pedido de Andree) las de un país habrían agrupado sus
  jornadas por el día del otro. Y como Perú no cambia la hora y Canadá sí, la diferencia
  aparece medio año y desaparece el otro — el peor tipo de fallo de diagnosticar.
- **Por qué canónica:** `Intl` no distingue mayúsculas y acepta alias antiguos
  (`America/Montreal` resuelve a `America/Toronto`). Sin normalizar, la misma zona
  quedaría escrita de tres formas y dos sedes del mismo huso parecerían estar en husos
  distintos.
- **Costo:** un campo más en el formulario de cada sede y en el de alta.
- **Dónde:** `src/domain/zona-horaria.ts`.

### Una zona horaria inválida en la base se cae a UTC, no revienta

`zonaSegura` registra el error y devuelve UTC en vez de dejar que `Intl` lance.

- **Motivo:** un solo documento de sede con la zona mal escrita no estropeaba una fila:
  **mataba la consulta entera** de Horas y Reportes de esa semana, con un error que no
  menciona la zona por ningún lado. El panel ahora la valida al escribirla, pero las
  sedes creadas antes no pasaron por ninguna comprobación, y el panel escribe en
  Firestore **directamente** —no a través de una función— así que el servidor no controla
  lo que llega.
- **Costo aceptado:** un día agrupado en UTC en vez de en la zona de la tienda puede
  estar mal; una pantalla que no carga está mal seguro. El registro es lo que permite
  enterarse: sin él, alguien vería números raros sin saber por dónde empezar.
- **De paso:** la zona de la **empresa** tampoco se validaba, y ese campo existe desde el
  principio. Mismo fallo, misma comprobación.
- **Dónde:** `functions/src/shared/zonas.ts`.

### Un campo que siempre vale lo mismo se acusa en el CI

`campos-muertos-check.mjs` recorre `functions/src` y señala cualquier clave que nazca
siempre con el mismo literal fijo —`null`, `[]`, `false`, `0`, `''`, `{}`— y en ningún
sitio con otra cosa.

- **Motivo:** en una semana aparecieron **seis** campos así, cada uno con pantalla del
  cliente esperándolos: `flags`, `shiftEndsAt`, `openBreak`, `jobRoleName`,
  `paidBreakReasons` y las políticas del vínculo del reloj. Nada los veía: TypeScript no
  (cliente y funciones no comparten tipo, y `null` es válido), el linter tampoco (no hay
  nada mal escrito), `contratos-check` compara nombres y no valores, y no había pruebas.
  El único filtro era que alguien mirara la pantalla y notara que algo no sale nunca.
- **La lista de excepciones lleva RAZÓN, no solo nombre.** Es la misma forma que la deuda
  de contraste de `tema.test.ts`: un chequeo sin manera de decir «este ya lo miré y está
  bien» se acaba apagando entero. Escribir el porqué es la parte que hace pensar.
- **Lo que no puede hacer, dicho en el propio guion:** es lectura de texto, no un
  compilador. Un campo llenado a través de una variable intermedia con un valor siempre
  fijo se le escapa. Caza el patrón concreto que ya mordió seis veces.
- **Dos gaps los encontraron los controles, no la lectura:** un campo anidado
  (`summary: { shiftEndsAt: null }`) y un objeto vacío (`paidBreakReasons: {}`) se
  escapaban en la primera versión.

---

## Cómo agregar una entrada

Una decisión entra acá si alguien podría querer revertirla sin conocer el motivo:
una desviación de la especificación, una limitación de una herramienta, un bug
sutil que costó encontrar, o un costo que se aceptó a sabiendas. Escribí el
motivo y el costo, no solo la conclusión — la conclusión ya está en el código.
