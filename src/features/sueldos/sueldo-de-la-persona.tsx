import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SegmentedControl } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Card, Row, Stack } from '@/components/ui/layout';
import { RMV, vigenteEn } from '@/domain/ley-laboral-peru';
import type { SistemaDePension } from '@/domain/sueldo-estimado';
import { dateKeyOf } from '@/features/schedules/week';
import type { TeamMember } from '@/features/team/hooks';
import { useManagerScope } from '@/hooks/use-manager-scope';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';

import { useGuardarSueldo, useSueldoDelMes } from './hooks';
import { montoEscrito } from './monto-escrito';
import { SelectorDelMes, soles, TarjetaDelSueldo } from './tarjeta-del-sueldo';

/**
 * EL SUELDO EN LA FICHA DE EQUIPO (13-oct): lo que va a cobrar este mes, con el mismo
 * desglose que ve la persona en su celular, y el sitio donde se pone su sueldo. Solo para el
 * dueño o un administrador: un gerente de sede no ve sueldos (las reglas tampoco le dejan).
 */
export function SueldoDeLaPersona({
  organizationId,
  member,
  timezone,
  nowISO,
  language,
}: {
  organizationId: string | null;
  member: TeamMember;
  timezone: string;
  nowISO: string;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const [mesesAtras, setMesesAtras] = useState(0);
  const sueldo = useSueldoDelMes({
    organizationId: scope.isAdmin ? organizationId : null,
    employeeId: scope.isAdmin ? member.id : null,
    timezone,
    nowISO,
    ingreso: member.hire_date,
    baja: member.end_date,
    mesesAtras,
  });
  const [editando, setEditando] = useState(false);
  if (!scope.isAdmin) return null;

  const guardado = sueldo.estado === 'listo' ? sueldo.sueldo : null;
  return (
    <Stack gap={spacing.sm} testID="sueldo-de-la-persona">
      <AppText variant="bodyStrong">{t('pay.section')}</AppText>
      {editando ? (
        <FormularioDelSueldo
          employeeId={member.id}
          inicial={guardado}
          rmv={vigenteEn(RMV, dateKeyOf(nowISO, timezone)).valor}
          onListo={() => setEditando(false)}
        />
      ) : sueldo.estado === 'sinSueldo' ? (
        <Card>
          <Stack gap={spacing.sm}>
            <AppText variant="help" tone="muted">
              {t('pay.none')}
            </AppText>
            <SecondaryButton
              label={t('pay.set')}
              onPress={() => setEditando(true)}
              fullWidth={false}
              testID="sueldo-poner"
            />
          </Stack>
        </Card>
      ) : (
        <Stack gap={spacing.sm}>
          <SelectorDelMes mesesAtras={mesesAtras} onChange={setMesesAtras} />
          <TarjetaDelSueldo
            sueldo={sueldo}
            propia={false}
            language={language}
            hoy={dateKeyOf(nowISO, timezone)}
          />
          {sueldo.estado === 'listo' ? (
            <SecondaryButton
              label={t('pay.change')}
              onPress={() => setEditando(true)}
              fullWidth={false}
              testID="sueldo-cambiar"
            />
          ) : null}
        </Stack>
      )}
    </Stack>
  );
}

function FormularioDelSueldo({
  employeeId,
  inicial,
  rmv,
  onListo,
}: {
  employeeId: string;
  inicial: {
    monthly_salary: number;
    family_allowance: boolean;
    pension: SistemaDePension | null;
  } | null;
  rmv: number;
  onListo: () => void;
}) {
  const { t } = useTranslation();
  const guardar = useGuardarSueldo();
  const [monto, setMonto] = useState(inicial === null ? '' : String(inicial.monthly_salary));
  const [asignacion, setAsignacion] = useState<'si' | 'no'>(
    inicial?.family_allowance === true ? 'si' : 'no',
  );
  const [pension, setPension] = useState<SistemaDePension | 'nose'>(inicial?.pension ?? 'nose');
  const [intentado, setIntentado] = useState(false);

  const leido = montoEscrito(monto);
  const porQueNo = leido === null ? t('pay.invalidAmount') : null;

  /*
   * GUARDAR Y QUITAR SON DOS COSAS. `null` es «quitar sueldo» en el servidor: un monto mal
   * escrito no puede llegar como `null`, o «Guardar» con «mil» borraba el sueldo. Lo cazó
   * `sueldo-check` el mismo día.
   */
  const enviar = (accion: 'guardar' | 'quitar') => {
    setIntentado(true);
    if (accion === 'guardar' && leido === null) return;
    guardar.mutate(
      {
        employeeId,
        sueldoMensual: accion === 'quitar' ? null : leido,
        asignacionFamiliar: asignacion === 'si',
        pension: pension === 'nose' ? null : pension,
      },
      { onSuccess: onListo },
    );
  };

  return (
    <Card testID="sueldo-formulario">
      <Stack gap={spacing.md}>
        <FormField
          label={t('pay.amountLabel')}
          value={monto}
          onChangeText={setMonto}
          keyboardType="decimal-pad"
          placeholder="1500"
          testID="sueldo-monto"
        />
        {leido !== null ? (
          <AppText variant="label" tone="primary" tabular testID="sueldo-monto-se-guarda">
            {t('pay.savedAs', { amount: soles(leido) })}
          </AppText>
        ) : null}
        {leido !== null && leido < rmv ? (
          <AppText variant="help" tone="danger" testID="sueldo-monto-menor-rmv">
            {t('pay.belowMinimum', { rmv: soles(rmv) })}
          </AppText>
        ) : null}
        <SegmentedControl<'si' | 'no'>
          label={t('pay.familyAllowanceLabel')}
          rotuloVisible
          value={asignacion}
          onChange={setAsignacion}
          options={[
            { value: 'no', label: t('pay.no') },
            { value: 'si', label: t('pay.yes') },
          ]}
          testID="sueldo-asignacion"
        />
        <SegmentedControl<SistemaDePension | 'nose'>
          label={t('pay.pensionLabel')}
          rotuloVisible
          value={pension}
          onChange={setPension}
          options={[
            { value: 'onp', label: 'ONP' },
            { value: 'afp', label: 'AFP' },
            { value: 'nose', label: t('pay.pensionUnknown') },
          ]}
          testID="sueldo-pension"
        />
        <AppText variant="help" tone="subtle">
          {t('pay.privacy')}
        </AppText>
        {intentado && porQueNo !== null ? (
          <AppText variant="help" tone="danger" testID="sueldo-por-que-no">
            {porQueNo}
          </AppText>
        ) : null}
        {guardar.isError ? (
          <AppText variant="help" tone="danger" testID="sueldo-error-al-guardar">
            {t('pay.saveFailed')}
          </AppText>
        ) : null}
        <Row gap={spacing.sm} wrap align="center">
          <PrimaryButton
            label={t('pay.save')}
            onPress={() => enviar('guardar')}
            loading={guardar.isPending}
            fullWidth={false}
            testID="sueldo-guardar"
          />
          {inicial !== null ? (
            <GhostButton
              label={t('pay.remove')}
              onPress={() => enviar('quitar')}
              fullWidth={false}
              testID="sueldo-quitar"
            />
          ) : null}
          <GhostButton label={t('common.cancel')} onPress={onListo} fullWidth={false} />
        </Row>
      </Stack>
    </Card>
  );
}
