# Publicar la web en Firebase Hosting

Decidido con Andree el 2026-09-14: la web se aloja en Firebase Hosting. En su momento
se decidió **conservar Supabase como backend**, para no rehacer los permisos por fila
como reglas de Firestore, que es donde más fácil se cuelan agujeros.

**Eso cambió el 2026-09-21**, por indicación de Joseph: todo el backend es Firebase.
Firestore, Auth con Google y Cloud Functions, en el proyecto `krealo-shift`. El aviso
de arriba se conserva porque explica el riesgo que se aceptó al mover los permisos, y
ese riesgo sigue siendo real: las reglas están razonadas y desplegadas, pero las 265
aserciones que las vigilaban eran SQL y todavía no se han reescrito.

---

## Lo que ya está hecho en el repositorio

- `firebase.json` con la configuración de alojamiento, explicada más abajo.
- `npm run web:build` compila la web a `dist/`.
- `npm run web:deploy` compila y publica en un solo paso.

## Lo que hace falta de Andree, y no puedo hacer yo

Ya no hace falta elegir proyecto: `.firebaserc` existe y apunta a `krealo-shift`.
Queda una sola cosa, y son tres clics en la consola:

**Habilitar el proveedor de Google en Authentication.** No hay API pública que lo
haga; al activarlo, Firebase crea solo el cliente OAuth de web que usa
`signInWithPopup`. Hasta entonces nadie puede entrar: el botón está y la ventana de
Google contesta que el proveedor está deshabilitado.

[console.firebase.google.com/project/krealo-shift/authentication/providers](https://console.firebase.google.com/project/krealo-shift/authentication/providers)

---

## Publicar, paso a paso, en Windows

En PowerShell, dentro de la carpeta del proyecto:

```powershell
npm install -g firebase-tools    # una sola vez
firebase login                   # una sola vez

cp .env.example .env             # ANTES de compilar: sin esto se publica rota
npm run web:deploy
```

Al terminar, la consola imprime la URL (`https://<proyecto>.web.app`).

**Sin `.env` el despliegue sale en verde y la web sale rota.** Las `EXPO_PUBLIC_*` se
hornean en el paquete al compilar, así que `expo export` sin ellas produce un
JavaScript perfecto que arranca la pantalla «Falta configuración del entorno». Pasó el
2026-09-21 y por eso `despliegue:check` mira dentro del paquete publicado, no solo que
los archivos se sirvan.

Si el cambio tocó `functions/`, el alojamiento no basta:

```powershell
npm --prefix functions ci
firebase deploy --only functions
```

### Publicar la demostración, sin backend

Se puede publicar una versión con datos de mentira para enseñarla, sin tocar
Firestore ni necesitar que nadie entre con Google:

```powershell
npm run demo:export:prod
firebase deploy --only hosting --public dist-demo-prod
```

Sale con el aviso de «modo demostración» bien visible en todas las pantallas.

---

## Por qué `firebase.json` dice lo que dice

### El reenvío a `index.html` NO es opcional

```json
"rewrites": [{ "source": "**", "destination": "/index.html" }]
```

El proyecto usa `web.output: 'single'` (el motivo está en `app.config.ts`), así que el
paquete compilado tiene **un solo** `index.html`: las rutas `/team`, `/schedule`,
`/hours` no existen como archivos, solo dentro del router.

Sin esta regla, entrar directo a `https://…/team` —o simplemente **recargar la página**
estando ahí— devuelve 404. Es el fallo clásico al publicar una aplicación de una sola
página, y es de los que no se ven navegando: solo aparece al recargar o al compartir un
enlace. **Pruébalo recargando, no lo des por hecho.**

### Las cabeceras de caché, y por qué son dos reglas distintas

Los archivos de `/_expo/**` y `/assets/**` llevan un hash en el nombre: si el contenido
cambia, cambia el nombre. Por eso se cachean un año.

`index.html` **no** lleva hash, y es quien apunta a los demás. Si se cachea, la gente
sigue viendo la versión vieja después de cada publicación, a veces durante días, y no
hay forma de decirles «recarga» que funcione de verdad. Por eso va con `no-cache`.

### Las cabeceras de seguridad

`X-Frame-Options: DENY` impide que el panel se incruste en un iframe de otro sitio, que
es como se montan los ataques de clickjacking sobre paneles de administración.
`nosniff` y `Referrer-Policy` son higiene estándar.

---

## Sobre las claves

La configuración de Firebase **viaja dentro del paquete web, y está bien**: `apiKey`
no es una credencial sino el identificador del proyecto ante la API, y lo que protege
los datos son las reglas de Firestore y las Cloud Functions, no el secreto de esa
cadena.

La clave de cuenta de servicio **NUNCA** entra aquí, y con Firebase ni siquiera hace
falta que exista: las funciones se autentican solas dentro de Google. Antes de
publicar por primera vez conviene comprobarlo sobre el paquete ya compilado:

```powershell
Select-String -Path dist\_expo\static\js\web\*.js -Pattern "private_key" -SimpleMatch
```

Si eso devuelve algo, **no publiques** y avísame.

---

## Lo que NO funciona en la web publicada

El **modo kiosco** —la pantalla donde los empleados teclean su PIN— está bloqueado a
propósito en la web publicada, y la app lo explica en pantalla si alguien llega ahí.

El motivo largo está en `src/lib/kiosk/disponibilidad.ts`. En corto: la credencial del
dispositivo acabaría en `localStorage`, al alcance de cualquier extensión del
navegador, y la cola de fichajes en web no sobrevive a un recargado. Un fichaje perdido
es una hora no pagada.

El panel de administración sí funciona con normalidad: entrar, equipo, horario, horas,
solicitudes y ajustes.
