import { useState } from 'react';
import { View } from 'react-native';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { previewDeleteEmployee, type RecuentoDeBorrado } from './api';
import type { TeamMember } from './hooks';
import { AdminSheet, InlineNotice, KeyValueRow } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, SecondaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { SeparadorDeRegistro, Stack } from '@/components/ui/layout';
import { spacing } from '@/theme/tokens';

/**
 * «Eliminar varios»: los de prueba, de una vez.
 *
 * Lo pidió Andree el 29-sep, con siete registros de prueba en Inactivo: uno por uno,
 * abriendo cada ficha y escribiendo cada nombre, era pesado para algo que se hace una vez.
 *
 * Lo que NO se afloja es lo que protege al resto del equipo, que ya usa la app:
 *   - la lista con TODOS los nombres delante antes de confirmar, y lo que se borra de cada
 *     uno, preguntado al servidor sin borrar —igual que en el borrado de uno—;
 *   - una palabra escrita para confirmar: un toque no basta;
 *   - y el servidor sigue exigiendo que cada persona esté inactiva.
 */
export function EliminarVariosSheet({
  members,
  progreso,
  fallidos,
  onConfirm,
  onClose,
}: {
  members: TeamMember[];
  /** Cuántos van, mientras se borra. `null` antes de confirmar. */
  progreso: number | null;
  /** Nombres de quienes no se pudieron borrar en el último intento. */
  fallidos: string[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [escrito, setEscrito] = useState('');
  const palabra = t('team.deleteManyWord');

  // La misma clave que el borrado de uno: si ya se preguntó por alguien, no se repite.
  const vistas = useQueries({
    queries: members.map((member) => ({
      queryKey: ['team', 'borrado', member.id],
      queryFn: () => previewDeleteEmployee(member.id),
      staleTime: 0,
    })),
  });

  const recuentos = vistas.map((vista) => vista.data?.recuento);
  const todasListas = recuentos.every((r) => r !== undefined);
  const algunError = vistas.some((vista) => vista.error !== null);
  const total = (clave: keyof RecuentoDeBorrado) =>
    recuentos.reduce((suma, r) => suma + (r?.[clave] ?? 0), 0);

  const coincide = escrito.trim().toLocaleUpperCase() === palabra.toLocaleUpperCase();
  const borrando = progreso !== null;

  return (
    <AdminSheet
      visible
      title={t('team.deleteManyTitle', { count: members.length })}
      onClose={borrando ? () => undefined : onClose}
      testID="team-delete-many-sheet"
      footer={
        <Stack gap={spacing.sm}>
          {/*
            EL AVANCE VA ENCIMA DEL BOTÓN Y NO EN ÉL: cargando, el botón enseña la rueda y
            no su texto, así que «Eliminando 3 de 6» ahí no se leería nunca.
          */}
          {borrando ? (
            <AppText variant="bodyStrong" tabular testID="team-delete-many-progress">
              {t('team.deleteManyProgress', { done: progreso, total: members.length })}
            </AppText>
          ) : null}
          <DangerButton
            label={t('team.deleteManyGo', { count: members.length })}
            onPress={onConfirm}
            disabled={!coincide || !todasListas || borrando}
            loading={borrando}
            testID="team-delete-many-confirm"
          />
          <SecondaryButton
            label={t('common.cancel')}
            onPress={onClose}
            disabled={borrando}
            testID="team-delete-many-cancel"
          />
        </Stack>
      }
    >
      <AppText variant="body">{t('team.deleteManyBody')}</AppText>

      {/* QUIÉN, CON NOMBRE Y APELLIDO: es lo que se revisa antes de escribir la palabra. */}
      <Stack gap={0} testID="team-delete-many-list">
        {members.map((member, i) => {
          const r = recuentos[i];
          return (
            <View key={member.id}>
              {i > 0 ? <SeparadorDeRegistro /> : null}
              <Stack gap={0} style={{ paddingVertical: spacing.sm }}>
                <AppText variant="bodyStrong">{member.full_name}</AppText>
                <AppText variant="help" tone="muted" tabular>
                  {r === undefined
                    ? t('team.deleteManyCounting')
                    : t('team.deleteManyEach', {
                        sessions: r.jornadas,
                        events: r.fichajes,
                        shifts: r.turnos,
                      })}
                </AppText>
              </Stack>
            </View>
          );
        })}
      </Stack>

      {todasListas ? (
        <Stack gap={spacing.xs} testID="team-delete-many-totals">
          <AppText variant="bodyStrong">{t('team.deleteWillRemove')}</AppText>
          <KeyValueRow label={t('team.deleteSessions')} value={String(total('jornadas'))} />
          <KeyValueRow label={t('team.deleteEvents')} value={String(total('fichajes'))} />
          <KeyValueRow label={t('team.deleteShifts')} value={String(total('turnos'))} />
          <KeyValueRow label={t('team.deleteRestDays')} value={String(total('descansosLibres'))} />
          <KeyValueRow label={t('team.deleteRequests')} value={String(total('solicitudes'))} />
        </Stack>
      ) : null}

      {algunError ? (
        <InlineNotice tone="late" icon="alert-circle" title={t('team.deleteManyPreviewFailed')} />
      ) : null}

      <FormField
        label={t('team.deleteManyType', { word: palabra })}
        value={escrito}
        onChangeText={setEscrito}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={palabra}
        testID="team-delete-many-word"
      />

      {fallidos.length === 0 ? null : (
        <InlineNotice
          tone="late"
          icon="alert-circle"
          title={t('team.deleteFailed')}
          body={t('team.deleteManyFailed', { names: fallidos.join(', ') })}
          testID="team-delete-many-failed"
        />
      )}
    </AdminSheet>
  );
}
