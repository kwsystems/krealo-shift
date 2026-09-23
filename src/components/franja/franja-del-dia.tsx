import { View, type DimensionValue } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { franjaDelDia, type FranjaDelDia } from '@/domain/franja-del-dia';
import { estilosDelTema } from '@/theme/estilos';
import { radii, sizes, spacing } from '@/theme/tokens';

/**
 * LA FRANJA DEL DÍA, el elemento que esta app tenía que tener y no tenía.
 *
 * Dos capas sobre la misma escala: el CARRIL, que es el turno programado, y el RELLENO,
 * que es lo que de verdad se fichó. Encima, una marca de «ahora».
 *
 * Y se lee sin que nadie lo explique:
 *   · relleno que empieza más adentro que su carril → llegó tarde
 *   · carril sin relleno                            → no vino
 *   · relleno que sobresale del carril              → se quedó de más
 *   · relleno sin carril                            → trabajó sin turno programado
 *
 * Eso mismo, hoy, exige leer dos horas y restarlas mentalmente, y es lo que se mira entre
 * atender a alguien y contestar el teléfono.
 *
 * LA GEOMETRÍA VIVE FUERA (`@/domain/franja-del-dia`) y esto solo la pinta. No es
 * ceremonia: los casos que rompen una barra así son los bordes —una jornada que se sale
 * de la ventana, un turno al que nadie fue, una sesión todavía abierta— y esos se prueban
 * en un fichero de dominio en milisegundos, no montando un navegador.
 *
 * LOS TRES TRAMOS LLEVAN `testID` PROPIO —`-plan`, `-real`, `-ahora`— y no es ceremonia:
 * sin ellos, un arnés solo puede comprobar «hay algo pintado», y eso pasa igual cuando la
 * franja dibuja un carril que cuando dibuja un relleno. El caso que hay que poder
 * afirmar es «esta persona tenía turno y NO hay relleno», o sea plan sin real, y eso
 * exige distinguirlos. Se descubrió al probar el control: con la comprobación floja, dejar
 * la franja sin datos seguía dando verde.
 *
 * EL COLOR NO ES LA ÚNICA SEÑAL. La forma ya dice lo que pasa, y la etiqueta accesible lo
 * dice con palabras: quien no distingue el verde del ámbar, y quien navega con un lector
 * de pantalla, leen lo mismo que quien mira.
 */
export function FranjaDeUnDia({
  ventana,
  turno,
  trabajado,
  ahora,
  estado = 'normal',
  testID,
}: {
  ventana: { desde: Date; hasta: Date };
  turno: { desde: Date; hasta: Date | null } | null;
  trabajado: { desde: Date; hasta: Date | null } | null;
  ahora: Date;
  /** `tarde` tiñe el relleno: es el único caso que pide una mirada. */
  estado?: 'normal' | 'tarde' | 'pausa';
  testID?: string;
}) {
  const estilos = useEstilos();
  const { t } = useTranslation();
  const franja: FranjaDelDia = franjaDelDia({ ventana, turno, trabajado, ahora });

  /*
   * `DimensionValue` y no `string`: React Native tipa los porcentajes como plantilla
   * `${number}%`, así que una cadena suelta no compila aunque diga «42.00%». Se anota una
   * vez aquí en vez de castear en los tres sitios donde se usa.
   */
  const porcentaje = (valor: number): DimensionValue =>
    `${Number((valor * 100).toFixed(2))}%` as DimensionValue;
  const relleno =
    estado === 'tarde'
      ? estilos.rellenoTarde
      : estado === 'pausa'
        ? estilos.rellenoPausa
        : estilos.relleno;

  return (
    <View
      style={estilos.pista}
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={etiquetaAccesible(franja, t)}
    >
      {franja.plan === null ? null : (
        <View
          testID={testID === undefined ? undefined : `${testID}-plan`}
          style={[
            estilos.carril,
            {
              left: porcentaje(franja.plan.desde),
              width: porcentaje(franja.plan.hasta - franja.plan.desde),
            },
          ]}
        />
      )}

      {franja.real === null ? null : (
        <View
          testID={testID === undefined ? undefined : `${testID}-real`}
          style={[
            estilos.trabajado,
            relleno,
            {
              left: porcentaje(franja.real.desde),
              width: porcentaje(franja.real.hasta - franja.real.desde),
            },
          ]}
        />
      )}

      {franja.ahora === null ? null : (
        <View
          testID={testID === undefined ? undefined : `${testID}-ahora`}
          style={[estilos.ahora, { left: porcentaje(franja.ahora) }]}
        />
      )}
    </View>
  );
}

