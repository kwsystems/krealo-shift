import { managerAlertTypes as clientAlertTypes } from '../alerts';
import {
  ALERT_COPY,
  ALLOWED_PLACEHOLDERS,
  alertLocales,
  composeAlert,
  managerAlertTypes,
  resolveAlertLocale,
} from '../../../../supabase/functions/_shared/alert-messages';

/**
 * POR QUÉ ESTA PRUEBA VIVE AQUÍ Y NO JUNTO AL CÓDIGO QUE PRUEBA
 * El catálogo de textos de las notificaciones es código de la Edge Function, o sea
 * Deno: ESLint lo ignora y el `tsconfig` de la app lo excluye, así que nada
 * automático lo mira. Esta prueba es la única red que tiene, y por eso se pone
 * donde Jest la va a recoger con seguridad.
 *
 * Lo que fija, en orden de importancia:
 *   1. NINGÚN TEXTO PUEDE LLEVAR UN DATO PERSONAL. La garantía es mecánica: los
 *      únicos marcadores permitidos son `{{count}}` y `{{location}}`, y
 *      `composeAlert` no sabe sustituir nada más. Si alguien añade `{{employee}}`
 *      a un texto, esta prueba falla antes de que llegue a una pantalla de bloqueo.
 *   2. Los dos idiomas tienen los mismos textos y los mismos marcadores, igual que
 *      exige §18 para los JSON de la app.
 *   3. La lista de tipos del servidor y la del cliente coinciden. Si no, una alerta
 *      nueva llegaría al teléfono y al tocarla no abriría ninguna pantalla.
 */

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

function placeholdersOf(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '').sort();
}

describe('catálogo de textos de las alertas', () => {
  it('cubre todos los tipos en todos los idiomas', () => {
    for (const locale of alertLocales) {
      for (const type of managerAlertTypes) {
        const copy = ALERT_COPY[locale][type];
        expect(copy.title.trim()).not.toBe('');
        expect(copy.one.trim()).not.toBe('');
        expect(copy.other.trim()).not.toBe('');
      }
    }
  });

  it('no usa ningún marcador fuera de count y location', () => {
    const offending: string[] = [];
    for (const locale of alertLocales) {
      for (const type of managerAlertTypes) {
        const copy = ALERT_COPY[locale][type];
        for (const text of [copy.title, copy.one, copy.other]) {
          for (const name of placeholdersOf(text)) {
            if (!(ALLOWED_PLACEHOLDERS as readonly string[]).includes(name)) {
              offending.push(`${locale}.${type}: {{${name}}}`);
            }
          }
        }
      }
    }
    expect(offending).toEqual([]);
  });

  it('usa los mismos marcadores en los dos idiomas', () => {
    const mismatched = managerAlertTypes
      .map((type) => ({
        type,
        es: placeholdersOf(ALERT_COPY['es-PE'][type].other),
        en: placeholdersOf(ALERT_COPY.en[type].other),
      }))
      .filter(({ es, en }) => JSON.stringify(es) !== JSON.stringify(en));
    expect(mismatched).toEqual([]);
  });

  it('mantiene la misma lista de tipos que el cliente', () => {
    expect([...managerAlertTypes].sort()).toEqual([...clientAlertTypes].sort());
  });
});

describe('composeAlert', () => {
  it('usa el singular con un solo hecho y el plural con varios', () => {
    const one = composeAlert({
      type: 'late',
      locale: 'es-PE',
      count: 1,
      locationName: 'Sede Principal',
    });
    const many = composeAlert({
      type: 'late',
      locale: 'es-PE',
      count: 3,
      locationName: 'Sede Principal',
    });

    expect(one.body).toBe('Alguien no ha fichado su entrada en Sede Principal.');
    expect(many.body).toBe('3 personas no han fichado su entrada en Sede Principal.');
  });

  it('no deja ningún marcador sin sustituir', () => {
    for (const locale of alertLocales) {
      for (const type of managerAlertTypes) {
        for (const count of [1, 2]) {
          const { title, body } = composeAlert({ type, locale, count, locationName: 'Tienda' });
          expect(title).not.toMatch(PLACEHOLDER);
          expect(body).not.toMatch(PLACEHOLDER);
        }
      }
    }
  });

  it('trata un conteo absurdo como uno: nunca produce "0 personas"', () => {
    expect(composeAlert({ type: 'late', locale: 'en', count: 0, locationName: 'X' }).body).toBe(
      'Someone has not clocked in at X.',
    );
    expect(composeAlert({ type: 'late', locale: 'en', count: -5, locationName: 'X' }).body).toBe(
      'Someone has not clocked in at X.',
    );
  });

  it('no deja un hueco cuando la tienda no tiene nombre', () => {
    const { body } = composeAlert({
      type: 'noShow',
      locale: 'es-PE',
      count: 1,
      locationName: '  ',
    });
    expect(body).toContain('—');
  });
});

describe('resolveAlertLocale', () => {
  it('resuelve cualquier español a es-PE y cualquier inglés a en', () => {
    expect(resolveAlertLocale('es-PE')).toBe('es-PE');
    expect(resolveAlertLocale('es')).toBe('es-PE');
    expect(resolveAlertLocale('es-MX')).toBe('es-PE');
    expect(resolveAlertLocale('en')).toBe('en');
    expect(resolveAlertLocale('en-US')).toBe('en');
  });

  it('cae en es-PE ante cualquier otra cosa', () => {
    // `profiles.locale` es texto libre en la base: puede llegar vacío o con basura.
    expect(resolveAlertLocale(null)).toBe('es-PE');
    expect(resolveAlertLocale(undefined)).toBe('es-PE');
    expect(resolveAlertLocale('')).toBe('es-PE');
    expect(resolveAlertLocale('fr-FR')).toBe('es-PE');
  });
});
