import { useTranslation } from 'react-i18next';

import { StatTile } from '@/components/schedule/fields';

import { resumirCorrecciones, type FilaDeCorreccion } from './correcciones';

const TIPOS = [
  'fichaje_anadido',
  'hora_corregida',
  'salida_a_pausa',
  'solicitud_aprobada',
  'salida_automatica',
] as const;

/**
 * LAS CORRECCIONES DE HORA DEL PERIODO, en una casilla de Reportes (30-sep).
 *
 * Lo pide la lista de la semana de prueba —«cuántas hubo y de qué tipo»— y no estaba en
 * ningún sitio: cada una es un fichaje que el reloj no recogió bien. Sin tono de alarma:
 * corregir es lo que tiene que pasar cuando algo se escapa, y pintarlo de rojo invitaría a
 * no corregir. Lo registrado desde el horario va aparte, en su línea: no es un fallo del
 * reloj, son días de antes de él.
 */
export function CasillaDeCorrecciones({
  consulta,
  personaId,
}: {
  consulta: { data?: FilaDeCorreccion[]; isPending: boolean; error: unknown };
  personaId: string | null;
}) {
  const { t } = useTranslation();
  const resumen = resumirCorrecciones(consulta.data ?? [], personaId);
  const hayDato = !consulta.isPending && consulta.error === null;

  const partes = TIPOS.filter((tipo) => resumen.porTipo[tipo] > 0).map((tipo) =>
    t(`reports.correctionsType.${tipo}`, { count: resumen.porTipo[tipo] }),
  );
  const detalle = consulta.isPending
    ? t('reports.correctionsLoading')
    : consulta.error !== null
      ? t('reports.correctionsUnavailable')
      : [
          resumen.total === 0 ? t('reports.correctionsNone') : partes.join(' · '),
          resumen.segunHorario > 0
            ? t('reports.correctionsFromSchedule', { count: resumen.segunHorario })
            : null,
          resumen.cumplidosEspeciales > 0
            ? t('reports.correctionsCredited', { count: resumen.cumplidosEspeciales })
            : null,
        ]
          .filter((parte): parte is string => parte !== null)
          .join(' ');

  return (
    <StatTile
      label={t('reports.corrections')}
      value={hayDato ? String(resumen.total) : '—'}
      detalle={detalle}
      icon="create-outline"
      testID="report-corrections"
    />
  );
}
