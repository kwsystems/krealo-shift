import { createContext, useContext } from 'react';
import { View, type DimensionValue } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AnclaDePersona } from '@/components/ui/ancla';
import { AppText } from '@/components/ui/app-text';
import { franjaDelDia, type FranjaDelDia } from '@/domain/franja-del-dia';
import { useResponsive } from '@/hooks/use-responsive';
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
/**
 * «¿Pinta el bloque la línea de AHORA, o la pinta cada fila?»
 *
 * ES UN CONTEXTO Y NO UN PROP porque las dos respuestas tienen que salir de la MISMA
 * decisión. En pantalla ancha la línea cruza el bloque entero; apilado en un teléfono no
 * puede, porque ahí cada fila pone el nombre encima de su franja y una vertical a toda
 * altura pasaría por encima de los nombres. Si eso se decidiera en dos sitios —la pantalla
 * por un lado y la lista por otro— el día que uno cambiara de punto de corte habría dos
 * marcas de «ahora» o ninguna, y ninguna de las dos se notaría hasta mirar.
 *
 * Por defecto `false`: una franja suelta, fuera de una lista, sigue pintando la suya.
 */
const ElBloquePintaAhora = createContext(false);

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
  const loPintaElBloque = useContext(ElBloquePintaAhora);
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

      {franja.ahora === null || loPintaElBloque ? null : (
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
  semilla,
  nombre,
  detalle,
  children,
  testID,
}: {
  /** El IDENTIFICADOR de la persona: el ancla es suya, no de su nombre. */
  semilla: string;
  nombre: string;
  detalle?: string;
  children: React.ReactNode;
  testID?: string;
}) {
  const estilos = useEstilosDeFila();
  /*
   * EN TELÉFONO LA FILA SE APILA, y esto es un fallo que yo mismo metí el día que nació la
   * franja: con la columna del nombre en 160 px fijos y 358 px de ancho útil a 390, a la
   * franja le quedaban 90 px. O sea un muñón de dos centímetros donde tenía que estar la
   * forma del día: la única cosa que esta fila existe para enseñar. Se vio en la captura
   * de teléfono, no leyendo el código.
   *
   * Apilada, el nombre va arriba y la franja debajo a todo lo ancho. Se pierde la
   * comparación entre filas —que era la razón de la columna fija— y se gana poder ver
   * cada día. En un teléfono no cabían las dos cosas.
   */
  const { isCompact } = useResponsive();

  if (isCompact) {
    return (
      <View style={estilos.filaApilada} testID={testID}>
        <View style={estilos.quienApilado}>
          <View style={estilos.nombreApilado}>
            <AnclaDePersona semilla={semilla} nombre={nombre} tamano="sm" />
            <AppText variant="bodyStrong" numberOfLines={1} style={estilos.creceYEncoge}>
              {nombre}
            </AppText>
          </View>
          {detalle === undefined ? null : (
            <AppText variant="help" tone="subtle" tabular numberOfLines={1}>
              {detalle}
            </AppText>
          )}
        </View>
        {children}
      </View>
    );
  }

  return (
    <View style={estilos.fila} testID={testID}>
      {/*
        EL ANCLA VA FUERA DE LA COLUMNA DEL NOMBRE, no dentro. Todas miden lo mismo, así
        que el nombre sigue empezando en la misma vertical en todas las filas y la franja
        también: meterla dentro de los 160 px se los comería al nombre y cada fila
        recortaría por un sitio distinto.
      */}
      <AnclaDePersona semilla={semilla} nombre={nombre} tamano="sm" />
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

/**
 * LA LISTA DE FRANJAS CON SU REGLA DE HORAS.
 *
 * ESTO ES LO QUE LE FALTABA A LA FRANJA, Y ERA LO GORDO. La franja codifica la hora del
 * día como posición horizontal —es lo único que hace— y no había nada que dijera qué hora
 * es cada posición. Se veía que Ana empezó más tarde que Julio; no a qué hora empezó
 * ninguno de los dos, ni si el hueco de la derecha era media hora o cuatro. Un gráfico con
 * el eje sin rotular enseña la forma y esconde el dato.
 *
 * Y no se veía mirando, porque la pantalla se lee como si tuviera sentido: las barras
 * están donde deben. Salió midiendo cada barra contra la hora que la fila escribe bajo el
 * nombre, y deduciendo de ahí que la ventana iba de las 00:08 a las 15:30. Que la escala
 * haya que DESPEJARLA es justo la razón de escribirla.
 *
 * LAS GUÍAS VAN DETRÁS DE TODAS LAS FILAS, no dentro de cada barra. La pista mide diez
 * píxeles de alto: una guía ahí dentro sería un palito invisible metido entre el carril y
 * el relleno. Cruzando el bloque entero, en cambio, se puede seguir con el ojo desde
 * cualquier fila hasta el rótulo de abajo, que es para lo que existe una regla.
 *
 * EN TELÉFONO NO HAY GUÍAS, solo los rótulos. Apilada, cada fila pone el nombre encima de
 * su franja, así que una línea vertical que cruzara el bloque pasaría por encima de los
 * nombres: sería una reja sobre el texto, no una referencia.
 */
export function ListaDeFranjas({
  marcas,
  ahora,
  children,
  testID,
}: {
  /** Las horas en punto: dónde caen (0..1) y qué se escribe en cada una. */
  marcas: readonly { fraccion: number; texto: string }[];
  /**
   * «Ahora», en fracción de la ventana, o `null` si el momento cae fuera.
   *
   * VA AQUÍ Y NO EN CADA FILA, y es un arreglo de esta misma tanda. Antes cada franja
   * pintaba su propio palito de diez píxeles: siete marcas sueltas diciendo todas lo
   * mismo, porque la ventana y la hora son las del bloque, no las de la persona. Al
   * meter las guías —que sí cruzan el bloque entero— quedó a la vista la jerarquía al
   * revés: la rejilla, que es la referencia, se leía más continua que «ahora», que es
   * la línea contra la que se juzga todo lo demás («¿esta persona llega tarde AHORA?»).
   */
  ahora?: number | null;
  children: React.ReactNode;
  testID?: string;
}) {
  const estilos = useEstilosDeFila();
  const { isCompact } = useResponsive();
  const hayRegla = marcas.length > 0;
  const hayAhora = ahora !== null && ahora !== undefined;

  return (
    <View style={estilos.bloque} testID={testID}>
      {(hayRegla || hayAhora) && !isCompact ? (
        /*
         * `pointerEvents="none"`: la capa cubre las filas enteras, así que sin esto se
         * comería cualquier pulsación sobre ellas. Hoy no hay ninguna; el día que la
         * haya, el fallo sería «la fila no responde» y nadie miraría una capa decorativa.
         */
        <View style={estilos.capaDeGuias} pointerEvents="none">
          <View style={estilos.anclaHueca} />
          <View style={estilos.quien} />
          <View style={estilos.franja}>
            {marcas.map((marca) => (
              <View
                key={marca.fraccion}
                style={[estilos.guia, { left: fraccionAPorcentaje(marca.fraccion) }]}
              />
            ))}
            {hayAhora ? (
              <View
                testID={testID === undefined ? undefined : `${testID}-ahora`}
                style={[estilos.ahoraDelBloque, { left: fraccionAPorcentaje(ahora) }]}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      <ElBloquePintaAhora.Provider value={hayAhora && !isCompact}>
        <View style={estilos.filas}>{children}</View>
      </ElBloquePintaAhora.Provider>

      {hayRegla ? (
        <View style={estilos.eje} testID={testID === undefined ? undefined : `${testID}-eje`}>
          {isCompact ? null : (
            <>
              <View style={estilos.anclaHueca} />
              <View style={estilos.quien} />
            </>
          )}
          <View style={estilos.franja}>
            {marcas.map((marca) => (
              /*
               * EL RÓTULO SE CENTRA EN SU MARCA con ancho fijo y margen negativo, que es
               * como se centra sobre un porcentaje sin `calc`: `translateX` en React
               * Native no acepta porcentajes, así que un `-50%` aquí no haría nada.
               */
              <AppText
                key={marca.fraccion}
                variant="help"
                tone="subtle"
                tabular
                numberOfLines={1}
                style={[estilos.rotulo, { left: fraccionAPorcentaje(marca.fraccion) }]}
              >
                {marca.texto}
              </AppText>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const fraccionAPorcentaje = (valor: number): DimensionValue =>
  `${Number((valor * 100).toFixed(2))}%` as DimensionValue;

const useEstilosDeFila = estilosDelTema((colors) => ({
  fila: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  bloque: { position: 'relative' },
  filas: { gap: spacing.sm },
  /* La capa de guías ocupa el bloque entero: las líneas cruzan todas las filas. */
  capaDeGuias: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.base,
  },
  /* El mismo hueco que ocupa el ancla en la fila, para que la pista empiece igual. */
  anclaHueca: { width: sizes.avatarSm, flexShrink: 0 },
  guia: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.border },
  /*
   * «AHORA» CRUZA EL BLOQUE, y pesa más que las guías a propósito: las guías son la regla
   * y esta es la línea contra la que se juzga todo —«¿llega tarde AHORA?»—. Con el mismo
   * gris que la rejilla se perdería entre ella.
   */
  ahoraDelBloque: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.ink700,
  },
  eje: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.base, marginTop: spacing.xs },
  /*
   * El rótulo se sale de la pista por los dos lados cuando la marca cae cerca de un borde,
   * y está bien: recortarlo es lo que haría que la primera hora del día no se pudiera leer.
   */
  rotulo: { position: 'absolute', width: 56, marginLeft: -28, textAlign: 'center' },
  filaApilada: { gap: spacing.xs },
  /* Apilado, el nombre y su hora van en una línea: el nombre crece y la hora se pega. */
  quienApilado: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  /*
   * APILADO EL ANCLA NO LE QUITA NADA A LA FRANJA: va en la línea del nombre, y la franja
   * ocupa la línea de abajo entera. Por eso aquí sí cabe en un teléfono.
   */
  nombreApilado: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  creceYEncoge: { flexShrink: 1, minWidth: 0 },
  /*
   * EL NOMBRE NO CRECE Y LA FRANJA SÍ. Al revés, cada fila tendría su franja empezando en
   * una columna distinta según lo largo que fuera el nombre, y comparar dos días —que es
   * para lo que existe esto— dejaría de ser posible de un vistazo.
   */
  quien: { width: 160, flexShrink: 0 },
  franja: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
}));
