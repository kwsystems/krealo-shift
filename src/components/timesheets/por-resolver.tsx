import { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AdminSheet, SegmentedControl } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Row, Stack } from '@/components/ui/layout';
import { useResponsive } from '@/hooks/use-responsive';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, radii, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { minutesToHHmm } from '@/utils/time';

/**
 * «POR RESOLVER», arriba de Horas: los casos de la semana con su arreglo a un toque
 * (Andree, 1-oct: «debería haber algo donde se vean mejor todos estos casos y yo poder
 * arreglarlos rápidamente»). Qué es cada caso, en `features/timesheets/casos.ts`.
 *
 * CADA FILA DICE QUÉ PASÓ CON PALABRAS —«Salió a las 12:04 y su turno acababa a las
 * 19:00»— y no con una insignia: «Salida anticipada» no decía cuánto ni qué hacer.
 * El arreglo principal va primero y con forma de botón; la otra salida, al lado; y «Ver
 * jornada» para quien quiera mirar los fichajes antes de decidir.
 *
 * El caso se va de la lista en cuanto se resuelve: lo que queda aquí es lo que falta.
 */

export type AccionDeCaso = {
  etiqueta: string;
  onPress: () => void;
  testID: string;
};

export type FilaPorResolver = {
  id: string;
  nombre: string;
  dia: string;
  que: string;
  detalle: string | null;
  principal: AccionDeCaso;
  alternativa: AccionDeCaso | null;
  onVerJornada: () => void;
  ocupada: boolean;
};

