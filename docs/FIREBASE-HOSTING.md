# Publicar la web en Firebase Hosting

Decidido con Andree el 2026-09-14: **la web se aloja en Firebase Hosting y el backend
sigue en Supabase.** No se mueve la base de datos ni el inicio de sesión.

Eso conserva lo que ya está construido y probado —cinco migraciones, RLS, funciones
seguras y 77 comprobaciones SQL en verde— y evita rehacer los permisos por fila como
reglas de Firestore, que es donde más fácil se cuelan agujeros.

---

## Lo que ya está hecho en el repositorio

- `firebase.json` con la configuración de alojamiento, explicada más abajo.
- `npm run web:build` compila la web a `dist/`.
- `npm run web:deploy` compila y publica en un solo paso.

## Lo que hace falta de Andree, y no puedo hacer yo

1. Un proyecto de Firebase (o el nombre de uno que ya exista).
2. Ejecutar `firebase login` una vez en tu máquina.
3. Ejecutar `firebase use --add` y elegir ese proyecto. Eso crea `.firebaserc`, que
   guarda a qué proyecto apunta el repositorio.

No hay forma de que yo cree o elija un proyecto de Firebase de tu cuenta.

---

## Publicar, paso a paso, en Windows

En PowerShell, dentro de la carpeta del proyecto:

```powershell
npm install -g firebase-tools    # una sola vez
firebase login                   # una sola vez
firebase use --add               # una sola vez: elige el proyecto

npm run web:deploy
```

Al terminar, la consola imprime la URL (`https://<proyecto>.web.app`).

### Publicar la demostración, sin Supabase

Si todavía no hay proyecto de Supabase, se puede publicar igualmente una versión con
datos de mentira para enseñarla:

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

La `EXPO_PUBLIC_SUPABASE_ANON_KEY` **viaja dentro del paquete web, y está bien**: es
pública por diseño, va en la URL de cada petición y lo que protege los datos es RLS en
el servidor, no el secreto de esa clave.

La `service_role` **NUNCA** entra aquí. Vive solo en los secretos de las Edge Functions.
Antes de publicar por primera vez conviene comprobarlo sobre el paquete ya compilado:

```powershell
Select-String -Path dist\_expo\static\js\web\*.js -Pattern "service_role" -SimpleMatch
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
