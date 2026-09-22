import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AsyncSection } from '@/components/schedule/data-states';
import { FormCard, InlineNotice, KeyValueRow } from '@/components/schedule/fields';
import { FormField } from '@/components/ui/form-field';
import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import { TemporaryPinSheet } from '@/features/team/employee-detail';
import { useEmployees, useTeamMutations } from '@/features/team/hooks';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { spacing } from '@/theme/tokens';

/**
 * El PIN con el que cada persona ficha en el reloj.
 *
 * ESTO YA EXISTÍA, PERO SOLO DENTRO DE LA FICHA DE CADA EMPLEADO. Reiniciar el PIN de
 * alguien pedía ir a Equipo, filtrar, abrir su ficha y bajar hasta el pie. Es la
 * operación más repetida de la administración diaria —alguien lo olvida, alguien entra
 * nuevo— y estaba a cuatro pasos de distancia en una pantalla que no habla de PIN.
 *
 * NO SUSTITUYE AL DE LA FICHA, se suma. No es duplicar: son dos necesidades distintas.
 * En la ficha llegas ya mirando a esa persona; aquí llegas sabiendo solo que «a alguien
 * hay que reiniciarle el PIN». El control tiene que estar donde nace cada una.
 */

/** Cuántas coincidencias se enseñan. Más que esto y la búsqueda no está acotando nada. */
const MAXIMO_COINCIDENCIAS = 8;

export function PinsCard() {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const organizationId = scope.organization?.id ?? null;

  const employees = useEmployees(organizationId);
  const { resetPin } = useTeamMutations(organizationId);

  const [busqueda, setBusqueda] = useState('');
  const [pin, setPin] = useState<{ valor: string; nombre: string } | null>(null);

  const termino = busqueda.trim().toLowerCase();

  /**
   * NO SE LISTA A NADIE HASTA QUE SE BUSCA, y es deliberado. Una tienda puede tener
   * doscientos empleados: una lista entera con un botón de reiniciar PIN al lado de
   * cada nombre es un campo de minas, y encima obliga a buscar con el ojo lo que el
   * teclado hace mejor.
   */
  const coincidencias = useMemo(() => {
    if (termino === '') return [];
    return (employees.data ?? [])
      .filter((persona) => {
        const numero = persona.employee_number ?? '';
        return (
          persona.full_name.toLowerCase().includes(termino) ||
          numero.toLowerCase().includes(termino)
        );
      })
      .slice(0, MAXIMO_COINCIDENCIAS);
  }, [employees.data, termino]);

  /*
   * SOLO PARA ENSEÑARLA. Antes esta longitud se le pasaba al generador, y ahí estaba el
   * fallo: es la de la sede que el gerente tenga SELECCIONADA, que no tiene por qué ser
   * la de la persona a la que se le reinicia el PIN. Ahora el PIN lo sortea el servidor,
   * que sí sabe cuál es la sede de esa persona.
   *
   * `scope.settings` y no `scope.location?.settings` porque el alcance ya cae a
   * `DEFAULT_LOCATION_SETTINGS` cuando la sede no trae ajustes: aquí nunca hay `null`.
   */
  const longitud = scope.settings.pinLength;

  if (!scope.isAdmin) {
    return (
      <FormCard collapsible title={t('settings.pins')} description={t('settings.pinsHint')}>
        <InlineNotice
          tone="info"
          icon="lock-closed-outline"
          title={t('settings.onlyAdminTitle')}
          body={t('settings.pinsOnlyAdmin')}
        />
      </FormCard>
    );
  }

  return (
    <FormCard
      collapsible
      title={t('settings.pins')}
      description={t('settings.pinsHint')}
      testID="pins-card"
    >
      <Stack gap={spacing.lg}>
        {/*
          LA LONGITUD SE ENSEÑA Y NO SE EDITA, y el aviso de al lado explica por qué. No
          es una carencia del panel: bajarla de 6 a 4 dejaría fuera a la tienda entera de
          golpe, porque los PIN guardados son hashes de seis dígitos y el teclado
          validaría al cuarto. Nadie podría volver a fichar hasta que un administrador le
          pusiera un PIN nuevo a cada persona, una por una.

          Enseñarla igualmente importa: es el dato que hace falta para decirle a alguien
          por teléfono cuántos dígitos tiene que teclear.
        */}
        <Stack gap={spacing.xs}>
          <KeyValueRow
            label={t('settings.pinLengthLabel', { location: scope.location?.name ?? '' })}
            value={String(longitud)}
            testID="pin-length"
          />
          <AppText variant="help" tone="subtle">
            {t('settings.pinLengthFixed')}
          </AppText>
        </Stack>

        <AsyncSection
          isPending={employees.isPending}
          error={employees.error}
          isEmpty={false}
          onRetry={() => void employees.refetch()}
        >
          <Stack gap={spacing.sm}>
            <FormField
              label={t('settings.pinSearch')}
              placeholder={t('team.searchPlaceholder')}
              value={busqueda}
              onChangeText={setBusqueda}
              autoCapitalize="none"
              autoCorrect={false}
              testID="pin-search"
            />

            {termino === '' ? (
              <AppText variant="help" tone="subtle">
                {t('settings.pinTypeToSearch')}
              </AppText>
            ) : coincidencias.length === 0 ? (
              <AppText variant="help" tone="subtle">
                {t('settings.pinNoMatches')}
              </AppText>
            ) : (
              coincidencias.map((persona) => (
                <Card key={persona.id} testID={`pin-row-${persona.id}`}>
                  <Row justify="space-between" gap={spacing.md} align="center" wrap>
                    <Stack gap={2}>
                      <AppText variant="bodyStrong">
                        {persona.full_name === '' ? t('team.unknownEmployee') : persona.full_name}
                      </AppText>
                      {persona.employee_number === null ? null : (
                        <AppText variant="help" tone="subtle">
                          {t('team.employeeNumber')}: {persona.employee_number}
                        </AppText>
                      )}
                    </Stack>
                    {/*
                      FANTASMA, por lo mismo que «Quitar acceso» en la tarjeta de al
                      lado: lo primero que se ve de cada fila tiene que ser quién es, no
                      la forma de romperle el acceso al reloj.
                    */}
                    <GhostButton
                      label={t('team.resetPin')}
                      onPress={() =>
                        resetPin.mutate(
                          { employeeId: persona.id },
                          {
                            onSuccess: (nuevo) =>
                              setPin({ valor: nuevo, nombre: persona.full_name }),
                          },
                        )
                      }
                      disabled={resetPin.isPending}
                      fullWidth={false}
                      testID={`pin-reset-${persona.id}`}
                    />
                  </Row>
                </Card>
              ))
            )}

            {resetPin.error === null || resetPin.error === undefined ? null : (
              <InlineNotice
                tone="late"
                icon="alert-circle"
                title={t('settings.pinResetFailed')}
                body={resetPin.error instanceof Error ? resetPin.error.message : undefined}
              />
            )}
          </Stack>
        </AsyncSection>
      </Stack>

      {pin === null ? null : (
        <TemporaryPinSheet pin={pin.valor} employeeName={pin.nombre} onClose={() => setPin(null)} />
      )}
    </FormCard>
  );
}
