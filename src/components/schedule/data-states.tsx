import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { adminErrorKind, type AdminErrorKind } from '@/hooks/use-admin-query';

/**
 * Estados obligatorios de cada pantalla, en un solo sitio (§20).
 *
 * Traduce el fallo técnico a lo que le pasa a la persona: no hay ni un mensaje
 * de Supabase, ni un código, ni un JSON en pantalla. Cada caso dice qué ocurrió y
 * qué se puede hacer.
 */

type ErrorCopy = { title: string; body: string; retryable: boolean };

export function useAdminErrorCopy(error: unknown): ErrorCopy {
  const { t } = useTranslation();
  const kind: AdminErrorKind = adminErrorKind(error);

  switch (kind) {
    case 'notConfigured':
      return {
        title: t('states.notConfiguredTitle'),
        body: t('states.notConfiguredBody'),
        retryable: false,
      };
    case 'offline':
      return {
        title: t('states.offlineTitle'),
        body: t('states.offlineAdminBody'),
        retryable: true,
      };
    case 'forbidden':
      return {
        title: t('states.permissionDeniedTitle'),
        body: t('states.noAccessBody'),
        retryable: false,
      };
    case 'conflict':
      return {
        title: t('states.conflictTitle'),
        body: t('errors.concurrentEdit'),
        retryable: true,
      };
    case 'notFound':
      return { title: t('states.notFoundTitle'), body: t('states.notFoundBody'), retryable: true };
    case 'invalid':
      return { title: t('states.invalidTitle'), body: t('states.invalidBody'), retryable: false };
    case 'unexpectedShape':
      return {
        title: t('states.errorTitle'),
        body: t('states.unexpectedShapeBody'),
        retryable: true,
      };
    default:
      return { title: t('states.errorTitle'), body: t('states.errorBody'), retryable: true };
  }
}

export function AdminErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const copy = useAdminErrorCopy(error);
  return (
    <ErrorState
      title={copy.title}
      body={copy.body}
      onRetry={copy.retryable ? onRetry : undefined}
    />
  );
}

/**
 * Envoltura de una sección con datos remotos: carga, error con reintento, vacío
 * con siguiente acción y, si todo va bien, el contenido.
 */
export function AsyncSection({
  isPending,
  error,
  isEmpty = false,
  loadingLabel,
  emptyTitle,
  emptyBody,
  emptyActionLabel,
  onEmptyAction,
  onRetry,
  children,
}: {
  isPending: boolean;
  error: unknown;
  isEmpty?: boolean;
  loadingLabel?: string;
  emptyTitle?: string;
  emptyBody?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  if (isPending) return <LoadingState label={loadingLabel} />;
  if (error !== null && error !== undefined) {
    return <AdminErrorState error={error} onRetry={onRetry} />;
  }
  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle ?? t('states.emptyTitle')}
        body={emptyBody}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
      />
    );
  }

  return <>{children}</>;
}
