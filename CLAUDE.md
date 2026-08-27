# Krealo Shift

Aplicación desarrollada para Krealo. El código vive en este repositorio
(`kwsystems/krealo-shift`); la gestión de tareas se hace en **Krealo Publisher**.

## Reglas de gestión de tareas (obligatorias)

Toda tarea creada o actualizada por un agente debe llevar:

| Campo | Valor |
|---|---|
| `companyName` | **"Universo Tutu"** — TEMPORAL, ver la nota de abajo. El destino definitivo es "Krealo Shift". |
| `assignees` | `["andree@krealomedia.com"]` |
| `tags` | `["Claude"]` — etiqueta nativa ya existente. Usar el nombre exacto: un nombre nuevo CREA una etiqueta y no se puede borrar. |

### Excepción temporal de empresa (2026-08-27)

Las tareas creadas con `companyName: "Krealo Shift"` **no se renderizan en la UI de
Publisher**, aunque la API las devuelve correctamente: campos y tipos son idénticos a
los de una tarea que sí se ve. Verificado creando una tarea de prueba en otra empresa,
que apareció sin problema.

Por indicación de Andree, mientras eso no se arregle:

- las tareas del proyecto van a `companyName: "Universo Tutu"`;
- el título lleva el prefijo **`Krealo Shift · `**, porque Universo Tutu es un cliente
  real y su tablero no debe confundirse con trabajo del proyecto;
- la descripción deja constancia de que el trabajo es de Krealo Shift.

Las 10 tareas originales quedaron cerradas en `done` con una nota de migración que
apunta a su reemplazo. No fue posible moverlas: `companyName` no es editable en
`/tasks/update` y la API no tiene endpoint de borrado.

**Cuando se arregle la empresa Krealo Shift**, volver a `companyName: "Krealo Shift"`,
quitar el prefijo del título y recrear allí las tareas que sigan abiertas.

### Ciclo de vida
Sincronizado con el trabajo real: se crea en `not_started` → al empezar a
trabajarla pasa a `in_progress` → al terminarla y verificarla pasa a `done`.

**Regla de oro — CORTA EN LAS DOS DIRECCIONES. Fallar cualquiera de las dos es
fallar la regla:**

1. **Si falta algo o hay dudas, NO se cierra.** Se deja un comentario explicando
   qué falta exactamente y se mantiene en `in_progress`. Cerrar una tarea a medias
   es mentir sobre el estado del proyecto.
2. **Si está terminada y verificada, SE CIERRA. Ya.** Dejar en `in_progress` un
   trabajo que ya está hecho también es mentir: Andree mira el tablero y ve trabajo
   en curso donde no hay ninguno, así que no sabe qué falta de verdad ni qué puede
   revisar. Y hace que el tablero deje de servir para lo único que sirve.

La segunda mitad se falló el 2026-08-27 y de ahí viene este texto: había tareas
acabadas en `in_progress` porque quedaba **un bloqueo ajeno**, no trabajo propio. De
ahí la regla que lo desambigua:

> **Un bloqueo que depende de Andree no es trabajo pendiente mío.**
> Si todo lo que yo podía hacer está hecho y verificado, la tarea se cierra con el
> bloqueo escrito y, si hace falta, se crea una tarea aparte para lo que él tiene
> que decidir o entregar. Lo que NO se hace es dejar la tarea abierta para siempre
> esperándolo: eso esconde el pedido en un comentario donde nadie lo va a leer.

**Y antes de bloquear una tarea entera, partirla:** si de diez cosas ocho se pueden
entregar y dos no, se entregan las ocho y se dice cuáles dos faltan y por qué.
Bloquear el todo por una parte es la forma más fácil de no entregar nada.

Estados: `not_started`, `in_progress`, `done`. Prioridades: `high`, `normal`, `low`.

## API de Krealo Publisher

Base: `https://us-central1-keneth-walters.cloudfunctions.net/openclawApi` (solo POST).

Tokens en variables de entorno de usuario — **nunca** en el repositorio:
`PUBLISHER_TASKS_API_TOKEN` y `OPENCLAW_API_TOKEN`.
En PowerShell: `[Environment]::GetEnvironmentVariable("NOMBRE","User")`.

| Endpoint | Auth | Body |
|---|---|---|
| `POST /tasks/list` | token TASKS, sin header de agente | `{companyName?}` |
| `POST /tasks/create` | token OPENCLAW + `X-OpenClaw-Agent: agente-asistente` | `{companyName,title,description,assignees[],priority,status,tags[]}` → `taskId` + `publisherUrl` |
| `POST /tasks/update` | token OPENCLAW + `X-OpenClaw-Agent: agente-asistente` | `{taskId, ...}` — editables: `status`, `priority`, `title`, `description`, `assignees`, `tags` |

### Mensajería con agentes
- Enviar: `POST /agents/notify {agentId, message, userName}` → token TASKS, SIN header de agente. Devuelve `conversationKey`.
- Leer: `POST /agents/thread {conversationKey}` → token TASKS. Sondear hasta que el mensaje quede en `answered` (~30 s a varios minutos).
- `agentId` disponibles: `agente-programador`, `agente-asistente`, `agente-ads`,
  `agente-creacion-contenido`, `agente-posteador`, `agente-clientes`, `agente-reportes`,
  `agente-contabilidad`, `agente-seo`, `agente-mejoras`, `agente-krealo-media`,
  `agente-definite`, `agente-facebook-comentarios`, `agente-notion-comentarios`,
  `agente-aikawa-sushi`, `agente-alabama-appliance`, `agente-bonprix`, `agente-sha`,
  `agente-igs`, `agente-gobac`, `agente-univers-toutou`, `agente-universo-tutu`, `whatsapp`.

