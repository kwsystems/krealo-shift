import en from '../locales/en.json';
import esPE from '../locales/es-PE.json';

/**
 * Prueba exigida por la especificación §18: ambos idiomas deben tener
 * exactamente las mismas claves. Una clave que falte en un idioma produce texto
 * en blanco o en el idioma equivocado en producción.
 */

type Json = { [key: string]: Json | string };

function flatten(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flatten(value, path);
  });
}

/** Extrae los marcadores {{x}} de una cadena para comparar interpolaciones. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1] ?? '').sort();
}

function valueAt(obj: Json, path: string): string | undefined {
  const found = path.split('.').reduce<Json | string | undefined>((acc, part) => {
    if (acc === undefined || typeof acc === 'string') return undefined;
    return acc[part];
  }, obj);
  return typeof found === 'string' ? found : undefined;
}

describe('paridad de traducciones es-PE / en', () => {
  const esKeys = flatten(esPE as Json).sort();
  const enKeys = flatten(en as Json).sort();

  it('no falta ninguna clave en inglés', () => {
    expect(esKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it('no falta ninguna clave en español', () => {
    expect(enKeys.filter((k) => !esKeys.includes(k))).toEqual([]);
  });

  it('usa los mismos marcadores de interpolación en ambos idiomas', () => {
    const mismatched = esKeys
      .map((key) => {
        const es = valueAt(esPE as Json, key) ?? '';
        const enValue = valueAt(en as Json, key) ?? '';
        return { key, es: placeholders(es), en: placeholders(enValue) };
      })
      .filter(({ es, en: enPh }) => JSON.stringify(es) !== JSON.stringify(enPh));

    expect(mismatched).toEqual([]);
  });

  it('no deja ninguna traducción vacía', () => {
    const empty = [...esKeys, ...enKeys].filter((key) => {
      const source = esKeys.includes(key) ? (esPE as Json) : (en as Json);
      return (valueAt(source, key) ?? '').trim() === '';
    });
    expect(empty).toEqual([]);
  });

  it('mantiene los plurales _one y _other emparejados', () => {
    const pluralBases = new Set(
      esKeys.filter((k) => k.endsWith('_one')).map((k) => k.replace(/_one$/, '')),
    );
    for (const base of pluralBases) {
      expect(esKeys).toContain(`${base}_other`);
      expect(enKeys).toContain(`${base}_one`);
      expect(enKeys).toContain(`${base}_other`);
    }
  });
});