export function PorResolver({
  filas,
  error,
}: {
  filas: readonly FilaPorResolver[];
  error: string | null;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const { density } = useResponsive();
  const ancha = density === 'extraWide';
  if (filas.length === 0 && error === null) return null;

  return (
    <View style={estilos.caja} testID="por-resolver">
      <Stack gap={spacing.md}>
        <Row gap={spacing.sm} align="center">
          <Ionicons name="construct-outline" size={20} color={colors.primary600} />
          <AppText variant="bodyStrong" accessibilityRole="header" style={estilos.crece}>
            {t('timesheet.cases.title', { count: filas.length })}
          </AppText>
        </Row>
        {filas.length > 0 ? (
          <AppText variant="help" tone="muted">
            {t('timesheet.cases.body')}
          </AppText>
        ) : null}
        {error !== null ? (
          <AppText variant="help" tone="danger" testID="por-resolver-error">
            {error}
          </AppText>
        ) : null}

        <Stack gap={0}>
          {filas.map((fila, indice) => (
            <View
              key={fila.id}
              style={[
                estilos.fila,
                ancha ? estilos.filaAncha : null,
                indice > 0 ? estilos.conRegla : null,
              ]}
              testID={`caso-${fila.id}`}
            >
              <Stack gap={spacing.xs} style={ancha ? estilos.textoAncho : undefined}>
                <Row gap={spacing.sm} align="center" wrap>
                  <AppText variant="bodyStrong">{fila.nombre}</AppText>
                  <AppText variant="label" tone="subtle" tabular>
                    {fila.dia}
                  </AppText>
                </Row>
                <AppText variant="body">{fila.que}</AppText>
                {fila.detalle === null ? null : (
                  <AppText variant="label" tone="muted">
                    {fila.detalle}
                  </AppText>
                )}
              </Stack>
              <Row gap={spacing.sm} wrap align="center">
                <SecondaryButton
                  label={fila.principal.etiqueta}
                  onPress={fila.principal.onPress}
                  loading={fila.ocupada}
                  fullWidth={false}
                  testID={fila.principal.testID}
                />
                {fila.alternativa === null ? null : (
                  <GhostButton
                    label={fila.alternativa.etiqueta}
                    onPress={fila.alternativa.onPress}
                    fullWidth={false}
                    testID={fila.alternativa.testID}
                  />
                )}
                <GhostButton
                  label={t('timesheet.cases.openSession')}
                  onPress={fila.onVerJornada}
                  fullWidth={false}
                  testID={`caso-${fila.id}-jornada`}
                />
              </Row>
            </View>
          ))}
        </Stack>
      </Stack>
    </View>
  );
}

/**
 * «LE DEBE» O «ESTÁ JUSTIFICADO»: la decisión de quien trabajó menos que su turno. Las
 * horas vienen calculadas —lo planificado menos lo trabajado— y se pueden cambiar; la nota
 * es opcional y la persona la ve junto a sus horas («Se enfermó»).
 */
export function ResolverFaltaSheet({
  nombre,
  faltan,
  faltanLegible,
  decisionInicial,
  guardando,
  error,
  onGuardar,
  onClose,
}: {
  nombre: string;
  faltan: number;
  /** «3 h 19 min»: como lo dice la fila del caso, no «03:19». */
  faltanLegible: string;
  decisionInicial: 'debe' | 'justificado';
  guardando: boolean;
  error: string | null;
  onGuardar: (params: { decision: 'debe' | 'justificado'; minutos: number; nota: string }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [decision, setDecision] = useState(decisionInicial);
  const [horas, setHoras] = useState(minutesToHHmm(faltan));
  const [nota, setNota] = useState('');
  const minutos = leerHoras(horas);
  const valido = decision === 'justificado' || (minutos !== null && minutos > 0);

  return (
    <AdminSheet
      visible
      title={t('timesheet.cases.shortTitle', { name: nombre })}
      onClose={onClose}
      testID="caso-falta-sheet"
      footer={
        <PrimaryButton
          label={
            decision === 'debe'
              ? t('timesheet.cases.saveOwed', { hours: horas })
              : t('timesheet.cases.saveJustified')
          }
          onPress={() => {
            if (!valido) return;
            onGuardar({ decision, minutos: minutos ?? 0, nota: nota.trim() });
          }}
          disabled={!valido}
          loading={guardando}
          testID="caso-falta-guardar"
        />
      }
    >
      <AppText variant="body">{t('timesheet.cases.shortBody', { hours: faltanLegible })}</AppText>
      <SegmentedControl
        label={t('timesheet.cases.decision')}
        value={decision}
        options={[
          { value: 'debe', label: t('timesheet.cases.owes') },
          { value: 'justificado', label: t('timesheet.cases.justified') },
        ]}
        onChange={setDecision}
        testID="caso-falta-decision"
      />
      {decision === 'debe' ? (
        <FormField
          label={t('timesheet.cases.owedHours')}
          value={horas}
          onChangeText={setHoras}
          keyboardType="numbers-and-punctuation"
          error={minutos === null ? t('schedule.invalidTime') : undefined}
          testID="caso-falta-horas"
        />
      ) : null}
      <FormField
        label={t('timesheet.cases.note')}
        value={nota}
        onChangeText={setNota}
        placeholder={t('timesheet.cases.notePlaceholder')}
        testID="caso-falta-nota"
      />
      <AppText variant="help" tone="subtle">
        {decision === 'debe' ? t('timesheet.cases.owesHint') : t('timesheet.cases.justifiedHint')}
      </AppText>
      {error !== null ? (
        <AppText variant="help" tone="danger">
          {error}
        </AppText>
      ) : null}
    </AdminSheet>
  );
}

/** «Otra hora» para la salida de quien no la marcó: el día ya lo dice el caso. */
export function OtraSalidaSheet({
  nombre,
  dia,
  horaInicial,
  guardando,
  error,
  onGuardar,
  onClose,
}: {
  nombre: string;
  dia: string;
  horaInicial: string;
  guardando: boolean;
  error: string | null;
  onGuardar: (hora: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [hora, setHora] = useState(horaInicial);
  const valida = /^([01]?\d|2[0-3]):[0-5]\d$/.test(hora.trim());
  return (
    <AdminSheet
      visible
      title={t('timesheet.cases.clockOutTitle', { name: nombre })}
      onClose={onClose}
      testID="caso-salida-sheet"
      footer={
        <PrimaryButton
          label={t('timesheet.cases.clockOutAt', { time: hora.trim() })}
          onPress={() => {
            if (valida) onGuardar(hora.trim());
          }}
          disabled={!valida}
          loading={guardando}
          testID="caso-salida-guardar"
        />
      }
    >
      <AppText variant="body">{t('timesheet.cases.clockOutBody', { day: dia })}</AppText>
      <FormField
        label={t('timesheet.cases.clockOutTime')}
        value={hora}
        onChangeText={setHora}
        keyboardType="numbers-and-punctuation"
        error={valida ? undefined : t('schedule.invalidTime')}
        testID="caso-salida-hora"
      />
      {error !== null ? (
        <AppText variant="help" tone="danger">
          {error}
        </AppText>
      ) : null}
    </AdminSheet>
  );
}

function leerHoras(texto: string): number | null {
  const limpio = texto.trim();
  const conDosPuntos = /^(\d{1,2}):([0-5]\d)$/.exec(limpio);
  if (conDosPuntos !== null) return Number(conDosPuntos[1]) * 60 + Number(conDosPuntos[2]);
  return null;
}

const useEstilos = estilosDelTema((colors) => ({
  caja: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: borderWidth.focus,
    borderColor: colors.primary200,
    padding: spacing.base,
  },
  crece: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  fila: { paddingVertical: spacing.md, gap: spacing.sm },
  /*
   * EN ANCHO, TEXTO Y BOTONES EN UNA FILA… SI CABEN (3-oct). Con la ventana a 1024 y el
   * menú lateral, la fila mide unos 730 px y los botones se llevaban casi todo: el texto
   * quedaba en 50 px y partía «refrigerio» por la mitad (`responsive:check`). El texto pide
   * al menos 280 px; si no los tiene, los botones bajan a la línea siguiente.
   */
  filaAncha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.base,
    rowGap: spacing.sm,
  },
  textoAncho: { flexGrow: 1, flexShrink: 1, flexBasis: 280, minWidth: 280 },
  conRegla: { borderTopWidth: borderWidth.hairline, borderTopColor: colors.border },
}));
