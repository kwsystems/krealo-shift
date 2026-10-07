/**
 * Un turno cambiado en Horario se ve cambiado en todas partes (Andree, 7-oct).
 *
 * Andree cambió el jueves de una vendedora: de turno partido a uno solo de 12:00 a 21:00, y
 * preguntó «¿se actualiza en todos lados?». Lo que se comprueba, en la demostración, con lo
 * mismo que hizo él:
 *
 * 1. EDITAR UN TURNO PUBLICADO a 12:00 – 21:00 con 1 h de refrigerio lo deja «cambiado» hasta
 *    publicar, y «Publicar solo los cambios» lo publica: la tarjeta dice sus horas nuevas.
 * 2. LO PROGRAMADO DE LA SEMANA cambia exactamente lo que cambió el turno, igual en Inicio y
 *    en Reportes.
 * 3. CANCELAR LA OTRA MITAD la quita de lo programado en Inicio y Reportes, y su tarjeta dice
 *    «Cancelado».
 * 4. LA FICHA DE EQUIPO, en «Próximos turnos», trae el turno nuevo si está por venir y nunca
 *    el cancelado.
 *
 * El celular de la persona lee los mismos turnos publicados que Horario: lo comprueba
 * `vistas-check` (sección 8). Aquí no se puede, porque la demostración vuelve a empezar al
 * cambiar de usuario.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/turno-editado-check.mjs dist-demo
 */
import { mkdirSync } from 'node:fs';

import {
  servirExport,
  cargarPlaywright,
  esperarPantalla,
  MARCADOR_ACCESO,
  MARCADORES,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/turno-editado-check.mjs <export-demo>');
  process.exit(2);
}

mkdirSync('capturas', { recursive: true });
const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8151);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

/* Solo la pestaña de delante: las de detrás siguen montadas dentro de un `aria-hidden`. */
const delante = (pagina, selector) =>
  pagina.locator(
    selector
      .split(',')
      .map((parte) => `${parte.trim()}:not([aria-hidden="true"] *)`)
      .join(', '),
  );
const texto = (pagina, selector) =>
  delante(pagina, selector)
    .allInnerTexts()
    .then((t) => t.join(' | '))
    .catch(() => '');
const aMinutos = (t) => {
  const m = /(\d+):(\d\d)/.exec(t ?? '');
  return m === null ? null : Number(m[1]) * 60 + Number(m[2]);
};

async function irPorElMenu(pagina, ruta) {
  await pagina.locator(`a[href$="${ruta}"]`).first().click();
  await esperarPantalla(pagina, MARCADORES[ruta], { asentar: 1500 });
}

/** Lo programado de la semana en Inicio y en Reportes, en minutos. */
async function programado(pagina) {
  await irPorElMenu(pagina, '/');
  const semana = await texto(pagina, '[data-testid="scheduled-vs-worked"]');
  const inicio = aMinutos(semana.split('/')[1] ?? '');
  await irPorElMenu(pagina, '/reports');
  const heroe = await texto(pagina, '[data-testid="report-hero"]');
  const reportes = aMinutos(/de (\d+:\d\d)/.exec(heroe)?.[1] ?? '');
  return { inicio, reportes };
}

/**
 * Las tarjetas de turno de Horario: `{ id, persona, partes }`. La persona sale de su fila de
 * la rejilla (la tarjeta no repite el nombre), y la etiqueta se parte en sus piezas.
 */
async function tarjetas(pagina) {
  return delante(pagina, '[data-testid^="shift-"][aria-label]').evaluateAll((nodos) =>
    nodos
      .map((n) => {
        let fila = n.parentElement;
        while (fila !== null && fila.querySelector('[data-testid^="grid-name-"]') === null) {
          fila = fila.parentElement;
        }
        const nombre = fila?.querySelector('[data-testid^="grid-name-"]');
        // El día, por la columna: la cabecera cuyo ancho contiene el centro de la tarjeta.
        const caja = n.getBoundingClientRect();
        const centro = caja.left + caja.width / 2;
        const cabecera = [...document.querySelectorAll('[data-testid^="grid-day-"]')].find((c) => {
          const r = c.getBoundingClientRect();
          return centro >= r.left && centro <= r.right;
        });
        return {
          dia: (cabecera?.getAttribute('data-testid') ?? '').slice('grid-day-'.length),
          id: (n.getAttribute('data-testid') ?? '').slice('shift-'.length),
          persona: (nombre?.getAttribute('data-testid') ?? '').slice('grid-name-'.length),
          nombre: (nombre?.innerText ?? '').split('\n')[0]?.trim() ?? '',
          partes: (n.getAttribute('aria-label') ?? '').split('. '),
        };
      })
      .filter((x) => /^[0-9a-f-]{36}$/.test(x.id)),
  );
}

