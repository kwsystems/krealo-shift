# Krealo Publisher — Design System (v1, 2026-07-06)

> Regla madre: **calma y jerarquía**. Referencia visual: Notion + Linear.
> Toda pantalla nueva o rediseñada DEBE cumplir esto. Si una regla se rompe,
> se justifica en el PR — no se rompe en silencio.

## 1. Jerarquía — la regla del 3
Cada pantalla tiene MÁXIMO 3 niveles de importancia visible:
- **Nivel 1 (1 elemento)**: el número o acción que importa hoy (grande, arriba-izquierda)
- **Nivel 2 (2-4 elementos)**: contexto inmediato (tarjetas medianas)
- **Nivel 3 (el resto)**: colapsado, en tabs, o detrás de "ver más"
Si algo no cabe en estos 3 niveles, NO va en la pantalla — va en una subpágina.

## 2. Retícula y espacio
- Grid de **8px**: todo margen/padding es múltiplo de 8 (8, 16, 24, 32, 48)
- Padding interno de tarjeta: **24px** (nunca 12 apretado)
- Separación entre secciones: **32-48px** — el aire ES el diseño
- Ancho máximo de contenido: **1200px centrado** (no pantalla completa estirada)

## 3. Tipografía — 4 tamaños en total, en toda la app
- `text-2xl font-semibold` — título de página (uno por pantalla)
- `text-sm font-medium` — títulos de tarjeta/sección
- `text-sm` — cuerpo
- `text-xs text-muted-foreground` — metadata (fechas, contadores)
PROHIBIDO: negritas dobles, mayúsculas sostenidas, más de 2 pesos por tarjeta.

## 4. Color — uno solo manda
- **Un color de acento** (el brand) para: acción primaria, links, estado activo. NADA MÁS.
- Grises para todo lo demás (fondos, bordes, texto secundario)
- Semánticos SOLO en estados: verde=publicado, ámbar=programado, rojo=fallo — como
  **puntos o badges pequeños**, nunca fondos de tarjeta completos
- Modo claro y oscuro salen gratis si solo se usan tokens (`bg-background`,
  `text-muted-foreground`, `border-border`) — jamás hex hardcodeado

## 5. Componentes — patrones fijos
- **Detalle/edición → Sheet lateral derecho** (como Notion). Modales SOLO para
  confirmaciones destructivas ("¿Borrar?")
- **Listas densas → tabla** con filas de 40px, no grillas de tarjetas gigantes
- **Métricas → número grande + label pequeño + delta** (↑12% vs semana pasada), sin decoración
- **Estados vacíos obligatorios**: ícono + 1 frase + 1 botón de acción. Nunca una caja hueca
- **Loading**: skeletons, no spinners a pantalla completa

## 6. Dashboard específicamente
Orden de arriba a abajo:
1. **Fila de 4 KPIs** (posts esta semana, engagement, tareas abiertas, fallos) — solo números
2. **Últimos posts** con analytics (likes/comentarios/vistas) — tabla compacta con thumbnail
3. **Actividad/salud** — colapsable
Todo lo demás (accesos rápidos, banners, promos internas) → fuera del dashboard.

## 6-bis. El canon de superficies y avisos (ola 13, 2026-08-21)
Escrito en código, no solo aquí: `src/lib/surfaces.ts` (tarjetas/tablas) y
`src/lib/notify.ts` (avisos). El test `src/test/uiConsistency.test.ts` falla si
algo se sale del canon, con el archivo delante.

- **Tarjeta**: `<Card>`. Si no puedes usarla, `SURFACE_CARD`. Radio **único**
  `rounded-2xl` — convivían cuatro (`lg`, `xl`, `2xl`, `3xl`) en la misma app.
- **Tabla**: `<Table>` de `components/ui`. Con `<table>` crudo, la cabecera lleva
  `border-b border-border/60 bg-muted/50 text-xs font-semibold uppercase
  tracking-wide text-muted-foreground` **en el `<thead>`** (esas cinco se heredan;
  no se repiten en cada `<th>`). El padding de `th` y `td` debe ser el MISMO o las
  columnas se desalinean.
- **Aviso**: `import { toast } from '@/lib/notify'` — nunca de `sonner` ni el
  `use-toast` de shadcn (ese ya no tiene contenedor montado). Duración por
  gravedad (éxito 3,5 s / error 8 s con botón de cerrar), abajo-derecha, tono por
  tipo con tokens y deduplicación por texto.
- **Título de página, migas y pestaña**: `src/lib/pageMeta.ts`, un solo mapa. Una
  página nueva se registra AHÍ y aparece en el topbar, en ⌘K, en las migas y en
  el título del navegador a la vez.

## 7. Proceso de cambio (obligatorio para agentes)
1. Rediseñar UNA pantalla por PR/commit
2. Screenshot con Playwright ANTES y DESPUÉS (guardar en /design-review/)
3. Keneth aprueba viendo las imágenes → recién entonces deploy vía gate
4. Ninguna pantalla nueva entra sin cumplir las secciones 1-5