### Limitaciones verificadas de la API
- **No existe delete de tareas.** Lo creado queda permanentemente.
- **No hay endpoint de comentarios.** "Comentar" = reescribir `description` con el
  texto anexado; leer primero el `description` actual para no pisar contenido.
- **`/tasks/list` no devuelve `tags`, `priority` ni `completedAt`.** Verificar en la UI.
- `/tasks/list` corta en 500 ítems y puede devolver registros `act_*` / `rec_*`
  además de tareas normales.
- Usar el token equivocado en `create`/`update` da `PUBLISHER_AUTH_FAILED`.

## Skills instalados (`.claude/skills/`) — 219

> **Estado:** los 219 están en disco y funcionando, pero **no commiteados todavía**.
> 34 de ellos contienen material interno de clientes y este repositorio es público.
> Quedan excluidos de git (`.git/info/exclude`) hasta que el repo pase a privado.
>
> **Revisado el 2026-08-27:** los confidenciales son **21, no 34**. La cuenta
> anterior venía de una búsqueda sin límites de palabra que casaba `gobac` dentro de
> `navigation.goBack`. Con límites: 21 llevan nombres de clientes reales de la
> agencia y 198 son publicables. También se buscaron credenciales reales sobre los
> 1443 archivos —tokens, JWT, claves de AWS y Google, bloques de clave privada— y
> **no hay ninguna**.
>
> Aun así **siguen sin commitear los 198**, a la espera de que Andree decida: subir
> material interno de la agencia a un repositorio PÚBLICO es su decisión, no mía, y
> él ya había decidido esperar a que el repo pasara a privado. Ver la pregunta
> abierta en la tarea de skills del Publisher.

Traídos de `kwsystems/krealo-publisher` (16, commit `fff45b1`) y de
`kwsystems/claw`, el workspace de OpenClaw (203, commit `0175864`), desde
`skills/`, `workspace-programador/skills/`, `workspace-creacion-contenido/skills/`
y `skills-globales/`.

| Categoría | Cant. | Destacados |
|---|---|---|
| Integraciones y herramientas | 43 | playwright, web-search, gog (Google Workspace), github, clawbird, canva-assistant |
| Marketing y growth | 40 | ads, ad-creative, cro, copywriting, emails, pricing, competitors |
| Creación de contenido | 36 | caption-generator, cta-generator, carousel-generator, banner-generator, hook-generator |
| Operación interna Krealo | 33 | krealo-publisher-api, mis-tareas-publisher, publisher-crear-tarea, krealo-approval-gate |
| Móvil (Expo / EAS / SwiftUI) | 22 | expo-router, expo-native-ui, eas-app-stores, mobile-app-ui-design, swiftui-expert |
| Proceso de ingeniería (gstack) | 13 | gstack-spec, gstack-review, gstack-qa, gstack-ship |
| SEO y analítica | 10 | seo-audit, ai-seo, programmatic-seo, schema, google-search-console |
| Diseño y UI | 9 | **frontend-design**, **ui-ux-pro-max**, design, design-system, brand, ui-styling, 3d-web-experience |
| Animación (GSAP) | 8 | gsap-core, gsap-scrolltrigger, gsap-timeline, gsap-react |

### Los dos principales de diseño
- **`frontend-design`** — proceso anti-template: brainstorm → explorar → plan → crítica → codear → crítica.
- **`ui-ux-pro-max`** — motor generador. CLI:
  `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system --project-name "Krealo Shift" --stack <stack>`
  Dominios: style, color, chart, landing, product, ux, typography, icons, gsap, react, web, google-fonts.
  Genera propuestas, no decide: la coherencia la valida el paso de crítica de `frontend-design`.

### Notas de la instalación
- A 12 skills se les **generó frontmatter YAML** (`name` + `description` derivados de su
  propio título y descripción) porque su `SKILL.md` no lo tenía y sin él Claude Code no
  los registra: web-scraper-cloud, publisher-feature-tracker, wp-landing-blog-quality,
  autoblog-seo-writer, canva-assistant, content-hook-framework, browser-playwright,
  godaddy-domains, linkedin-publisher, twitter-publisher, wix-blog-publisher y
  3d-web-experience (este último resuelto desde un symlink).
- **No recuperables desde GitHub** (symlinks rotos en `claw`, sus destinos nunca se
  commitearon): `shadcn-ui`, `remotion`, `taste-design`, `enhance-prompt`,
  `react-vite-dashboard`, `design-md` y los nueve `stitch-*`. Existen solo en la máquina local.
- **`awesome-design-md`** (73 DESIGN.md de marcas) tampoco está en GitHub: en `claw` es un
  submódulo sin registrar, solo el puntero al commit `664b3e7`.
- `diagram-maker` no existe en ningún repo de kwsystems.
- Animación por npm según el stack: `motion`/`framer-motion` y `gsap` + ScrollTrigger.
  Son dependencias, no skills.

**21st.dev** (patrones de sección premium, pagado): CLI `npx -y @21st-dev/cli`.
Requiere `TWENTYFIRST_TOKEN` en el entorno — verificado, tier paid. Sin él solo corre `21st logo`.
