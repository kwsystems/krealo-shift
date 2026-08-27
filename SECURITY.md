# Seguridad de Krealo Shift

Krealo Shift registra la jornada laboral de personas reales. Un fichaje mal
protegido no es un bug estético: es una hora que alguien cobra o deja de cobrar.
Este documento explica qué protegemos, de quién, con qué mecanismos, y qué
decisiones quedaron tomadas con su costo a la vista.

Alcance: este repositorio (app Expo, migraciones y Edge Functions de Supabase).

## Modelo de amenazas

Lo que hay que proteger, en orden de gravedad:

1. **La integridad de los eventos de tiempo.** Que nadie fiche por otra persona,
   ni altere una hora ya registrada sin dejar rastro.
2. **El aislamiento entre organizaciones y entre ubicaciones.** Una empresa no
   puede ver a otra; un gerente no puede ver una tienda que no administra.
3. **Los datos personales del equipo.** Nombres, PIN, fotos de fichaje, horas
   trabajadas.

Contra quién:

| Actor | Qué podría intentar | Qué lo detiene |
|---|---|---|
| Empleado curioso frente al kiosco | ver la lista del personal, fichar por un compañero, salir de la app | el kiosco nunca muestra el equipo antes de validar un PIN; cada acción exige un token de 90 s ligado al empleado; Acceso guiado de iPadOS impide salir de la app |
| Empleado con el PIN de otro | fichar en su nombre | el PIN es el único factor en el iPad: eso es una limitación aceptada del modelo kiosco. Se compensa con rotación de PIN, auditoría de cada evento y foto opcional |
| Alguien con el iPad en la mano | extraer la credencial y fichar desde fuera | la credencial vive en el Keychain (SecureStore); sin el token de acción de 90 s no puede fichar por nadie; revocar el dispositivo la anula al instante |
| Cliente malicioso con la `anon key` | leer datos de otra organización | RLS: la `anon key` no otorga ningún dato por sí sola |
| Gerente que quiere más permisos | editar su propio rol o ver otras tiendas | el rol se resuelve en el servidor; las políticas RLS y las guardas de esquema impiden la escalada |
| Persona con acceso al repositorio | encontrar secretos | no hay secretos en Git: solo `.env.example` vacío |

Fuera de alcance en P0/P1: fichaje desde teléfonos personales (no existe),
geolocalización (no existe) y ataques a la infraestructura de Supabase o Apple.

## Manejo de secretos

- **Nada de secretos en el repositorio.** `.env` está en `.gitignore`;
  `.env.example` se commitea vacío.
- **Solo las variables `EXPO_PUBLIC_*` llegan al cliente**, y hay que tratarlas
  como públicas: cualquiera que descargue el `.ipa` puede leerlas. Ahí solo van la
  URL del proyecto y la `anon key`.
- **La `service_role` nunca entra en la app.** Vive en los secretos de las Edge
  Functions y, temporalmente, en la terminal de quien corre
  `scripts/seed-demo-users.mjs`. Si aparece dentro de `app/`, `src/` o de una
  variable `EXPO_PUBLIC_*`, es un incidente: hay que rotarla en Supabase.
- **`KIOSK_TOKEN_SECRET`** (32+ bytes aleatorios) firma los tokens de acción. Se
  fija con `supabase secrets set` y se rota cuando haga falta; rotarlo invalida
  los tokens en vuelo, que duran 90 segundos, así que el impacto es nulo.
- **Las contraseñas de demo se leen del entorno** (`DEMO_PASSWORD`), nunca del
  repositorio, y los usuarios demo usan correos en el TLD reservado `.invalid`
  para que ningún demo escriba a una persona real.
- Los builds de EAS toman sus variables de los entornos de EAS
  (`development` / `preview` / `production`), no de un `.env` subido.

## PIN del empleado

- Se guarda **solo el hash**: bcrypt con coste 12, generado dentro de Postgres
  (`extensions.crypt` + `gen_salt('bf', 12)`) en `set_employee_pin`.
- Nunca se devuelve en ninguna consulta: `employee_pin_credentials` tiene RLS con
  `force row level security` y **ninguna política de lectura**, y además se
  revocan los permisos de tabla a `anon` y `authenticated`. No se lee ni siendo
  propietario de la organización.
- Tras **5 intentos fallidos** el PIN queda bloqueado **15 minutos** en esa
  ubicación. El kiosco no revela a quién pertenece el PIN bloqueado.