/** «Próximos turnos» de la ficha de Equipo de esa persona: sus rangos, en orden. */
async function proximosDeEquipo(pagina, nombre) {
  await irPorElMenu(pagina, '/team');
  const fila = delante(pagina, '[data-testid^="team-member-"]').filter({ hasText: nombre });
  await fila.first().click();
  const hoja = pagina.locator('[data-testid="employee-detail-sheet"]');
  await hoja.waitFor({ timeout: 10000 });
  await pagina.waitForTimeout(1200);
  const ficha = await hoja.innerText();
  const tramo = (ficha.split('Próximos turnos')[1] ?? '').split('Horas trabajadas')[0] ?? '';
  const rangos = tramo.match(/\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/g) ?? [];
  const cerrarHoja = hoja.getByText('Cerrar', { exact: true });
  if ((await cerrarHoja.count()) > 0) await cerrarHoja.first().click();
  await hoja.waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
  return rangos.map((r) => r.replace(/\s+/g, ' '));
}

const netoDe = (tarjeta) =>
  aMinutos(tarjeta.partes.find((parte) => /^\d{2}:\d{2}$/.test(parte.trim())) ?? '');
const rangoDe = (tarjeta) =>
  tarjeta.partes.find((parte) => /\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/.test(parte)) ?? '';

