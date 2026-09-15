import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { NumericKeypad, PinDots } from './pin-pad';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import type { BreakReason } from '@/domain/break-reason';
import { colors, radii, shadows, sizes, spacing } from '@/theme/tokens';

/**
 * Hojas inferiores del kiosco (§9.3, §12).
 *
 * Cada una existe para evitar un error concreto y costoso:
 *   - `BreakTypeSheet`: elegir mal el tipo de descanso cambia si esos minutos se
 *     pagan o no, así que se pregunta en vez de asumir;
 *   - `RequiredBreakSheet`: al salir sin el descanso obligatorio, la app NUNCA
 *     inventa el descanso. Pregunta y crea una solicitud auditable (§12);
 *   - `ManagerOverrideSheet`: la excepción de entrada temprana necesita el PIN de
 *     un gerente y queda en auditoría, no es un botón que cualquiera pulsa.
 */

/**
 * Ya no existe `BreakTypeOption`: el kiosco pregunta el MOTIVO, no el tratamiento de
 * nómina. Ver `src/domain/break-reason.ts`.
 */

function Sheet({
  visible,
  onClose,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tocar el fondo cierra, pero la hoja no se cierra sola: una acción de
            fichaje a medias no debe desaparecer por un roce accidental. */}
        <Pressable style={styles.backdropTouchable} onPress={onClose} accessibilityLabel="" />
        <View style={styles.sheet} testID={testID}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Elegir POR QUÉ te ausentas, no si te lo pagan.
 *
 * ANTES ESTA HOJA PREGUNTABA OTRA COSA: «¿qué descanso vas a tomar?», con las opciones
 * «Descanso pagado», «Descanso no pagado», «Comida» y «Otro». Le estaba pidiendo al
 * empleado que decidiera una cuestión de nómina que ni sabe ni le corresponde, delante
 * de una cola, en cinco segundos. Y encima no registraba el dato que el negocio
 * necesita, que es a dónde se fue ese rato.
 *
 * Ahora elige el motivo, que es una pregunta que cualquiera contesta sin pensar, y la
 * app traduce a pagado o no pagado según lo que la empresa haya configurado para esta
 * ubicación. La consecuencia de nómina se muestra debajo de cada opción —tiene derecho
 * a saber qué implica lo que elige— pero no es lo que se le pide decidir.
 */
export function BreakReasonSheet({
  visible,
  options,
  esPagado,
  onSelect,
  onCancel,
}: {
  visible: boolean;
  options: readonly BreakReason[];
  /** Si ese motivo cuenta como trabajado en esta ubicación. */
  esPagado: (reason: BreakReason) => boolean;
  onSelect: (reason: BreakReason) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  const labels: Record<BreakReason, string> = {
    meal: t('kiosk.reasonMeal'),
    rest: t('kiosk.reasonRest'),
    permit: t('kiosk.reasonPermit'),
    meeting: t('kiosk.reasonMeeting'),
    training: t('kiosk.reasonTraining'),
    other: t('kiosk.reasonOther'),
  };

  return (
    <Sheet visible={visible} onClose={onCancel} testID="break-reason-sheet">
      <Stack gap={spacing.md}>
        <AppText variant="section">{t('kiosk.chooseBreakReason')}</AppText>
        {options.map((reason) => (
          <SecondaryButton
            key={reason}
            label={labels[reason]}
            hint={esPagado(reason) ? t('kiosk.reasonCountsAsWork') : t('kiosk.reasonDoesNotCount')}
            onPress={() => onSelect(reason)}
            size="kiosk"
            testID={`break-reason-${reason}`}
          />
        ))}
        <GhostButton label={t('common.cancel')} onPress={onCancel} />
      </Stack>
    </Sheet>
  );
}

export type RequiredBreakChoice = 'took_it' | 'did_not_take' | 'cancel';

export function RequiredBreakSheet({
  visible,
  requiredMinutes,
  onChoose,
}: {
  visible: boolean;
  requiredMinutes: number;
  onChoose: (choice: RequiredBreakChoice) => void;
}) {
  const { t } = useTranslation();

  return (
    <Sheet visible={visible} onClose={() => onChoose('cancel')} testID="required-break-sheet">
      <Stack gap={spacing.md}>
        <Row gap={spacing.sm} align="flex-start">
          <Ionicons name="cafe-outline" size={sizes.iconKiosk} color={colors.warning600} />
          <Stack gap={spacing.xs} style={styles.flexOne}>
            <AppText variant="section">{t('kiosk.requiredBreakMissingTitle')}</AppText>
            <AppText variant="help" tone="subtle">
              {t('common.minutes', { count: requiredMinutes })}
            </AppText>
          </Stack>
        </Row>

        {/* Primero la opción honesta más probable, no la que cierra más rápido. */}
        <SecondaryButton
          label={t('kiosk.requiredBreakTookIt')}
          onPress={() => onChoose('took_it')}
          size="kiosk"
          testID="required-break-took-it"
        />
        <SecondaryButton
          label={t('kiosk.requiredBreakDidNotTake')}
          onPress={() => onChoose('did_not_take')}
          testID="required-break-did-not-take"
        />
        <GhostButton label={t('common.cancel')} onPress={() => onChoose('cancel')} />
      </Stack>
    </Sheet>
  );
}

export function ManagerOverrideSheet({
  visible,
  pinLength,
  checking,
  error,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  pinLength: number;
  checking: boolean;
  error: string | null;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');

  const append = (digit: string) => {
    if (checking) return;
    const next = pin.length >= pinLength ? pin : pin + digit;
    setPin(next);
    if (next.length === pinLength) {
      onSubmit(next);
      setPin('');
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        setPin('');
        onCancel();
      }}
      testID="manager-override-sheet"
    >
      <Stack gap={spacing.base} style={styles.centered}>
        <AppText variant="section">{t('kiosk.managerOverride')}</AppText>
        <AppText variant="help" tone="subtle" style={styles.centerText}>
          {t('kiosk.exitEnterManagerPin')}
        </AppText>

        <PinDots length={pinLength} entered={pin.length} error={error !== null} />

        {error !== null ? (
          <AppText variant="help" tone="danger" accessibilityRole="alert">
            {error}
          </AppText>
        ) : null}

        <NumericKeypad
          onDigit={append}
          onBackspace={() => setPin((c) => c.slice(0, -1))}
          onClear={() => setPin('')}
          size="mobile"
          disabled={checking}
        />

        <GhostButton
          label={t('common.cancel')}
          onPress={() => {
            setPin('');
            onCancel();
          }}
        />
      </Stack>
    </Sheet>
  );
}

/** Confirmación explícita para una acción destructiva o irreversible (§25). */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Sheet visible={visible} onClose={onCancel} testID="confirm-sheet">
      <Stack gap={spacing.md}>
        <AppText variant="section">{title}</AppText>
        {body !== undefined ? (
          <AppText variant="body" tone="muted">
            {body}
          </AppText>
        ) : null}
        {destructive ? (
          <DangerButton label={confirmLabel} onPress={onConfirm} testID="confirm-sheet-confirm" />
        ) : (
          <PrimaryButton label={confirmLabel} onPress={onConfirm} testID="confirm-sheet-confirm" />
        )}
        <GhostButton label={t('common.cancel')} onPress={onCancel} />
      </Stack>
    </Sheet>
  );
}

/** Aviso de foto: se explica el uso ANTES de tomarla, nunca después (§9.4). */
export function PhotoNotice() {
  const { t } = useTranslation();
  return (
    <Card>
      <Row gap={spacing.sm} align="flex-start">
        <Ionicons name="camera-outline" size={sizes.iconMobile} color={colors.info600} />
        <AppText variant="help" tone="subtle" style={styles.flexOne}>
          {t('kiosk.photoNotice')}
        </AppText>
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(25, 23, 42, 0.35)' },
  backdropTouchable: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    ...shadows.floating,
  },
  flexOne: { flex: 1 },
  centered: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
});
