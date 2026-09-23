import { initI18n } from '@/i18n';
import { usePreferencesStore } from '@/stores/preferences-store';

/**
 * Que el panel RECUERDE en qué empresa estabas.
 *
 * La tarea lo pedía con estas palabras: «que recuerde cuál elegiste: si cada recarga
 * vuelve a la primera, el selector no sirve de nada». En web «recarga» es además cada
 * pestaña nueva, así que sin esto elegir Canadá sería un gesto a repetir todo el día.
 *
 * La segunda prueba es la que de verdad importa y la que motivó el cambio: guardar
 * cada preferencia reconstruía el objeto entero a mano en cada setter, así que el que
 * olvidara un campo lo BORRABA del almacenamiento sin fallar en nada. Con cuatro
 * campos eso significa que cambiar el tema te devolvía a la primera empresa —una causa
 * y un síntoma que no se parecen en nada—.
 */

const recargar = async () => {
  /*
   * Lo que hace el arranque de verdad: `app/_layout.tsx` llama a `hydrate` y no monta
   * ninguna pantalla hasta que termina. Se vuelve al estado de fábrica primero para que
   * lo que salga venga del almacenamiento y no de lo que quedó en memoria — sin esto la
   * prueba pasaría aunque no se guardara nada.
   */
  usePreferencesStore.setState({ managerOrganizationId: null, theme: 'system' });
  await usePreferencesStore.getState().hydrate();
};

describe('la empresa elegida sobrevive a una recarga', () => {
  /*
   * `hydrate` aplica el idioma guardado, e i18n no existe hasta que alguien lo
   * inicializa: sin esto lanza, y el fallo habla de traducciones en una prueba que no
   * va de idiomas. Normalmente lo hace `renderWithProviders`, que aquí no hace falta.
   */
  beforeEach(() => {
    initI18n('es-PE');
  });

  it('se guarda y vuelve a salir al arrancar', async () => {
    await usePreferencesStore.getState().setManagerOrganizationId('org-ca');
    await recargar();

    expect(usePreferencesStore.getState().managerOrganizationId).toBe('org-ca');
  });

  it('cambiar el tema NO borra la empresa guardada', async () => {
    await usePreferencesStore.getState().setManagerOrganizationId('org-ca');
    await usePreferencesStore.getState().setTheme('dark');
    await recargar();

    expect(usePreferencesStore.getState().managerOrganizationId).toBe('org-ca');
    expect(usePreferencesStore.getState().theme).toBe('dark');
  });

  it('y al contrario: elegir empresa no borra el tema ni el formato de hora', async () => {
    await usePreferencesStore.getState().setTheme('dark');
    await usePreferencesStore.getState().setTimeFormat('12h');
    await usePreferencesStore.getState().setManagerOrganizationId('org-ca');
    await recargar();

    const estado = usePreferencesStore.getState();
    expect(estado.theme).toBe('dark');
    expect(estado.timeFormat).toBe('12h');
    expect(estado.managerOrganizationId).toBe('org-ca');
  });

  it('volver a null queda guardado: es «la de siempre», no «lo que había antes»', async () => {
    await usePreferencesStore.getState().setManagerOrganizationId('org-ca');
    await usePreferencesStore.getState().setManagerOrganizationId(null);
    await recargar();

    expect(usePreferencesStore.getState().managerOrganizationId).toBeNull();
  });
});