try {
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
  const pagina = await contexto.newPage();
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 1500 });

  const antes = await programado(pagina);
  console.log(`  programado antes     Inicio ${antes.inicio} min, Reportes ${antes.reportes}`);
  if (antes.inicio !== antes.reportes) {
    problemas.push(
      `antes de tocar nada, Inicio programa ${antes.inicio} y Reportes ${antes.reportes}`,
    );
  }

  // --- 1. Editar un turno publicado a 12:00 – 21:00 con 1 h de refrigerio.
  await irPorElMenu(pagina, '/schedule');
  const publicadas = (await tarjetas(pagina)).filter(
    (t) => t.partes.includes('Publicado') && !t.partes.some((p) => /Falt|Cumplido/.test(p)),
  );
  /*
   * LOS DOS ÚLTIMOS TURNOS DE UNA MISMA PERSONA: los que más probablemente están por venir,
   * que es lo que se cambia de verdad (el jueves de mañana) y lo único que «Próximos turnos»
   * de Equipo enseña.
   */
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  const porPersona = new Map();
  for (const t of publicadas) {
    if (t.persona === '' || t.dia <= hoy) continue;
    porPersona.set(t.persona, [...(porPersona.get(t.persona) ?? []), t]);
  }
  // Si no quedan dos por venir (un sábado), dos cualesquiera: Equipo ya no se puede mirar.
  if ([...porPersona.values()].every((lista) => lista.length < 2)) {
    for (const t of publicadas) {
      if (t.persona === '') continue;
      porPersona.set(t.persona, [...(porPersona.get(t.persona) ?? []), t]);
    }
  }
  const suyas = [...porPersona.values()].find((lista) => lista.length >= 2) ?? [];
  const elegida = suyas[suyas.length - 1];
  const otra = suyas[suyas.length - 2];
  const porVenir = elegida !== undefined && otra !== undefined && otra.dia > hoy;
  if (elegida === undefined || otra === undefined) {
    problemas.push('Horario no tiene dos turnos publicados de una misma persona esta semana');
  } else {
    const persona = elegida.nombre;
    const proximosAntes = porVenir ? await proximosDeEquipo(pagina, persona) : [];
    if (porVenir) await irPorElMenu(pagina, '/schedule');
    const netoViejo = netoDe(elegida);
    await delante(pagina, `[data-testid="shift-${elegida.id}"]`).first().click();
    await pagina.locator('[data-testid="shift-form-sheet"]').waitFor({ timeout: 10000 });
    await pagina.locator('[data-testid="shift-start"]').fill('12:00');
    await pagina.locator('[data-testid="shift-end"]').fill('21:00');
    await pagina.locator('[data-testid="shift-break"]').fill('60');
    await pagina.locator('[data-testid="shift-form-save"]').click();
    await pagina.locator('[data-testid="shift-form-sheet"]').waitFor({ state: 'detached' });
    await pagina.waitForTimeout(800);
    const cambiada = (await tarjetas(pagina)).find((t) => t.id === elegida.id);
    if (cambiada === undefined || cambiada.partes.includes('Publicado')) {
      problemas.push('al guardar, el turno editado no queda como cambio sin publicar');
    }

    // «Publicar solo los cambios», con solo ese.
    await pagina.locator('[data-testid="schedule-publish-some"]').first().click();
    await pagina.locator('[data-testid="publish-picker"]:visible').waitFor({ timeout: 10000 });
    await pagina.waitForTimeout(400);
    const opcion = pagina.locator(`[data-testid="publish-pick-${elegida.id}"]:visible`);
    if ((await opcion.count()) === 0) {
      problemas.push('«Publicar solo los cambios» no ofrece el turno que se acaba de editar');
    }
    // Vienen todos los cambios pendientes marcados (la demostración tiene borradores del
    // sábado): se desmarcan los demás para publicar solo este, como haría quien gestiona.
    const otras = await pagina
      .locator('[data-testid^="publish-pick-"]:visible')
      .evaluateAll((nodos) => nodos.map((n) => n.getAttribute('data-testid')));
    for (const testid of otras) {
      if (testid !== `publish-pick-${elegida.id}`) {
        await pagina.locator(`[data-testid="${testid}"]:visible`).first().click();
      }
    }
    await pagina.locator('[data-testid="publish-selected"]').click();
    await pagina.locator('[data-testid="publish-picker"]').waitFor({ state: 'detached' });
    await pagina.waitForTimeout(1200);
    const publicada = (await tarjetas(pagina)).find((t) => t.id === elegida.id);
    if (publicada === undefined || !/12:00\s*[–-]\s*21:00/.test(rangoDe(publicada))) {
      problemas.push(`la tarjeta no dice 12:00 – 21:00: «${publicada?.partes.join('. ')}»`);
    } else if (!publicada.partes.includes('Publicado')) {
      problemas.push('después de publicar, la tarjeta no dice «Publicado»');
    } else if (netoDe(publicada) !== 480) {
      problemas.push(`la tarjeta dice ${netoDe(publicada)} min netos y no 08:00`);
    }
    console.log(
      `  editado              ${persona}: ${rangoDe(elegida)} → ${rangoDe(publicada ?? elegida)}`,
    );
    await pagina.screenshot({ path: 'capturas/turno-editado-horario.png' });

    // --- 2. Lo programado cambia lo mismo en Inicio y en Reportes.
    const tras = await programado(pagina);
    const esperado = (antes.inicio ?? 0) + 480 - (netoViejo ?? 0);
    console.log(
      `  programado editado   Inicio ${tras.inicio}, Reportes ${tras.reportes}, esperado ${esperado}`,
    );
    if (tras.inicio !== esperado || tras.reportes !== esperado) {
      problemas.push(
        `editar el turno debía dejar ${esperado} min programados: Inicio ${tras.inicio}, Reportes ${tras.reportes}`,
      );
    }

    // --- 3. Cancelar la otra mitad.
    await irPorElMenu(pagina, '/schedule');
    const netoOtra = netoDe(otra);
    await delante(pagina, `[data-testid="shift-${otra.id}"]`).first().click();
    await pagina.locator('[data-testid="shift-form-sheet"]').waitFor({ timeout: 10000 });
    await pagina.locator('[data-testid="shift-form-remove"]').click();
    await pagina.locator('[data-testid="confirm-sheet-confirm"]').click();
    await pagina.waitForTimeout(1200);
    const cancelada = (await tarjetas(pagina)).find((t) => t.id === otra.id);
    console.log(
      `  cancelado            ${cancelada === undefined ? 'ya no está en la rejilla' : `sigue en la rejilla: «${cancelada.partes.join('. ')}»`}`,
    );
    if (cancelada !== undefined && !cancelada.partes.includes('Cancelado')) {
      problemas.push(`el turno cancelado no dice «Cancelado»: «${cancelada.partes.join('. ')}»`);
    }
    const sinLaOtra = await programado(pagina);
    const esperadoSin = esperado - (netoOtra ?? 0);
    console.log(
      `  programado cancelado Inicio ${sinLaOtra.inicio}, Reportes ${sinLaOtra.reportes}, esperado ${esperadoSin}`,
    );
    if (sinLaOtra.inicio !== esperadoSin || sinLaOtra.reportes !== esperadoSin) {
      problemas.push(
        `cancelar el otro turno debía dejar ${esperadoSin} min: Inicio ${sinLaOtra.inicio}, Reportes ${sinLaOtra.reportes}`,
      );
    }

    // --- 4. La ficha de Equipo: «Próximos turnos» trae el nuevo y ya no el cancelado.
    if (!porVenir) {
      console.log('  equipo               sin dos turnos por venir: no se mira');
    } else {
      const despues = await proximosDeEquipo(pagina, persona);
      const rangoOtra = rangoDe(otra);
      const esperaOtra =
        proximosAntes.filter((r) => r === rangoOtra).length -
        1 -
        (rangoDe(elegida) === rangoOtra ? 1 : 0);
      const nuevos = despues.filter((r) => /12:00\s*[–-]\s*21:00/.test(r)).length;
      const nuevosAntes = proximosAntes.filter((r) => /12:00\s*[–-]\s*21:00/.test(r)).length;
      if (nuevos !== nuevosAntes + 1) {
        problemas.push(`«Próximos turnos» de Equipo no trae el turno nuevo: ${despues.join(', ')}`);
      }
      if (despues.filter((r) => r === rangoOtra).length !== esperaOtra) {
        problemas.push(
          `«Próximos turnos» de Equipo sigue trayendo el cancelado: ${despues.join(', ')}`,
        );
      }
      console.log(
        `  equipo               próximos ${proximosAntes.length} → ${despues.length}: ${despues.join(', ')}`,
      );
    }
  }
  await contexto.close();
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\n${problemas.length} problema(s):`);
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  '\nOK: un turno editado o cancelado en Horario cambia lo mismo en Inicio, Reportes y Equipo.',
);
