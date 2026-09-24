import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { indiceDeAncla, TONOS_DE_ANCLA } from '@/domain/ancla-de-identidad';
import { estilosDelTema } from '@/theme/estilos';
import { anclasDeIdentidadClaro, anclasDeIdentidadOscuro, radii, sizes } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * EL ANCLA DE UNA PERSONA: sus iniciales, del color que le toca.
 *
 * Una lista de nombres sin nada a la izquierda obliga a LEER para encontrar a alguien. Con
 * un ancla el ojo recorre la columna y se detiene en la forma que reconoce; leer pasa a
 * ser el segundo paso. Pero eso solo funciona si el ancla DISTINGUE: la primera versión
 * pintaba a todo el mundo del mismo tinte clarísimo, así que no distinguía nada y encima
 * se veía como una mancha. Lo dijo Andree mirando la app publicada.
 *
 * Son iniciales y no fotos porque la app no guarda retratos del equipo —solo fotos de
 * fichaje, que son otra cosa y se borran por retención— así que una foto sería un hueco
 * gris en todas las filas.
 *
 * NO LO OYE UN LECTOR DE PANTALLA, y es correcto: la fila ya anuncia el nombre completo.
 * Unas iniciales leídas en voz alta antes del nombre solo serían ruido.
 */
export function AnclaDePersona({
  semilla,
  nombre,
  tamano = 'md',
  testID,
}: {
  /** El IDENTIFICADOR, no el nombre: dos personas pueden llamarse igual. */
  semilla: string;
  nombre: string;
  tamano?: 'sm' | 'md';
  testID?: string;
}) {
  const { isDark } = useTheme();
  const estilos = useEstilos();
  const tonos = isDark ? anclasDeIdentidadOscuro : anclasDeIdentidadClaro;
  const tono = tonos[indiceDeAncla(semilla, TONOS_DE_ANCLA)] ?? tonos[0];
  const lado = tamano === 'sm' ? sizes.avatarSm : sizes.avatarMd;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      testID={testID}
      style={[
        estilos.ancla,
        { width: lado, height: lado, backgroundColor: tono?.bg ?? 'transparent' },
      ]}
    >
      <AppText variant="label" style={{ color: tono?.fg }}>
        {inicialesDe(nombre)}
      </AppText>
    </View>
  );
}

/**
 * La primera letra del nombre y la del primer apellido.
 *
 * Con un solo nombre («Ana») devuelve UNA letra, no dos: inventar la segunda a partir de
 * la segunda letra del nombre —«AN»— convierte a Ana y a Andrés en el mismo ancla, que es
 * justo lo contrario de para lo que sirve.
 *
 * Se separa por PUNTOS DE CÓDIGO y no con `charAt`, porque una inicial puede ser un
 * carácter fuera del plano básico y `charAt` devolvería media pareja sustituta: un rombo
 * con una interrogación en lugar de una letra.
 */
export function inicialesDe(nombre: string): string {
  const partes = nombre
    .trim()
    .split(/\s+/)
    .filter((parte) => parte !== '');
  if (partes.length === 0) return '?';
  const primera = [...(partes[0] ?? '')][0] ?? '';
  const segunda = partes.length > 1 ? ([...(partes[1] ?? '')][0] ?? '') : '';
  return (primera + segunda).toUpperCase();
}

const useEstilos = estilosDelTema(() => ({
  ancla: {
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
}));