- La comparación ocurre en el servidor, dentro de una función `security definer`.
  El cliente solo sabe si acertó o no.

### Por qué bcrypt y no Argon2id

La especificación pide Argon2id "o un mecanismo robusto disponible en la función
segura". **Argon2 no existe en PostgreSQL ni en pgcrypto**, y Supabase no permite
instalar extensiones arbitrarias. Las opciones eran:

1. bcrypt coste 12 dentro de la base — un solo lugar donde vive el hash;
2. Argon2id en una Edge Function — algoritmo más fuerte, pero la validación del
   PIN se partiría entre la base y la función, y el hash dejaría de estar bajo la
   misma transacción que el contador de intentos y el bloqueo.

Se eligió bcrypt coste 12. Para un secreto de 4–6 dígitos, el límite de intentos y
el bloqueo pesan mucho más que el algoritmo: con 5 intentos por 15 minutos, la
fuerza bruta online no llega a ninguna parte, y contra un volcado de la base
bcrypt coste 12 ya es lento. Queda documentado como desviación consciente en
`docs/DECISIONES.md`.

## Las dos credenciales del kiosco

Son dos a propósito, y ninguna sirve sola:

1. **Credencial del dispositivo** (`x-kiosk-credential` + `x-kiosk-device`): de
   larga vida, ligada a **un** iPad y a **una** ubicación. Se emite al canjear un
   código de activación de un solo uso, se guarda en SecureStore (Keychain) y en
   la base solo queda su hash.
2. **Token de acción**: válido **90 segundos**, ligado a empleado + kiosco +
   ubicación. Lo emite `verify-pin` tras validar el PIN y lo consumen las
   funciones que escriben. Es un HMAC firmado con `KIOSK_TOKEN_SECRET`, sin
   estado en la base, y se compara en tiempo constante.

Sin el token, conocer la credencial del iPad permitiría fichar por cualquiera. Sin
la credencial, un token robado no vale en otro dispositivo. Un iPad vinculado a
Sede Principal no puede registrar eventos como si fuera el kiosco de Sucursal
Demo: la ubicación viene de la credencial, no del cuerpo de la petición.

La app **nunca** inserta en `time_events`. Todo pasa por las Edge Functions, que a
su vez delegan las reglas a funciones SQL `security definer` con `search_path`
fijo. Ver `supabase/functions/README.md`.

## Validación del PIN sin conexión

El kiosco debe seguir funcionando sin red (§9.7), pero el servidor guarda el PIN
con bcrypt, o sea de forma irreversible: **no puede derivar un verificador por
dispositivo sin conocer el PIN en claro**. Las salidas que se consideraron:

1. guardar el PIN de forma reversible para derivar verificadores por dispositivo
   — funciona siempre, pero introduce almacenamiento reversible de PIN;
2. derivar el verificador al fijar el PIN, para cada dispositivo activo — sin PIN
   reversible, pero un iPad activado después queda sin offline hasta que cada
   empleado rote su PIN;
3. enviar al dispositivo el hash bcrypt con su salt — sin PIN reversible y sirve
   para cualquier iPad, pero quien se lleve el archivo local puede probar sin
   límite los 10⁶ PIN posibles contra ese hash;
4. enviar el **salt** y un **verificador derivado con una clave propia del
   dispositivo**, sin el hash.

**Decisión tomada: la opción 4**, implementada en
`supabase/migrations/20260827000700_offline_verifier_device_key.sql`,
`src/lib/offline/pin.ts` y `supabase/functions/refresh-kiosk-roster/`.

Cómo funciona: al activarse, el iPad recibe una clave aleatoria de 32 bytes que
guarda en el Keychain, separada de la credencial con la que hace peticiones. En
cada refresco el servidor le manda, por empleado de su tienda, el salt de bcrypt y
`sha256(clave || ':' || hash_bcrypt)`. Para comprobar un PIN el iPad calcula
`bcrypt(PIN, salt)`, lo re-deriva con su clave y compara.

Razones y costo, sin adornos:

- **por qué no la 3, que estuvo implementada primero**: guardaba el hash bcrypt en
  el SQLite del iPad. Un archivo SQLite se exfiltra mucho más fácil que el
  Keychain —un backup sin cifrar, un bug de compartición de archivos— y con el
  hash en mano se prueban los 10⁶ PIN posibles sin volver a tocar el dispositivo.
  Con la opción 4 ese archivo por sí solo no sirve para nada;
- descartar la opción 1 pesa más que cualquier otra consideración: un PIN
  reversible es el peor de los finales;
