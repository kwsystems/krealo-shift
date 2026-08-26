# Krealo Publisher — Design System

> Extraído del código real (src/index.css + tailwind.config.ts + src/components/ui) el 2026-07-09.
> Este archivo es la fuente de verdad visual: toda UI nueva DEBE usar estos tokens — nunca colores/fuentes hardcodeados.

## Identity

Krealo Publisher es una plataforma profesional de gestión de publicación y marketing (agencia Krealo Media). El look es **limpio, neutro y de alto contraste, con un solo acento rojo**: superficies blancas/grises casi puras, tipografía geométrica moderna, y el rojo de marca reservado para acciones primarias, foco y datos destacados. Sidebar siempre oscura (identidad fija), contenido claro u oscuro según tema.

## Color Palette (HSL — usar SIEMPRE vía CSS vars / clases Tailwind)

### Brand
| Rol | Token | Valor claro | Valor oscuro |
|---|---|---|---|
| Primary (rojo Krealo) | `--primary` / `bg-primary` | `0 76% 55%` | igual |
| Primary foreground | `--primary-foreground` | blanco | blanco |
| Ring/focus | `--ring` | `0 76% 55%` | igual |

**Regla**: el rojo es ACENTO, no fondo dominante. Botón primario, links activos, foco, badge crítico, chart-1. Nada más.

### Superficies
| Rol | Light | Dark |
|---|---|---|
| `--background` | `0 0% 100%` | `0 0% 4%` |
| `--card` / `--popover` | `0 0% 100%` | `0 0% 7%` |
| `--surface-elevated` | `0 0% 99%` | — |
| `--surface-sunken` | `0 0% 97%` | — |
| `--secondary` / `--muted` / `--accent` | `0 0% 96%` | `0 0% 12%` |
| `--border` / `--input` | `0 0% 90%` | `0 0% 15%` |

### Texto
| Rol | Light | Dark |
|---|---|---|
| `--foreground` | `0 0% 4%` | `0 0% 96%` |
| `--muted-foreground` | `220 9% 46%` | `0 0% 60%` |

### Sidebar (SIEMPRE oscura, en ambos temas)
`--sidebar-background: 0 0% 4%` · texto `0 0% 90%` · accent `0 0% 12%` · border `0 0% 15%` · primary = rojo marca.

### Estados
- Destructive: `0 84% 60%` (light) / `0 62% 30%` (dark), texto blanco.
- Éxito/verde y warning/ámbar: usar utilidades Tailwind consistentes con el resto del código (`emerald-500` para ok, `amber` para avisos) — patrón ya usado en Tasks/Automation.

### Charts (dataviz — monocroma + acento)
`--chart-1: 0 76% 55%` (rojo) · `--chart-2: 0 0% 30%` · `--chart-3: 0 0% 50%` · `--chart-4: 0 0% 70%` · `--chart-5: 0 0% 85%`.
Serie principal en rojo, comparativas en escala de grises. No introducir arcoíris.

## Typography

| Uso | Fuente | Clase |
|---|---|---|
| Headings | **Sora** (300–800) | `font-heading` |
| Body/UI | **Manrope** (300–800) | `font-body` |
| Logo/marca | **Blanka** (local) | solo logo, no UI |

Import: Google Fonts (Sora + Manrope) en `src/index.css`. Jerarquía típica: h1 `text-2xl font-bold tracking-tight`, subtítulos `text-sm text-muted-foreground`, labels `text-xs font-medium text-muted-foreground`.

## Shape & Space

- **Radius base**: `--radius: 0.75rem` (`rounded-lg` en cards/dialogs, `rounded-md` inputs/selects, `rounded-full` pills/avatars/toggle chips).
- Padding de página: `p-4 md:p-6`. Gaps: `gap-2/3/4` según densidad. Cards internas `p-3`–`p-4`.
- Sombras: sutiles (`shadow-sm` por defecto; elevación solo en popovers/dialogs). Nada de sombras dramáticas.

## Components (shadcn/ui — inventario instalado, NO crear equivalentes a mano)

accordion · alert-dialog · alert · aspect-ratio · avatar · badge · breadcrumb · button · calendar · card · carousel · chart · checkbox · collapsible · command · context-menu · dialog · drawer · dropdown-menu · form · hover-card · input-otp · input · label · menubar · navigation-menu · pagination · popover · progress · radio-group · resizable · scroll-area · select · separator · sheet · sidebar · skeleton · slider · sonner (toasts) · switch · table · tabs · textarea · toast · toggle-group · toggle · tooltip

### Patrones de uso ya establecidos
- **Botón primario**: `<Button>` (rojo) — 1 por vista. Secundarios: `variant="outline"`. Terciarios/iconos: `variant="ghost" size="sm"`.
- **Filtros de listados**: fila de `<Select>` compactos (`w-[150px]`–`w-[170px]`) + búsqueda + botón limpiar `ghost` (patrón Tasks).
- **Feedback**: `toast.success/error` de sonner, mensajes cortos y localizados via `t()`.
- **Vacíos**: icono lucide `h-10 w-10 opacity-40` + texto `text-sm text-muted-foreground` centrado.
- **Secciones grandes**: `<Tabs>` en vez de scroll infinito (patrón Automation).
- **Iconos**: lucide-react exclusivamente, `h-4 w-4` en botones, `h-3.5 w-3.5` en acciones de fila.

## i18n (obligatorio)

Todo string visible pasa por `t('clave')` de `src/i18n/translations.ts` con **en/es/fr completos**. Prohibido texto hardcodeado en JSX (causa recurrente de bugs reportados por Keneth).

## Accesibilidad & Responsive

- Contraste AA mínimo: los tokens ya lo cumplen (foreground 4% sobre 100%).
- Foco visible: ring rojo (`--ring`) — no quitarlo.
- Mobile-first: grids `grid-cols-1 sm:grid-cols-2`, filtros con `flex-wrap`, tablas dentro de contenedor con scroll propio.
- Dark mode: NUNCA colores literales que solo funcionen en un tema — siempre tokens (`bg-card`, `text-muted-foreground`, etc.). Excepciones puntuales con par claro/oscuro (`bg-amber-50 dark:bg-amber-950/30`).

## Anti-patrones (prohibido)

1. Colores hex/hsl hardcodeados en componentes → usar tokens.
2. Fuentes distintas a Sora/Manrope.
3. Más de un botón primario rojo por vista.
4. Componentes UI caseros cuando existe el shadcn equivalente.
5. Strings sin `t()`.
6. Sombras/gradientes decorativos fuertes — el look es plano y limpio.
