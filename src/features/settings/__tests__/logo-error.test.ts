import { claveDelFallo } from '../logo-field';
import { toAdminError } from '@/hooks/use-admin-query';

/**
 * EL MENSAJE DE UN FALLO DE SUBIDA TIENE QUE NOMBRAR LA CAUSA CORRECTA.
 *
 * DE DÓNDE SALE. El 2026-09-28 subir el logo de una empresa falló con «No pudimos
 * subir el logotipo. Revisa tu conexión y vuelve a intentarlo» estando la conexión
 * perfecta. Buscar la causa costó descartar a ciegas el bucket, las reglas de Storage,
 * el rol del usuario y el id de la membresía —todo correcto—, porque el error real se
 * perdía en un `catch` vacío y porque la tabla de códigos no conocía NINGUNO de los de
 * Storage: todos caían en «servidor» y de ahí al texto de la conexión.
 *
 * Un mensaje que nombra la causa equivocada es peor que uno que dice «no sé»: manda a
 * mirar donde no está el problema. Estas pruebas fijan que no vuelva a pasar.
 */
describe('la clasificación de un fallo de Storage', () => {
  it('«no tienes permiso» NO se cuenta como problema de conexión', () => {
    const error = toAdminError({
      code: 'storage/unauthorized',
      message: 'User does not have permission.',
    });
    expect(error.kind).toBe('forbidden');
    expect(claveDelFallo(error).clave).toBe('settings.logoForbidden');
  });

  it('la sesión caducada también es permiso, no red', () => {
    expect(toAdminError({ code: 'storage/unauthenticated', message: '' }).kind).toBe('forbidden');
  });

  it('lo que SÍ es red se clasifica como red', () => {
    const error = toAdminError({ code: 'storage/retry-limit-exceeded', message: '' });
    expect(error.kind).toBe('offline');
    expect(claveDelFallo(error).clave).toBe('settings.logoUploadFailed');
  });

  it('un código desconocido se enseña TAL CUAL en vez de inventar una causa', () => {
    const error = toAdminError({ code: 'storage/quota-exceeded', message: '' });
    const { clave, codigo } = claveDelFallo(error);
    expect(clave).toBe('settings.logoUploadFailedCode');
    expect(codigo).toBe('storage/quota-exceeded');
  });

  it('el código crudo se conserva, que es lo que faltaba para diagnosticar', () => {
    expect(toAdminError({ code: 'storage/unauthorized', message: '' }).code).toBe(
      'storage/unauthorized',
    );
  });

  it('sin código no se inventa uno: cae en el mensaje general', () => {
    expect(claveDelFallo(new Error('algo raro')).clave).toBe('settings.logoUploadFailed');
  });
});