- la opción 2 dejaba sin offline a los iPad activados después de que el equipo ya
  tenía PIN, lo que en una tienda real significa "nunca". La 4 no tiene ese
  problema: cualquier iPad activado en cualquier momento recibe verificadores;
- **el costo aceptado**: quien extraiga **también** la clave del Keychain —lo que
  exige acceso físico y jailbreak, no solo un backup— vuelve al escenario de la
  opción 3: fuerza bruta de 10⁶ PIN contra bcrypt **coste 10**. Se usa coste 10 y
  no 12 porque lo calcula `bcryptjs` en JavaScript sobre el dispositivo y coste 12
  tardaría segundos por intento con gente esperando para fichar. Coste 10 son
  horas de cómputo por empleado, no minutos, y revocar el dispositivo lo corta de
  inmediato;
- **es un digest con clave, no un HMAC formal**: `expo-crypto` solo expone digest
  sobre cadenas UTF-8, así que un HMAC real no se puede calcular igual en Postgres
  y en Hermes sin agregar otra dependencia de criptografía. La debilidad conocida
  de un digest con clave frente a HMAC es la extensión de longitud, que aquí no
  aplica: el mensaje es un hash bcrypt de formato fijo y la comparación es de
  igualdad;
- **offline no relaja nada más**: se aplican el mismo límite de 5 intentos y el
  mismo bloqueo de 15 minutos, contados en el propio dispositivo. Si el bloqueo
  existiera solo en el servidor, quedarse sin red sería la forma de saltárselo.

Los verificadores están ligados al dispositivo: copiar la base de un iPad a otro
no sirve. Se reemplazan por completo en cada actualización del equipo, así que un
empleado que sale de la tienda deja de poder fichar en ese iPad, y un dispositivo
revocado no recibe ninguno.

Que las dos puntas calculan exactamente lo mismo está fijado con un vector de
prueba real en `src/lib/offline/__tests__/pin-derivation.test.ts` y con
aserciones en `supabase/tests/20_functions.sql`, entre ellas que el hash bcrypt
completo **nunca** sale de la base.

**Un iPad activado antes de este cambio** no tiene clave de derivación. Sigue
fichando con normalidad online; para volver a validar PIN sin red hay que
reactivarlo. La app lo dice en pantalla en vez de responder "PIN incorrecto".

## RLS como barrera principal

La autorización no vive en la interfaz. Vive en la base:

- **RLS habilitado en todas las tablas expuestas**, y `force row level security`
  en las sensibles, para que ni el dueño de la tabla las lea sin política.
- `employee_pin_credentials`, `kiosk_activation_codes` y `kiosk_devices` tienen
  los permisos revocados para `anon` y `authenticated`. Los kioscos se
  administran a través de una vista que no expone el hash.
- **`time_events` y `audit_logs` son append-only**: triggers rechazan `update` y
  `delete`. Los eventos crudos son la única prueba de lo que pasó, y una
  corrección es una fila nueva en `time_adjustments`, no una edición.
- Guardas de esquema para lo que la interfaz no puede garantizar: una
  organización no se queda sin propietario, un turno publicado no se solapa ni se
  borra, y publicar sella versión y fecha.
- **Protección contra escalada de rol**: el rol se resuelve en el servidor. El
  kiosco no deduce quién es gerente: `kiosk_employee_context` devuelve
  `canManageLocation`, y la autorización de entrada temprana exige además que la
  persona que autoriza sea distinta de la que ficha. Dejárselo deducir al cliente
  habría convertido cualquier PIN en un PIN de gerente.
- Las pruebas de aislamiento viven en `supabase/tests/10_rls.sql` y se corren con
  `./scripts/db-test.sh`.

## Revocación de kioscos y rotación

- Revocar un iPad: `revoke_kiosk_device(<device_id>)` marca el dispositivo como
  `revoked` y sella `revoked_at`. A partir de ese momento su credencial no
  autentica, ni para enviar ni para sincronizar, y la app muestra la pantalla
  "Este reloj fue desactivado".
- Un lote offline enviado por un kiosco revocado **se rechaza completo** (401). No
  se acepta "por ser de antes": si el dispositivo dejó de ser confiable, esos
  registros quedan sin sincronizar y su recuperación pasa por una corrección
  auditable hecha por un gerente.
- Rotar la credencial de un iPad = revocarlo y volver a activarlo con un código
  nuevo. Los códigos de activación son de un solo uso y caducan.
