import { useTranslation } from 'react-i18next';

import { InlineNotice } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { Card, Stack } from '@/components/ui/layout';
import type { RequestUpdate } from '@/features/kiosk/api';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { formatLongDate } from '@/utils/time';

/**
 * Resultado de las solicitudes de corrección de esta persona (§19).
 *
 * POR QUÉ EXISTE ESTA PANTALLA. El kiosco YA crea solicitudes: cuando alguien dice
 * "me olvidé de marcar la salida", eso genera una solicitud pendiente y auditable
 * que NO toca la hoja de tiempo, el encargado la resuelve en el panel, y hasta
 * ahora el empleado no se enteraba nunca de en qué quedó. El circuito estaba
 * abierto justo en el paso que le importa a quien reportó el problema, y eso es lo
 * que hace que la gente deje de reportar.
 *
 * SE MUESTRAN TAMBIÉN LAS RECHAZADAS, con el comentario. Un rechazo silencioso es
 * peor que un rechazo: la persona sigue creyendo que le van a pagar esa hora.
 */

const KIND_LABELS: Record<RequestUpdate['kind'], string> = {
  forgot_clock_in: 'kiosk.requestUpdateKindForgotClockIn',
  forgot_break: 'kiosk.requestUpdateKindForgotBreak',
  forgot_clock_out: 'kiosk.requestUpdateKindForgotClockOut',
  correction: 'kiosk.requestUpdateKindCorrection',
  unscheduled_shift: 'kiosk.requestUpdateKindUnscheduledShift',
};

export function RequestUpdatesCard({
  updates,
  timezone,
  language,
}: {
  updates: readonly RequestUpdate[];
  timezone: string;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();

  // Sin novedades no se pinta NADA, ni un "no tienes novedades": la pantalla del
  // kiosco se mira de pie y por unos segundos, y una tarjeta vacía empuja hacia
  // abajo los botones de fichar, que es lo único que la persona vino a hacer.
  if (updates.length === 0) return null;

  return (
    <Card testID="kiosk-request-updates">
      <Stack gap={spacing.sm}>
        <AppText variant="bodyStrong">{t('kiosk.requestUpdatesTitle')}</AppText>

        {updates.map((update) => {
          const aprobada = update.status === 'approved';
          // La fecha afectada, no la de la revisión: lo que la persona recuerda es
          // "el día que me olvidé de marcar", no cuándo lo revisó su encargado.
          const fecha =
            update.targetDate === null
              ? null
              : formatLongDate(update.targetDate, timezone, language);

          return (
            <InlineNotice
              key={update.id}
              tone={aprobada ? 'working' : 'late'}
              icon={aprobada ? 'checkmark-circle' : 'close-circle-outline'}
              title={
                t(aprobada ? 'kiosk.requestUpdateApproved' : 'kiosk.requestUpdateRejected') +
                ' · ' +
                t(KIND_LABELS[update.kind]) +
                (fecha === null ? '' : ' ' + t('kiosk.requestUpdateOn', { date: fecha }))
              }
              // El comentario de quien revisó si lo hay; si no, el motivo que dio
              // ella misma, que es lo que le permite reconocer de qué solicitud se
              // trata cuando tiene más de una.
              body={update.reviewerComment ?? update.reason}
              testID={`kiosk-request-update-${update.status}`}
            />
          );
        })}

        {/* Solo si hay algún rechazo: decirle a quién acudir es la mitad útil de un
            "no". Con todo aprobado no hay nada que reclamar. */}
        {updates.some((u) => u.status === 'rejected') ? (
          <AppText variant="help" tone="subtle">
            {t('kiosk.requestUpdateAskManager')}
          </AppText>
        ) : null}
      </Stack>
    </Card>
  );
}
