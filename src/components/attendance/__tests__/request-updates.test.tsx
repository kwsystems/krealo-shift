import { screen } from '@testing-library/react-native';

import { RequestUpdatesCard } from '../request-updates';
import type { RequestUpdate } from '@/features/kiosk/api';
import { renderWithProviders } from '@/test-utils/render';

/**
 * Resultado de las solicitudes en el kiosco (§19).
 *
 * Lo que se fija: que la persona vea en qué quedó lo que reportó, incluido cuando
 * la respuesta es "no". El kiosco creaba solicitudes y nadie le devolvía el
 * resultado, que es el paso que le importa a quien reportó el problema.
 */

const aprobada: RequestUpdate = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'forgot_clock_out',
  status: 'approved',
  targetDate: '2026-08-20',
  reason: 'Me olvide de marcar la salida',
  reviewerComment: 'Verificado con la camara',
  reviewedAt: '2026-08-21T14:00:00Z',
};

const rechazada: RequestUpdate = {
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'forgot_break',
  status: 'rejected',
  targetDate: '2026-08-19',
  reason: 'Tome el descanso y no lo registre',
  reviewerComment: 'No coincide con el registro',
  reviewedAt: '2026-08-20T09:00:00Z',
};

const TZ = 'America/Lima';

describe('RequestUpdatesCard', () => {
  it('no pinta nada cuando no hay novedades', async () => {
    // Ni un "no tienes novedades": la pantalla del kiosco se mira de pie y por unos
    // segundos, y una tarjeta vacia empuja hacia abajo los botones de fichar, que
    // es lo unico que la persona vino a hacer.
    await renderWithProviders(<RequestUpdatesCard updates={[]} timezone={TZ} language="es-PE" />);
    expect(screen.queryByTestId('kiosk-request-updates')).toBeNull();
  });

  it('muestra una aprobación con el comentario de quien la revisó', async () => {
    await renderWithProviders(
      <RequestUpdatesCard updates={[aprobada]} timezone={TZ} language="es-PE" />,
    );
    expect(screen.getByTestId('kiosk-request-updates')).toBeTruthy();
    expect(screen.getByTestId('kiosk-request-update-approved')).toBeTruthy();
    expect(screen.getByText(/Aprobado/)).toBeTruthy();
    expect(screen.getByText(/Salida que faltaba/)).toBeTruthy();
    expect(screen.getByText('Verificado con la camara')).toBeTruthy();
  });

  it('muestra un rechazo, y a quién acudir', async () => {
    // Un rechazo silencioso es peor que un rechazo: la persona sigue creyendo que
    // le van a pagar esa hora.
    await renderWithProviders(
      <RequestUpdatesCard updates={[rechazada]} timezone={TZ} language="es-PE" />,
    );
    expect(screen.getByTestId('kiosk-request-update-rejected')).toBeTruthy();
    expect(screen.getByText(/No aprobado/)).toBeTruthy();
    expect(screen.getByText('No coincide con el registro')).toBeTruthy();
    expect(screen.getByText(/habla con tu encargado/i)).toBeTruthy();
  });

  it('no ofrece a quién reclamar cuando todo está aprobado', async () => {
    await renderWithProviders(
      <RequestUpdatesCard updates={[aprobada]} timezone={TZ} language="es-PE" />,
    );
    expect(screen.queryByText(/habla con tu encargado/i)).toBeNull();
  });

  it('cae en el motivo propio cuando no hay comentario de revisión', async () => {
    // Sin comentario, "Aprobado" a secas no dice de que: alguien puede tener tres
    // solicitudes en una semana.
    await renderWithProviders(
      <RequestUpdatesCard
        updates={[{ ...aprobada, reviewerComment: null }]}
        timezone={TZ}
        language="es-PE"
      />,
    );
    expect(screen.getByText('Me olvide de marcar la salida')).toBeTruthy();
  });

  it('nunca muestra quién revisó: el iPad es compartido', async () => {
    await renderWithProviders(
      <RequestUpdatesCard updates={[aprobada, rechazada]} timezone={TZ} language="es-PE" />,
    );
    // El tipo no trae reviewedBy, y esto lo fija desde la pantalla: si alguien lo
    // anadiera al contexto del kiosco y lo pintara aqui, esta prueba falla.
    expect(screen.queryByText(/revisad[oa] por/i)).toBeNull();
  });

  it('funciona en inglés', async () => {
    await renderWithProviders(
      <RequestUpdatesCard updates={[rechazada]} timezone={TZ} language="en" />,
      { language: 'en' },
    );
    expect(screen.getByText(/Not approved/)).toBeTruthy();
    expect(screen.getByText(/Missing break/)).toBeTruthy();
    expect(screen.getByText(/talk to your manager/i)).toBeTruthy();
  });

  it('aguanta una solicitud sin fecha afectada', async () => {
    // `target_date` es nullable en la base: una correccion puede no apuntar a un dia.
    await renderWithProviders(
      <RequestUpdatesCard
        updates={[{ ...aprobada, targetDate: null }]}
        timezone={TZ}
        language="es-PE"
      />,
    );
    expect(screen.getByTestId('kiosk-request-update-approved')).toBeTruthy();
  });
});