- Rotar un PIN: `set_employee_pin`, que además reinicia el contador de intentos y
  el bloqueo, e invalida el verificador offline anterior.

## Fotos de fichaje: almacenamiento y retención

- La foto del fichaje está **desactivada por defecto** (`photoEnabled: false`) y
  se activa por ubicación.
- Nunca bloquea el fichaje: si falta el permiso o la cámara falla, el evento se
  registra igual y se avisa. Tampoco lo retrasa: la persona ve su confirmación y
  se va; la imagen se sube después, en segundo plano.
- **Bucket privado, sin excepción** (`attendance-photos`, `public => false`, 2 MB,
  solo JPEG y WebP). Es la cara de una persona trabajando: un bucket público
  serviría esas imágenes a cualquiera con la URL, y las de Storage son adivinables
  si se conoce el patrón. Se leen con URL firmada de vida corta.
- **La ruta la deriva el servidor**, nunca el cliente:
  `{organization_id}/{location_id}/{yyyy}/{mm}/{event_id}.jpg`. La organización va
  primera porque las políticas de `storage.objects` solo saben mirar segmentos del
  nombre; así el aislamiento entre empresas se comprueba por prefijo. Si el cliente
  pudiera proponer la ruta, podría apuntar la foto de un fichaje al archivo de otro
  o escribir fuera de su organización.
- **El iPad no tiene permiso de escritura sobre Storage.** Sube a través de la Edge
  Function `attach-photo`, que lo autentica, comprueba que el evento es de SU
  ubicación y escribe con `service_role`. No hay política de insert para `anon` ni
  `authenticated`.
- **`photo_path` se escribe DESPUÉS de que el archivo esté arriba.** Al revés, cada
  subida fallida dejaría la columna apuntando a un objeto inexistente, indistinguible
  de una foto ya purgada.
- **Lectura:** solo quien administra la ubicación de la ruta
  (`app_manages_location`). Nadie actualiza ni borra a mano: el borrado lo hace solo
  la purga por retención.
- Cada ubicación define `photoRetentionDays` (30 por defecto).
  `purge_expired_attendance_photos()` borra primero el archivo y después limpia la
  columna —en ese orden, porque al revés quedarían archivos huérfanos que nada
  volvería a mirar, o sea fotos de personas guardadas para siempre sin que nadie
  sepa que están ahí—. Devuelve cuántas borró, para poder vigilar que corre: un
  trabajo que siempre devuelve 0 es indistinguible de uno que no se ejecuta.
- **El evento nunca se borra con la foto.** La hora trabajada es el dato laboral;
  la foto es solo verificación. Hay una prueba que lo fija.
- La copia local en el iPad se borra en cuanto la imagen llega al servidor:
  guardarla dos veces no aporta nada.

### La excepción a append-only, y por qué es del tamaño que es

`time_events` rechaza todo update excepto uno: que la única columna que cambie sea
`photo_path`. Es un conflicto real entre dos reglas correctas —append-only y
retención— y se resuelve con la excepción más estrecha que funciona.

`photo_path` no es un dato del fichaje: es un puntero a un archivo cuyo ciclo de
vida es inherentemente mutable (se sube después, se borra antes). Se permite en las
dos direcciones porque solo hacia null obligaría a escribir el puntero antes de que
el archivo exista. Cualquier otra diferencia en la fila —una hora, un tipo de
evento, un empleado— se sigue rechazando, y también se rechaza colar otro cambio
en el mismo update. La comparación se hace sobre las filas convertidas a jsonb, así
que una columna nueva queda protegida sin que nadie tenga que acordarse de añadirla
a una lista.

**Programada** a diario a las 03:15 UTC (22:15 en Lima, fuera del horario de
cualquier tienda) por `20260827000900_scheduled_jobs.sql`, con `pg_cron`.

Si el plan de Supabase no trae `pg_cron`, la migración **no falla**: avisa por
`notice` y deja escrito que hay que llamar a la función a diario desde fuera (un
Scheduled Function de Supabase, o cron propio con la `service_role`). **Conviene
comprobarlo en el despliegue:** lo que se olvida aquí son fotos de las caras de las
personas guardadas indefinidamente.

El trabajo es idempotente y tolera fallos: la función busca por fecha y no lleva
marcador de progreso, así que si un día no corre, al siguiente recoge lo que quedó.

## Logotipo de organización: el bucket que SÍ es público

