import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tabForKind, type RequestTab, type TimeEditRequest } from './api';
import { useRequestMutations, useRequests } from './hooks';
import { FormField } from '@app/(auth)/sign-in';
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
import { useManagerScope } from '@/hooks/use-manager-scope';
import { currentLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { formatClockTime } from '@/utils/time';

/**
 * Bandeja unificada de solicitudes (§11.5).
 *
 * Aprobar aplica el ajuste cuando la solicitud señala una sesión concreta con
 * horas propuestas; cuando no, la decisión queda registrada y la pantalla dice
 * con claridad qué falta para aplicarla. Nunca se finge un cambio que no ocurrió.
 */

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
  const language = currentLanguage();

  const [tab, setTab] = useState<RequestTab>('corrections');
  const [onlyPending, setOnlyPending] = useState(true);
  const [commenting, setCommenting] = useState<TimeEditRequest | null>(null);
  const [comment, setComment] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const organizationId = scope.organization?.id ?? null;
  const requests = useRequests({ organizationId, locationId: scope.locationId });
  const names = useEmployeeNames(organizationId);
  const mutations = useRequestMutations();

  const visible = useMemo(
    () =>
      (requests.data ?? []).filter(
        (request) =>
          tabForKind(request.kind) === tab && (!onlyPending || request.status === 'pending'),
      ),
    [requests.data, tab, onlyPending],
  );

  const pendingByTab = useMemo(() => {
    const counts: Record<RequestTab, number> = { corrections: 0, forgot: 0, unscheduled: 0 };
    for (const request of requests.data ?? []) {
      if (request.status !== 'pending') continue;
      counts[tabForKind(request.kind)] += 1;
    }
    return counts;
  }, [requests.data]);

  const decide = (request: TimeEditRequest, decision: 'approved' | 'rejected') => {
    mutations.review.mutate(
      { request, decision, comment: null },
      {
        onSuccess: ({ applied }) => {
          setFeedback(
            decision === 'approved'
              ? applied
                ? t('requests.approvedApplied')
                : t('requests.approvedNotApplied')
              : t('requests.rejected'),
          );
        },
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
        value={tab}
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
        <InlineNotice tone="working" icon="checkmark-circle" title={feedback} />
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
            const proposed =
              request.proposed_value.startsAt ?? request.proposed_value.proposedAt ?? null;
            const canApply = request.work_session_id !== null && proposed !== null;

            return (
              <Card key={request.id}>
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

                {request.target_date !== null ? (
                  <KeyValueRow label={t('schedule.date')} value={request.target_date} />
                ) : null}
                {proposed !== null ? (
                  <KeyValueRow
                    label={t('kiosk.forgotProposedTime')}
                    value={formatClockTime(proposed, scope.timezone, scope.timeFormat, language)}
                  />
                ) : null}
                <KeyValueRow label={t('timesheet.reasonLabel')} value={request.reason} />
                {request.reviewer_comment !== null ? (
                  <KeyValueRow label={t('requests.comment')} value={request.reviewer_comment} />
                ) : null}

                <AppText variant="label" tone="subtle">
                  {canApply ? t('requests.impactApplies') : t('requests.impactManual')}
                </AppText>

                {request.status === 'pending' ? (
                  <Row gap={spacing.sm} wrap>
                    <PrimaryButton
                      label={t('requests.approve')}
                      onPress={() => decide(request, 'approved')}
                      fullWidth={false}
                      loading={mutations.review.isPending}
                      testID={`request-approve-${request.id}`}
                    />
                    <DangerButton
                      label={t('requests.reject')}
                      onPress={() => decide(request, 'rejected')}
                      fullWidth={false}
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
                      setFeedback(t('requests.commentSaved'));
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
    </Stack>
  );
}
