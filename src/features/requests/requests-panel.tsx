import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TFunction } from 'i18next';

import {
  propuestaDe,
  RechazoDeLaSolicitud,
  registraFichajes,
  tabForKind,
  type FichajeDeLaAprobacion,
  type RequestTab,
  type TimeEditRequest,
} from './api';
import { AprobarSolicitudSheet } from './aprobar-sheet';
import { useRequestMutations, useRequests } from './hooks';
import { FormField } from '@/components/ui/form-field';
import { AsyncSection } from '@/components/schedule/data-states';
import {
  AdminSheet,
  InlineNotice,
  KeyValueRow,
  SegmentedControl,
} from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { useEmployeeNames } from '@/features/team/hooks';
import { adminErrorKind } from '@/hooks/use-admin-query';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { spacing } from '@/theme/tokens';

/**
 * Bandeja unificada de solicitudes (§11.5).
 *
 * Aprobar un «olvidé marcar» abre la hoja donde se confirma el día y la hora, y al
 * confirmarla el fichaje queda registrado. Una corrección sobre una sesión concreta aplica
 * el ajuste; sin sesión, la decisión queda registrada y la pantalla dice qué falta para
 * aplicarla. Nunca se finge un cambio que no ocurrió.
 *
 * Y NINGÚN FALLO SE CALLA (30-sep). Aprobar fallaba siempre —el servidor no dejaba— y la
 * pantalla no decía nada: el botón giraba, paraba, y la solicitud seguía ahí. Ahora el
 * error sale donde se pulsó, con lo que hay que hacer.
 */

/** Lo que se le dice a quien aprueba cuando no se pudo, según el motivo del servidor. */
export function mensajeDelFallo(t: TFunction, error: unknown): string {
  if (error instanceof RechazoDeLaSolicitud) {
    switch (error.motivo) {
      case 'NO_ENCAJA':
        if (error.tipo === 'clock_in') return t('requests.approveErrorAlreadyIn');
        if (error.tipo === 'break_start' && error.estado === 'ON_BREAK') {
          return t('requests.approveErrorAlreadyOnBreak');
        }
        if (error.tipo === 'break_end' && error.estado === 'WORKING') {
          return t('requests.approveErrorNotOnBreak');
        }
        if (error.estado === 'OFF_SHIFT') return t('requests.approveErrorNotIn');
        return t('requests.approveErrorNoFit');
      case 'CHOCA':
        return t('requests.approveErrorClash');
      case 'FALTA_SALIDA':
        return t('requests.approveErrorNeedsClockOut');
      case 'YA_RESUELTA':
        return t('requests.approveErrorAlreadyReviewed');
      case 'FUTURO':
        return t('requests.approveErrorFuture');
      case 'ORDEN':
        return t('requests.approveErrorOrder');
      default:
        return t('requests.approveErrorNoFit');
    }
  }
  const kind = adminErrorKind(error);
  if (kind === 'forbidden') return t('states.noAccessBody');
  if (kind === 'offline') return t('states.offlineAdminBody');
  return t('requests.reviewErrorGeneric');
}

const KIND_LABEL_KEYS: Record<TimeEditRequest['kind'], string> = {
  forgot_clock_in: 'kiosk.forgotClockIn',
  forgot_break: 'kiosk.forgotBreak',
  forgot_clock_out: 'kiosk.forgotClockOut',
  correction: 'requests.tabTimeCorrections',
  unscheduled_shift: 'requests.tabUnscheduledShifts',
};

