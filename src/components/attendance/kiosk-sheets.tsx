import { useState } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { NumericKeypad, PinDots } from './pin-pad';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import type { BreakReason } from '@/domain/break-reason';
import { breakReasonLabels } from '@/i18n/break-reason-labels';
import { radii, shadows, sizes, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme } from '@/theme/use-theme';

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
  const styles = useEstilos();
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

/** Tope de la nota. El mismo que la restricción de la base, que rechazaría el evento. */
const NOTA_MAXIMA = 500;

/**
 * «Otro», ¿otro qué?
 *
 * La única pantalla de la app donde se le pide a alguien que ESCRIBA mientras ficha, así
 * que todo aquí está puesto para que cueste lo mínimo:
 *
 *   - se abre con el teclado ya levantado (`autoFocus`): el toque que hace falta para
 *     levantarlo es un toque que no debería hacer falta;
 *   - el botón de seguir está APAGADO hasta que hay algo escrito, y dice por qué, en vez
 *     de dejar pulsar y contestar con un error después;
 *   - una línea basta y así lo dice. Pedir «describe el motivo» invita a un párrafo que
 *     nadie va a escribir con gente esperando detrás;
 *   - se puede volver a los motivos, por si eligió «Otro» y luego vio que sí era una
 *     comida. Volver NO lleva a la pantalla del PIN: teclear seis dígitos otra vez es la
 *     clase de castigo que enseña a poner «comida» para todo.
 *
 * NO HAY FORMA DE SALTÁRSELA, y esa es la única razón por la que existe: «Otro» es la
 * opción que menos cuesta elegir, así que sin nada que la frene acaba siendo el cajón
 * donde cae la mitad de los registros, y entonces el reporte de «en qué se va el tiempo
 * que no se trabaja» no responde nada. El servidor la exige también, porque el kiosco no
 * es la única vía: ver `20260915000200_nota_de_pausa.sql`.
 */
export function BreakNoteSheet({
  visible,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const styles = useEstilos();
  const { t } = useTranslation();
  const [texto, setTexto] = useState('');

  const limpio = texto.trim();
  const listo = limpio.length > 0;

  const enviar = () => {
    if (!listo) return;
    setTexto('');
    onSubmit(limpio);
  };

  const cancelar = () => {
    setTexto('');
    onCancel();
  };

  return (
    <Sheet visible={visible} onClose={cancelar} testID="break-note-sheet">
      <Stack gap={spacing.md}>
        <AppText variant="section">{t('kiosk.reasonNoteTitle')}</AppText>
        <AppText variant="help" tone="muted">
          {t('kiosk.reasonNoteHint')}
        </AppText>
        <TextInput
          value={texto}
          onChangeText={setTexto}
          autoFocus
          // Una línea, y que el teclado ofrezca «listo» en vez de salto de línea: es
          // exactamente lo que hay que hacer aquí, y ahorra buscar el botón.
          returnKeyType="done"
          onSubmitEditing={enviar}
          maxLength={NOTA_MAXIMA}
          placeholder={t('kiosk.reasonNotePlaceholder')}
          placeholderTextColor={colors.ink500}
          style={styles.notaEntrada}
          accessibilityLabel={t('kiosk.reasonNoteTitle')}
          testID="break-note-input"
        />
        <PrimaryButton
          label={t('common.continue')}
          hint={listo ? undefined : t('kiosk.reasonNoteRequired')}
          onPress={enviar}
          disabled={!listo}
          size="kiosk"
          testID="break-note-submit"
        />
        <GhostButton label={t('common.back')} onPress={cancelar} testID="break-note-cancel" />
      </Stack>
    </Sheet>
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

  const labels = breakReasonLabels(t);

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
  const { colors } = useTheme();
  const styles = useEstilos();
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
  const styles = useEstilos();
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
  const { colors } = useTheme();
  const styles = useEstilos();
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

const useEstilos = estilosDelTema((colors) => ({
  // Alto de objetivo táctil de kiosco y texto grande: se escribe de pie, a un brazo de
  // distancia y a veces con la pantalla sucia.
  notaEntrada: {
    minHeight: sizes.buttonKiosk,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    fontSize: 20,
    color: colors.ink900,
    backgroundColor: colors.surface,
  },
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
}));
