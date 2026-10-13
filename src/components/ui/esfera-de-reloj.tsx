import { useState } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useLiveClock } from '@/hooks/use-live-clock';
import { movimiento } from '@/theme/movimiento';
import { useTheme } from '@/theme/use-theme';

/** El rojo del aro del logo de Krealo Shift (`public/brand/svg`). */
const ROJO_DE_MARCA = '#FF0000';

/**
 * LA ESFERA DEL RELOJ MARCADOR (13-oct), la firma del rediseño: el aro rojo del logo hecho
 * reloj de verdad, con la hora de ahora y un segundero que no para. Es de lo que va la app
 * —horas marcadas— y es lo primero que se ve al entrar.
 *
 * Las agujas de hora y minuto se colocan con la hora real y se recolocan cada minuto; el
 * segundero gira con CSS (`movimiento('girar')`), así que no cuesta un render por segundo.
 * Con «reducir movimiento», el segundero se queda quieto donde estaba.
 *
 * Es decorativa: no lleva texto ni se anuncia al lector de pantalla.
 */
export function EsferaDeReloj({ tamano = 220 }: { tamano?: number }) {
  const { colors } = useTheme();
  const ahora = useLiveClock('minute');
  const minutos = ahora.getMinutes();
  const horas = (ahora.getHours() % 12) + minutos / 60;
  // Una vez, al montar: luego gira solo. Recalcularlo cada minuto lo haría saltar.
  const [segundos] = useState(() => new Date().getSeconds());
  const centro = tamano / 2;

  const aguja = (largo: number, grosor: number, grados: number, color: string): ViewStyle => ({
    position: 'absolute',
    left: centro - grosor / 2,
    top: centro - largo,
    width: grosor,
    height: largo,
    borderRadius: grosor,
    backgroundColor: color,
    transformOrigin: '50% 100%',
    transform: [{ rotate: `${grados}deg` }],
  });

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: tamano,
        height: tamano,
        borderRadius: tamano / 2,
        borderWidth: Math.max(3, tamano * 0.035),
        borderColor: ROJO_DE_MARCA,
      }}
      testID="esfera-de-reloj"
    >
      {Array.from({ length: 12 }, (_, i) => {
        const larga = i % 3 === 0;
        const largo = tamano * (larga ? 0.09 : 0.05);
        const grosor = larga ? 3 : 2;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: centro - grosor / 2 - Math.max(3, tamano * 0.035),
              top: -Math.max(3, tamano * 0.035),
              width: grosor,
              height: tamano,
              transform: [{ rotate: `${i * 30}deg` }],
            }}
          >
            <View
              style={{
                marginTop: tamano * 0.07,
                height: largo,
                width: grosor,
                borderRadius: grosor,
                backgroundColor: larga ? colors.marcoTexto : colors.marcoApagado,
              }}
            />
          </View>
        );
      })}
      <View style={{ position: 'absolute', inset: -Math.max(3, tamano * 0.035) } as ViewStyle}>
        <View style={aguja(tamano * 0.26, 6, horas * 30, colors.marcoTexto)} />
        <View style={aguja(tamano * 0.37, 4, minutos * 6, colors.marcoTexto)} />
        {/* El segundero: un cuadrado entero que gira, con la aguja dentro apuntando arriba. */}
        <View
          style={
            {
              position: 'absolute',
              inset: 0,
              transform: [{ rotate: `${segundos * 6}deg` }],
            } as ViewStyle
          }
        >
          <View {...movimiento('girar')} style={{ position: 'absolute', inset: 0 } as ViewStyle}>
            <View style={aguja(tamano * 0.42, 2, 0, ROJO_DE_MARCA)} />
          </View>
        </View>
        <View
          style={{
            position: 'absolute',
            left: centro - 7,
            top: centro - 7,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: ROJO_DE_MARCA,
            borderWidth: 3,
            borderColor: colors.marco,
          }}
        />
      </View>
    </View>
  );
}