export function RequestsPanel() {
  const { t } = useTranslation();
  const scope = useManagerScope();

  const [tab, setTab] = useState<RequestTab | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const [commenting, setCommenting] = useState<TimeEditRequest | null>(null);
  const [comment, setComment] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [aprobando, setAprobando] = useState<TimeEditRequest | null>(null);
  const [falloDeLaHoja, setFalloDeLaHoja] = useState<string | null>(null);

  const organizationId = scope.organization?.id ?? null;
  const requests = useRequests({ organizationId, locationId: scope.locationId });
  const names = useEmployeeNames(organizationId);
  const mutations = useRequestMutations();

  const pendingByTab = useMemo(() => {
    const counts: Record<RequestTab, number> = { corrections: 0, forgot: 0, unscheduled: 0 };
    for (const request of requests.data ?? []) {
      if (request.status !== 'pending') continue;
      counts[tabForKind(request.kind)] += 1;
    }
    return counts;
  }, [requests.data]);

  /**
   * LA PESTAÑA DE ENTRADA ES LA PRIMERA QUE TIENE ALGO PENDIENTE, y antes era siempre
   * «Correcciones de hora».
   *
   * El inicio destaca «1 solicitud esperando tu respuesta» y al pulsarlo se llegaba a
   * una pantalla que decía «No hay solicitudes pendientes», porque la que había era de
   * otro tipo y vivía dos pestañas más allá, con su número al lado que nadie mira
   * después de leer un cartel de vacío. Un contador que lleva a un vacío es peor que no
   * tener contador: la primera vez se busca, y la segunda ya no se pulsa.
   *
   * Es `null` hasta que llegan los datos justamente para poder decidirlo con ellos; en
   * cuanto alguien toca una pestaña, manda su elección y esto deja de opinar.
   */
  const tabElegida: RequestTab = useMemo(() => {
    if (tab !== null) return tab;
    return (
      (['corrections', 'forgot', 'unscheduled'] as const).find(
        (candidata) => pendingByTab[candidata] > 0,
      ) ?? 'corrections'
    );
  }, [tab, pendingByTab]);

  const visible = useMemo(
    () =>
      (requests.data ?? []).filter(
        (request) =>
          tabForKind(request.kind) === tabElegida && (!onlyPending || request.status === 'pending'),
      ),
    [requests.data, tabElegida, onlyPending],
  );

  const avisar = (mensaje: string) => {
    setFallo(null);
    setFeedback(mensaje);
  };
  const fallar = (error: unknown) => {
    setFeedback(null);
    setFallo(mensajeDelFallo(t, error));
  };

  const decide = (request: TimeEditRequest, decision: 'approved' | 'rejected') => {
    // Quien actúa se queda en su pestaña: si era la última pendiente de aquí, la
    // pantalla no debe saltar sola a otra mientras lee lo que pasó.
    setTab(tabElegida);

    if (decision === 'approved' && registraFichajes(request.kind)) {
      setFalloDeLaHoja(null);
      setAprobando(request);
      return;
    }

    mutations.review.mutate(
      { request, decision, comment: null },
      {
        onSuccess: ({ applied }) => {
          avisar(
            decision === 'approved'
              ? applied
                ? t('requests.approvedApplied')
                : t('requests.approvedNotApplied')
              : t('requests.rejected'),
          );
        },
        onError: fallar,
      },
    );
  };

  const confirmarAprobacion = (fichajes: FichajeDeLaAprobacion[], comment: string | null) => {
    const request = aprobando;
    if (request === null) return;
    setFalloDeLaHoja(null);
    mutations.review.mutate(
      { request, decision: 'approved', comment, fichajes },
      {
        onSuccess: () => {
          setAprobando(null);
          avisar(t('requests.approvedRegistered'));
        },
        // El fallo sale DENTRO de la hoja, junto a las horas que hay que corregir.
        onError: (error) => setFalloDeLaHoja(mensajeDelFallo(t, error)),
      },
    );
  };

  return (
    <Stack gap={spacing.base}>
      <AppText variant="section" accessibilityRole="header">
        {t('requests.title')}
      </AppText>

      <SegmentedControl
        label={t('requests.title')}
        value={tabElegida}
        options={[
          {
            value: 'corrections',
            label: `${t('requests.tabTimeCorrections')} (${pendingByTab.corrections})`,
          },
          { value: 'forgot', label: `${t('requests.tabForgotToClock')} (${pendingByTab.forgot})` },
          {
            value: 'unscheduled',
            label: `${t('requests.tabUnscheduledShifts')} (${pendingByTab.unscheduled})`,
          },
        ]}
        onChange={setTab}
        testID="requests-tabs"
      />

      <SegmentedControl
        label={t('requests.filterLabel')}
        value={onlyPending ? 'pending' : 'all'}
        options={[
          { value: 'pending', label: t('requests.statusPending') },
          { value: 'all', label: t('team.statusAll') },
        ]}
        onChange={(value) => setOnlyPending(value === 'pending')}
        testID="requests-filter"
      />

      {feedback !== null ? (
        <InlineNotice
          tone="working"
          icon="checkmark-circle"
          title={feedback}
          testID="requests-feedback"
        />
      ) : null}
      {fallo !== null ? (
        <InlineNotice
          tone="late"
          icon="alert-circle-outline"
          body={fallo}
          testID="requests-error"
        />
      ) : null}

      <AsyncSection
        isPending={requests.isPending}
        error={requests.error}
        isEmpty={visible.length === 0}
        emptyTitle={t('requests.noRequests')}
        emptyBody={t('requests.noRequestsHint')}
        onRetry={() => void requests.refetch()}
      >
        <Stack gap={spacing.sm}>
          {visible.map((request) => {
            const propuesta = propuestaDe(request, scope.timezone);
            const registra = registraFichajes(request.kind);
            const canApply =
              registra || (request.work_session_id !== null && propuesta.hora !== null);
            const decidiendo =
              mutations.review.isPending && mutations.review.variables?.request.id === request.id;

            return (
              <Card key={request.id} testID={`solicitud-${request.kind}-${request.id}`}>
                <Row justify="space-between" gap={spacing.md} align="flex-start">
                  <Stack gap={spacing.xs}>
                    <AppText variant="bodyStrong">
                      {names.get(request.employee_id) ?? t('team.unknownEmployee')}
                    </AppText>
                    <AppText variant="help" tone="muted">
                      {t(KIND_LABEL_KEYS[request.kind])}
                    </AppText>
                  </Stack>
                  <StatusBadge
                    label={
                      request.status === 'pending'
                        ? t('requests.statusPending')
                        : request.status === 'approved'
                          ? t('requests.statusApproved')
                          : t('requests.statusRejected')
                    }
                    tone={
                      request.status === 'pending'
                        ? 'info'
                        : request.status === 'approved'
                          ? 'working'
                          : 'offShift'
                    }
                    icon={
                      request.status === 'pending'
                        ? 'hourglass-outline'
                        : request.status === 'approved'
                          ? 'checkmark-circle'
                          : 'close-circle-outline'
                    }
                    compact
                  />
                </Row>

                {propuesta.fecha !== null ? (
                  <KeyValueRow label={t('schedule.date')} value={propuesta.fecha} />
                ) : null}
                {propuesta.hora !== null ? (
                  <KeyValueRow label={t('kiosk.forgotProposedTime')} value={propuesta.hora} />
                ) : null}
                <KeyValueRow label={t('timesheet.reasonLabel')} value={request.reason} />
                {request.reviewer_comment !== null ? (
                  <KeyValueRow label={t('requests.comment')} value={request.reviewer_comment} />
                ) : null}

                <AppText variant="label" tone="subtle">
                  {registra
                    ? t('requests.impactRegisters')
                    : canApply
                      ? t('requests.impactApplies')
                      : t('requests.impactManual')}
                </AppText>

                {request.status === 'pending' ? (
                  <Row gap={spacing.sm} wrap>
                    <PrimaryButton
                      label={t('requests.approve')}
                      onPress={() => decide(request, 'approved')}
                      fullWidth={false}
                      loading={decidiendo && mutations.review.variables?.decision === 'approved'}
                      disabled={mutations.review.isPending}
                      testID={`request-approve-${request.id}`}
                    />
                    <DangerButton
                      label={t('requests.reject')}
                      onPress={() => decide(request, 'rejected')}
                      fullWidth={false}
                      loading={decidiendo && mutations.review.variables?.decision === 'rejected'}
                      disabled={mutations.review.isPending}
                      testID={`request-reject-${request.id}`}
                    />
                    <SecondaryButton
                      label={t('requests.comment')}
                      onPress={() => {
                        setComment(request.reviewer_comment ?? '');
                        setCommenting(request);
                      }}
                      fullWidth={false}
                      testID={`request-comment-${request.id}`}
                    />
                  </Row>
                ) : null}
              </Card>
            );
          })}
        </Stack>
      </AsyncSection>

      {commenting !== null ? (
        <AdminSheet
          visible
          title={t('requests.comment')}
          onClose={() => setCommenting(null)}
          testID="request-comment-sheet"
          footer={
            <PrimaryButton
              label={t('common.save')}
              onPress={() => {
                const request = commenting;
                if (request === null) return;
                mutations.comment.mutate(
                  { requestId: request.id, comment },
                  {
                    onSuccess: () => {
                      setCommenting(null);
                      avisar(t('requests.commentSaved'));
                    },
                    onError: (error) => {
                      setCommenting(null);
                      fallar(error);
                    },
                  },
                );
              }}
              loading={mutations.comment.isPending}
              testID="request-comment-save"
            />
          }
        >
          <FormField
            label={t('requests.comment')}
            value={comment}
            onChangeText={setComment}
            multiline
            testID="request-comment-input"
          />
        </AdminSheet>
      ) : null}

      {aprobando !== null ? (
        <AprobarSolicitudSheet
          request={aprobando}
          employeeName={names.get(aprobando.employee_id) ?? t('team.unknownEmployee')}
          timezone={scope.timezone}
          requiredBreakMinutes={scope.settings.requiredBreakMinutes}
          saving={mutations.review.isPending}
          error={falloDeLaHoja}
          onConfirm={confirmarAprobacion}
          onClose={() => setAprobando(null)}
        />
      ) : null}
    </Stack>
  );
}
