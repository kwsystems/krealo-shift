import { LOGO_MAX_BYTES, logoStoragePath, validateLogo, type LogoMimeType } from '../logo';
import { formatMegabytes } from '../logo-field';

/**
 * Logotipo de la organización (§11.6).
 *
 * Lo que se fija aquí son las tres decisiones que, si se cambian sin querer, dejan
 * un bucket público lleno de basura o un logotipo que no se ve.
 */

describe('validateLogo', () => {
  it('acepta los tres formatos del bucket', () => {
    for (const tipo of ['image/png', 'image/jpeg', 'image/webp'] as LogoMimeType[]) {
      expect(validateLogo({ bytes: 1000, contentType: tipo })).toBeNull();
    }
  });

  it('rechaza un formato que el bucket no admite, y dice cuál era', () => {
    // El mensaje necesita el tipo: "no se pudo subir" no le sirve a quien acaba de
    // elegir un PDF o un HEIC del iPhone.
    expect(validateLogo({ bytes: 1000, contentType: 'image/heic' })).toEqual({
      reason: 'unsupportedType',
      contentType: 'image/heic',
    });
  });

  it('rechaza SVG, aunque el bucket lo admita', () => {
    // El bucket lo permite pero el cliente no lo ofrece: react-native `Image` no
    // pinta SVG sin una librería aparte, así que aceptarlo aquí produciría un
    // logotipo que se sube bien y no se ve nunca en el iPad.
    expect(validateLogo({ bytes: 1000, contentType: 'image/svg+xml' })).toEqual({
      reason: 'unsupportedType',
      contentType: 'image/svg+xml',
    });
  });

  it('acepta exactamente el límite y rechaza un byte más', () => {
    expect(validateLogo({ bytes: LOGO_MAX_BYTES, contentType: 'image/png' })).toBeNull();
    expect(validateLogo({ bytes: LOGO_MAX_BYTES + 1, contentType: 'image/png' })).toEqual({
      reason: 'tooLarge',
      bytes: LOGO_MAX_BYTES + 1,
    });
  });

  it('comprueba el tipo ANTES del tamaño', () => {
    // Un archivo grande y de formato equivocado tiene dos problemas; decir primero
    // el del formato es mejor consejo, porque cambiar de formato suele resolver
    // también el tamaño.
    expect(validateLogo({ bytes: LOGO_MAX_BYTES * 4, contentType: 'application/pdf' })).toEqual({
      reason: 'unsupportedType',
      contentType: 'application/pdf',
    });
  });
});

describe('logoStoragePath', () => {
  const org = '11111111-1111-4111-8111-111111111111';

  it('es una ruta fija por organización, sin fecha ni azar', () => {
    // Con nombres únicos se acumularían versiones que nadie va a limpiar, en un
    // bucket de LECTURA PÚBLICA. Hay un logotipo por organización y sustituirlo
    // tiene que sustituirlo.
    expect(logoStoragePath(org, 'image/png')).toBe(`${org}/logo.png`);
    expect(logoStoragePath(org, 'image/png')).toBe(logoStoragePath(org, 'image/png'));
  });

  it('la organización es el PRIMER segmento', () => {
    // La política de Storage autoriza leyendo `(storage.foldername(name))[1]`: si el
    // id dejara de ser el primer segmento, la escritura se autorizaría contra otra
    // organización o fallaría al convertir a uuid.
    expect(logoStoragePath(org, 'image/jpeg').split('/')[0]).toBe(org);
  });

  it('la extensión sigue al tipo', () => {
    expect(logoStoragePath(org, 'image/jpeg')).toBe(`${org}/logo.jpg`);
    expect(logoStoragePath(org, 'image/webp')).toBe(`${org}/logo.webp`);
  });
});

describe('formatMegabytes', () => {
  it('sin decimal cuando es exacto', () => {
    expect(formatMegabytes(1_048_576)).toBe('1 MB');
  });

  it('con una decimal y coma decimal, que es lo que se usa en es-PE', () => {
    expect(formatMegabytes(4_404_019)).toBe('4,2 MB');
  });
});