/**
 * Lo que la franja dice, en palabras.
 *
 * No es una traducción literal de los rectángulos: es la MISMA conclusión a la que llega
 * quien la mira. «Sin turno programado» es lo que se ve cuando hay relleno y no hay
 * carril, y es lo que hay que oír.
 */
function etiquetaAccesible(franja: FranjaDelDia, t: (clave: string) => string): string {
  if (franja.plan === null && franja.real === null) return t('band.nothing');
  if (franja.real === null) return t('band.noShow');
  if (franja.plan === null) return t('band.unscheduled');
  return franja.real.desde > franja.plan.desde ? t('band.late') : t('band.onTime');
}

const useEstilos = estilosDelTema((colors) => ({
  /*
   * LA PISTA NO SE PINTA: es el espacio de coordenadas, no un objeto.
   *
   * La primera versión le puso fondo `hundido` y el resultado fue que el carril del turno
   * (`border`) y el fondo quedaban a dos grises casi iguales —#F4F3F8 contra #E5E3EB— así
   * que no se distinguía «aquí había turno» de «aquí no hay nada», que es la mitad de lo
   * que la franja tiene que decir. Se vio en la captura, no leyendo el código.
   *
   * Sin fondo, lo único que se pinta es lo que significa algo: el carril, el relleno y la
   * marca de ahora.
   */
  pista: {
    height: sizes.franjaAlto,
    justifyContent: 'center',
  },
  /*
   * EL CARRIL ES EL PLAN, y va apagado a propósito: es la referencia contra la que se lee
   * lo demás, no protagonista. Si pesara igual que el relleno, la franja diría dos cosas
   * a la vez y no se entendería ninguna.
   */
  carril: {
    position: 'absolute',
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.border,
  },
  trabajado: {
    position: 'absolute',
    height: '100%',
    borderRadius: radii.pill,
  },
  relleno: { backgroundColor: colors.success600 },
  rellenoTarde: { backgroundColor: colors.warning600 },
  rellenoPausa: { backgroundColor: colors.info600 },
  /*
   * "AHORA" ES UNA LÍNEA FINA Y OSCURA, no un punto de color: tiene que leerse encima del
   * relleno y encima del carril sin competir con ninguno de los dos, y en los dos temas.
   */
  ahora: {
    position: 'absolute',
    width: 2,
    height: '100%',
    backgroundColor: colors.ink900,
  },
}));

/** Una fila de la franja: quién, su forma del día, y la hora que hace falta leer. */
export function FilaDeFranja({
  nombre,
  detalle,
  children,
  testID,
}: {
  nombre: string;
  detalle?: string;
  children: React.ReactNode;
  testID?: string;
}) {
  const estilos = useEstilosDeFila();
  return (
    <View style={estilos.fila} testID={testID}>
      <View style={estilos.quien}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {nombre}
        </AppText>
        {detalle === undefined ? null : (
          <AppText variant="help" tone="subtle" tabular numberOfLines={1}>
            {detalle}
          </AppText>
        )}
      </View>
      <View style={estilos.franja}>{children}</View>
    </View>
  );
}

const useEstilosDeFila = estilosDelTema(() => ({
  fila: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  /*
   * EL NOMBRE NO CRECE Y LA FRANJA SÍ. Al revés, cada fila tendría su franja empezando en
   * una columna distinta según lo largo que fuera el nombre, y comparar dos días —que es
   * para lo que existe esto— dejaría de ser posible de un vistazo.
   */
  quien: { width: 160, flexShrink: 0 },
  franja: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
}));
