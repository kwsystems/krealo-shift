import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormCard, InlineNotice } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Row, Stack } from '@/components/ui/layout';
import { useEstadoDeShopify, useMutacionesDeShopify } from '@/features/reports/ordenes-por-hora';
import { currentLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * CONECTAR LA TIENDA DE SHOPIFY (13-nov), para «Órdenes por hora» en Reportes.
 *
 * Con una app del Dev Dashboard de Shopify instalada en la tienda: aquí se pegan su ID y su
 * secreto, el servidor los prueba antes de guardarlos y trae los últimos 60 días. El secreto
 * no vuelve nunca a la app: después solo se ve el nombre de la tienda y cuándo se sincronizó.
 * Ver `functions/src/shopify.ts`.
 */
export function ShopifyCard({
  organizationId,
  canEdit,
}: {
  organizationId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const estado = useEstadoDeShopify(organizationId);
  const { conectar, desconectar, traerHistorial } = useMutacionesDeShopify(organizationId);
  const [tienda, setTienda] = useState('');
  const [clientId, setClientId] = useState('');
  const [secreto, setSecreto] = useState('');

  const conectada = estado.data ?? null;
  const cuando = (iso: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(iso),
    );

  return (
    <FormCard
      collapsible
      title={t('settings.shopify.title')}
      description={t('settings.shopify.hint')}
      testID="shopify-card"
    >
      {conectada !== null ? (
        <Stack gap={spacing.sm}>
          <AppText variant="bodyStrong" testID="shopify-connected">
            {t('settings.shopify.connectedTo', {
              name: conectada.shop_name ?? conectada.shop,
              shop: conectada.shop,
            })}
          </AppText>
          <AppText variant="help" tone="subtle">
            {conectada.last_sync_at === null
              ? t('settings.shopify.neverSynced')
              : t('settings.shopify.lastSync', { when: cuando(conectada.last_sync_at) })}
          </AppText>
          {conectada.last_error !== null ? (
            <InlineNotice
              tone="late"
              icon="warning-outline"
              title={t('settings.shopify.syncFailed')}
              body={conectada.last_error}
              testID="shopify-error"
            />
          ) : null}
          {/*
            EL HISTORIAL (13-nov): al conectar solo entran 60 días, lo que da `read_orders`. Con
            el permiso `read_all_orders` en la app, esto trae el último año sin volver a pegar
            el secreto. Sin el permiso, el servidor lo dice y no rellena días con ceros.
          */}
          {traerHistorial.isError ? (
            <InlineNotice
              tone="late"
              icon="warning-outline"
              title={t('settings.shopify.historyFailed')}
              body={traerHistorial.error.message}
              testID="shopify-history-error"
            />
          ) : null}
          {traerHistorial.isSuccess ? (
            <InlineNotice
              tone="working"
              icon="checkmark-circle-outline"
              title={t('settings.shopify.historyDone', {
                count: Number(traerHistorial.data?.orders ?? 0),
                days: Number(traerHistorial.data?.days ?? 0),
              })}
              testID="shopify-history-done"
            />
          ) : null}
          {canEdit ? (
            <Row gap={spacing.sm} wrap>
              <GhostButton
                label={t('settings.shopify.history')}
                loading={traerHistorial.isPending}
                onPress={() => traerHistorial.mutate()}
                fullWidth={false}
                testID="shopify-history"
              />
              <GhostButton
                label={t('settings.shopify.disconnect')}
                loading={desconectar.isPending}
                onPress={() => desconectar.mutate()}
                fullWidth={false}
                testID="shopify-disconnect"
              />
            </Row>
          ) : null}
        </Stack>
      ) : canEdit ? (
        <Stack gap={spacing.sm}>
          <AppText variant="help" tone="subtle">
            {t('settings.shopify.steps')}
          </AppText>
          <FormField
            label={t('settings.shopify.shop')}
            placeholder="tutienda.myshopify.com"
            value={tienda}
            onChangeText={setTienda}
            autoCapitalize="none"
            autoCorrect={false}
            testID="shopify-shop"
          />
          <FormField
            label={t('settings.shopify.clientId')}
            value={clientId}
            onChangeText={setClientId}
            autoCapitalize="none"
            autoCorrect={false}
            testID="shopify-client-id"
          />
          <FormField
            label={t('settings.shopify.clientSecret')}
            value={secreto}
            onChangeText={setSecreto}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            testID="shopify-client-secret"
          />
          {conectar.isError ? (
            <InlineNotice
              tone="late"
              icon="warning-outline"
              title={t('settings.shopify.connectFailed')}
              body={conectar.error.message}
              testID="shopify-connect-error"
            />
          ) : null}
          {conectar.isSuccess ? (
            <InlineNotice
              tone="working"
              icon="checkmark-circle-outline"
              title={t('settings.shopify.connected', {
                count: Number(conectar.data?.orders ?? 0),
                days: Number(conectar.data?.days ?? 0),
              })}
            />
          ) : null}
          <Row gap={spacing.sm}>
            <PrimaryButton
              label={t('settings.shopify.connect')}
              disabled={tienda.trim() === '' || clientId.trim() === '' || secreto.trim() === ''}
              loading={conectar.isPending}
              onPress={() =>
                conectar.mutate(
                  { shop: tienda, clientId, clientSecret: secreto },
                  { onSuccess: () => setSecreto('') },
                )
              }
              fullWidth={false}
              testID="shopify-connect"
            />
          </Row>
        </Stack>
      ) : (
        <AppText variant="help" tone="subtle">
          {t('settings.shopify.adminOnly')}
        </AppText>
      )}
    </FormCard>
  );
}