`organization-logos` es **público de lectura**, al contrario que el de las fotos.
Es la única decisión de este archivo que va en dirección contraria, así que conviene
que quede dicha:

- un logotipo es material de marca: se pinta en la pantalla de reposo del kiosco,
  que está a la vista de cualquiera que entre a la tienda, y a veces va en un correo
  o un PDF exportado;
- tratarlo como secreto obligaría a firmar una URL cada vez que el kiosco pinta su
  pantalla —incluido un kiosco sin sesión de usuario— y no protegería nada: la
  imagen ya es pública de hecho.

La comparación con el otro bucket es lo que hace la decisión defendible: **la foto
de fichaje es la cara de una persona trabajando** y va en bucket privado con URL
firmada; **el logotipo es el letrero de la puerta**. Los dos casos viven en la misma
app y merecen tratos opuestos. Confundirlos en cualquiera de las dos direcciones
sería el error.

**Escribir sí está restringido:** público es la lectura, no la subida. Solo owner o
admin de la organización del primer segmento de la ruta puede escribir, reemplazar o
borrar (`app_administers_organization`). Si no, cualquier sesión podría reemplazar el
logotipo de cualquier empresa, que es una forma barata de suplantación.

Eso separa dos permisos que se confunden fácil: administrar **una tienda**
(`app_manages_location`) no es administrar **la empresa**. Una gerenta gestiona su
ubicación pero no cambia el logotipo ni los ajustes de la organización. Hay pruebas
de las tres capas: propietaria sí, gerenta no, empleada no.

Ruta: `{organization_id}/logo.{ext}`, sin fecha ni identificador aleatorio, porque
hay UN logotipo por organización y sustituirlo debe sustituirlo, no acumular
versiones que nadie va a limpiar.

## Qué NO se registra

Ni en logs, ni en auditoría, ni en telemetría, ni en mensajes de error:

- **el PIN**, ni en claro ni parcialmente, ni su largo por empleado;
- **la credencial del kiosco** ni los **tokens de acción**;
- **la `service_role`** ni ninguna clave;
- **las fotos de fichaje** ni sus rutas fuera de la fila del evento;
- **el mensaje crudo de Postgres**: los errores se traducen desde el `errcode`, no
  comparando textos, y el cliente recibe un caso conocido, nunca el detalle
  interno de la base.

`audit_logs` guarda actor, acción, entidad, valor anterior y posterior, y un
**hash** de IP — no la IP. En la app, los mensajes de error son textos traducidos
del catálogo i18n: nunca se muestra al usuario la respuesta cruda de Supabase.

Si algún día se agrega un proveedor de crashes o analítica, debe entrar con la
misma regla y sin bloquear el desarrollo cuando la clave no exista.

## Almacenamiento en el dispositivo

- Credencial del kiosco, clave del dispositivo, identificador de instalación y
  sesión: **SecureStore** (Keychain de iOS). Nunca AsyncStorage.
- En la previsualización web, SecureStore no existe: hay un respaldo sobre
  `localStorage` que avisa por consola que **no es almacenamiento seguro** y se
  niega a funcionar en un build web de producción. La web es una herramienta de
  desarrollo, no un despliegue.

## Reportar un problema de seguridad

**No abras un issue público ni un pull request.** Escribe a:

- **andree@krealomedia.com**, asunto `[SEGURIDAD] Krealo Shift`.

Incluye, si puedes: qué versión o commit, qué pasos reproducen el problema, qué
esperabas y qué pasó, y el impacto que le ves. Si involucra datos de una persona
real, dilo pero **no adjuntes** esos datos.

Compromiso de respuesta:

| Paso | Plazo objetivo |
|---|---|
| acuse de recibo | 3 días hábiles |
| evaluación inicial y severidad | 7 días hábiles |
| corrección de un problema grave | lo antes posible, con aviso a las tiendas afectadas |

Mientras el proyecto no esté publicado en la App Store no hay programa de
recompensas. Los reportes de buena fe se agradecen y se acreditan si quien lo
envía quiere.

## Si un secreto se filtra

1. **Rotar primero, investigar después.** `service_role` y `anon key` se
   regeneran en *Project Settings → API*; `KIOSK_TOKEN_SECRET` con
   `supabase secrets set`.
2. Revocar los kioscos activos si la credencial pudo quedar expuesta.
3. Revisar `audit_logs` y `time_events` del periodo sospechoso: son append-only,
   así que el rastro sigue ahí.
4. Anotar en `docs/DECISIONES.md` qué pasó y qué cambió, para que no se repita.
