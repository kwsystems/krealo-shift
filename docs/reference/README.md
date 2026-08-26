# Referencias de diseño

Copias de solo lectura traídas de `kwsystems/krealo-publisher` (commit `fff45b1`).
Son la referencia visual de **Krealo Publisher**, no de Krealo Shift. Sirven para
decidir cuánto hereda Shift de la familia Krealo. No editar aquí: la fuente vive
en el repo del Publisher.

| Archivo | Qué es |
|---|---|
| `krealo-publisher-DESIGN.md` | Tokens reales extraídos del código (2026-07-09): paleta HSL, Sora/Manrope, radius, inventario de 45 componentes shadcn, anti-patrones. |
| `krealo-publisher-DESIGN-SYSTEM.md` | Reglas de composición (v1 2026-07-06, actualizado en la ola 13 el 2026-08-21): jerarquía del 3, retícula de 8px, 4 tamaños de tipografía, canon de superficies y avisos. |

## Contradicciones entre ambos (el más reciente manda)

1. **Radio de tarjetas**: `DESIGN.md` dice `--radius: 0.75rem` con `rounded-lg`;
   `DESIGN-SYSTEM.md` (ola 13, más reciente) impone radio **único `rounded-2xl`**
   y menciona que convivían cuatro radios distintos. → vale `rounded-2xl`.
2. **Avisos/toasts**: `DESIGN.md` dice usar `toast` de sonner;
   `DESIGN-SYSTEM.md` lo prohíbe expresamente y exige `@/lib/notify`.
   → vale `@/lib/notify`.
3. **Padding**: `DESIGN.md` usa `p-4 md:p-6`; `DESIGN-SYSTEM.md` exige retícula
   de 8px con 24px de padding interno de tarjeta. → vale la retícula de 8px.
