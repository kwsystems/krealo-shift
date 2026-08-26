# Krealo Shift

Aplicación desarrollada para Krealo. El código vive en este repositorio
(`kwsystems/krealo-shift`); la gestión de tareas se hace en **Krealo Publisher**.

## Reglas de gestión de tareas (obligatorias)

Toda tarea creada o actualizada por un agente debe llevar:

| Campo | Valor |
|---|---|
| `companyName` | **"Krealo Shift"** — SIEMPRE. Nunca "Krealo Media", nunca "Krealo Publisher", nunca otro cliente. |
| `assignees` | `["andree@krealomedia.com"]` |
| `tags` | `["Claude"]` — etiqueta nativa ya existente. Usar el nombre exacto: un nombre nuevo CREA una etiqueta y no se puede borrar. |

### Ciclo de vida
Sincronizado con el trabajo real: se crea en `not_started` → al empezar a
trabajarla pasa a `in_progress` → al terminarla y verificarla pasa a `done`.

**Regla de oro:** si una tarea no se puede cerrar porque falta algo o hay dudas,
NO se cierra. Se deja un comentario explicando qué falta y se mantiene en
`in_progress`.

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

## Skills de diseño instalados (`.claude/skills/`)

Copiados desde `kwsystems/krealo-publisher` (`.claude/skills/`), commit origen `fff45b1`.

| Skill | Para qué |
|---|---|
| `frontend-design` | Proceso anti-template: brainstorm → explorar → plan → crítica → codear → crítica. |
| `ui-ux-pro-max` | Motor generador de sistemas de diseño. CLI: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system --project-name "Krealo Shift" --stack <stack>`. Dominios: style, color, chart, landing, product, ux, typography, icons, gsap, react, web, google-fonts. |
| `design`, `design-system`, `brand`, `ui-styling` | Sistema de diseño, tokens, marca y estilos. |
| `banner-design` | Banners. |
| `slides` | Presentaciones. |
| `gsap-core`, `gsap-scrolltrigger`, `gsap-timeline`, `gsap-plugins`, `gsap-react`, `gsap-frameworks`, `gsap-performance`, `gsap-utils` | GSAP: scroll-driven, timelines, integración con React y performance. |

Animación por npm según el stack que se elija: `motion`/`framer-motion` (micro-interacciones)
y `gsap` + ScrollTrigger (scroll-driven). No son skills, son dependencias.

**21st.dev** (patrones de sección premium, servicio pagado): CLI `npx -y @21st-dev/cli`.
Requiere `TWENTYFIRST_TOKEN` en el entorno — sin él, solo funciona `21st logo`.
