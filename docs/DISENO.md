# La dirección visual de Krealo Shift

Esto no es una guía de estilo genérica: es **la decisión** de cómo se ve esta app y por
qué, para que las pantallas que falten por hacer se deriven de aquí en vez de inventar
una dirección nueva cada vez. Nace el 2026-09-23, de una frase de Andree: «el diseño es
demasiado básico».

## El diagnóstico, medido y no opinado

Se capturó la app publicada en tres anchos y los dos temas —28 capturas— y esto es lo que
se veía:

1. **Una sola superficie.** Todo era una caja blanca con borde de 1 px y el mismo radio:
   el aviso de «no llegó a su turno», las fichas de conteo, la gráfica y las filas de
   gente pesaban lo mismo. El ojo no tenía por dónde entrar.
2. **Una sola cara de letra** (Inter) en cuatro pesos. Correcta y anónima.
3. **Color sin oficio.** Un morado que aparecía en dos sitios —el logotipo y una barra de
   progreso— y por lo demás solo la tríada de estado. O sea que el color únicamente decía
   «alerta», nunca «esto es lo importante».
4. **Cromo apilado.** En Horario, siete filas de controles antes del primer turno: la
   rejilla empezaba en y=700 de 900 px. La mitad de la pantalla era mando.
5. **Siete pestañas en 390 px**, con etiquetas de 9 px.

## La dirección: libro de registro, no tablero

El material de esta app es **el tiempo**, y el objeto de su mundo es **la tarjeta de
fichaje**: una columna de horas selladas que se leen en vertical. De ahí sale todo:
cifras que se alinean, ritmo horizontal de fila, y reglas finas que significan algo
—un límite de día, un corte de periodo— en lugar de rodear cada cosa con un perfil.

**La crítica que hubo que hacerle a esta dirección**, porque es la mitad que se salta:
«reglas finas + libro de registro» roza uno de los clichés del diseño generado por IA, el
pastiche de periódico con reglas de un píxel y radio cero. Así que se toma el camino
contrario a propósito: se mantienen radios y planos suaves, se usan **pocas** reglas, y
la identidad la carga el elemento firma, no el pastiche.

### El elemento firma: la franja del día

Una tira horizontal que enseña el día como bandas —turno programado, fichado de verdad,
pausa, ausencia— sobre una sola escala. El mismo objeto a tres tamaños: mini en la fila de
una persona, completa en Inicio, una por persona en Horas.

Existe porque hoy el tiempo se enseña **siempre como número**: «80:03 / 132:00» en una
barra sin escala, «Lleva 03:05», un «05:30» sin etiqueta debajo de un nombre. Un número se
lee; una forma se reconoce de un vistazo, que es lo que hace falta cuando miras el tablero
entre dos cosas.

## Tipografía

| Papel   | Cara                        | Dónde                                             |
| ------- | --------------------------- | ------------------------------------------------- |
| Display | **Archivo** (500/600/700)   | Títulos de pantalla, secciones, la hora del reloj |
| Texto   | **Inter** (400/500/600/700) | Todo lo demás: párrafos, etiquetas, ayudas        |
| Datos   | Inter con `tabular`         | Horas, totales, duraciones — el prop ya existía   |

**Por qué Archivo y no la de moda.** Bricolage Grotesque era la elección obvia del momento
y por eso mismo se descartó: sus formas juguetonas no dicen nada de una tienda. Archivo es
robusta y algo estrecha —voz de rótulo, de cartel de horario— y aguanta desde los 11 px de
una cabecera de columna hasta los 64 del reloj de la tienda.

**El texto corrido NO cambia.** Para leer una frase Inter es mejor, y cambiarla habría
tocado las 54 pantallas sin ganar nada.

## Superficies: cuatro planos, no uno

| Plano     | Papel                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| `canvas`  | La página. Nada se apoya directamente en ella sin razón.                     |
| `surface` | El plano donde vive el contenido.                                            |
| `raised`  | Por encima: barras pegadas, la tarjeta de resultado del reloj, lo que flota. |
| `hundido` | **Dentro** de `surface`, para agrupar sin otro borde.                        |

`hundido` es el que mata las cajas dentro de cajas: un grupo dentro de una tarjeta se
separa con este plano y con espacio, **nunca con un segundo perfil**.

En el tema claro la elevación la da la sombra; en oscuro tiene que ser color, porque la
sombra no se ve.

## Color

La paleta **no se reinventa**: los nombres de token son papeles, no colores —`surface` no
significa blanco— y el tema oscuro está afinado contra medidas reales. Lo que cambia es la
disciplina de uso:

- El acento (`primary600`) es para **la acción primaria y el «ahora»**. En ningún otro
  sitio. Una pantalla tiene una acción primaria, no cuatro.
- La tríada de estado (verde trabajando / ámbar pausa / rojo tarde) **codifica estado**,
  así que nunca se usa como decoración, y siempre va con icono y etiqueta: nunca color a
  secas, porque quien no distingue el verde del rojo también tiene que poder usar esto.

## Lo que las siete tareas entregaron (2026-09-23 y 24)

| #   | Qué cambió                                                  | La medida                                                      |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Archivo para títulos y reloj; cuatro planos de superficie   | título 28 px en `Archivo_700Bold`, medido en el navegador      |
| 2   | Un plano se ve porque es un plano: fuera los marcos de 1 px | seis recuadros del mismo peso en Inicio → uno                  |
| 3   | Los mandos en una fila, no en una pila                      | Horario 89 % → 59 % de pantalla en mando; Equipo 66 % → 41 %   |
| 4   | **La franja del día**, el elemento firma                    | 13 pruebas de geometría; `inicio:check` vigila que se pinte    |
| 5   | La rejilla del horario deja de gritar                       | 2 → 4 empleados visibles; fuera la insignia que salía en todos |
| 6   | Horas y Equipo vuelven a ser tablas                         | 1 → 8 personas visibles en Equipo                              |
| 7   | El reloj entra en la comprobación de contraste              | 23 textos del reloj, × 2 temas × 2 anchos                      |

### Lo que NO se cambió, y por qué

- **Las siete pestañas del teléfono.** La premisa era que no caben. Medido a 390, 414 y
  360: las etiquetas son de 10 px —el mismo tamaño que usa iOS— y **ninguna está
  cortada**. Y el cajón «Más» ya se había quitado con un motivo escrito: no decía qué
  había dentro. Cambiarlo por una suposición habría desandado una mejora real.
- **La voz de los estados.** Se buscó copy que se disculpa —«lo sentimos», «ups», «algo
  salió mal»— y no hay ninguno: los nueve mensajes de error dicen qué falló y qué hacer.
- **La escala de cifras tabulares.** El prop `tabular` ya estaba puesto donde hacía falta.
  Lo que faltaba era la **etiqueta** del número, no su alineación.

## Lo que salió de mirar la app publicada (2026-09-24)

Tres cosas que ninguna comprobación estaba viendo y que salieron de dos sitios: Andree
mirando la app con sus datos, y una medición que hice por otro motivo.

### «No se diferencia entre persona»: el ancla que no anclaba

Las filas pintaban a todo el mundo del mismo tinte clarísimo. Lo arreglé pasando de un
tinte a cinco, y **calculada la separación perceptual en OKLab, los cinco quedaban entre
1,7 y 3,1 sobre un umbral de 8**. O sea que no eran cinco colores: era el mismo lavado
cinco veces, con un susurro de tono. Le puse el defecto que me había señalado, con más
código.

La causa se ve en cuanto se calcula y no se ve mirando: **en OKLab la distancia la manda
sobre todo la luminosidad**, y cinco lavados a la misma claridad no se separan por mucho
que cambie el tono. Para que el color distinga, el color tiene que existir.

Ahora el disco lleva color de verdad, son seis, y hay una prueba que recalcula en cada
ejecución que cada par se separa ≥ 8, que ninguno se acerca a menos de 8 de un color de
**estado** —un ancla que parece un estado inventa un estado— y que la letra y el disco
llegan a su contraste. La arcilla de oscuro hubo que correrla: quedaba a 6,3 del ámbar de
«En descanso».

### El medio vacío de las filas

`space-between` con el nombre a la izquierda y la insignia a la derecha deja **setecientos
píxeles de nada** en un monitor de 1440, y el ojo salta de punta a punta en cada fila.
Columnas de ancho fijo con su cabecera: el valor cae en la misma vertical en todas las
filas, que es lo que convierte una lista en algo que se compara sin leer. La columna se
reserva **incluso en la fila que no tiene ese dato**, porque si se encogiera ahí, la
siguiente columna se desplazaría y dejaría de ser columna.

### La franja del día tenía el eje sin rotular

El elemento firma codifica la hora como **posición horizontal** —es lo único que hace— y
no decía qué hora es cada posición. Se veía que alguien empezó más tarde que otro, no a
qué hora empezó ninguno.

Y no se veía mirando, **porque la pantalla se lee como si tuviera sentido**: las barras
están donde deben. Salió midiendo la posición de cada barra contra la hora escrita bajo el
nombre y despejando de ahí que la ventana iba de las 00:08 a las 15:30. Que la escala haya
que despejarla es la razón de escribirla.

Al poner las guías quedó a la vista una jerarquía al revés que yo mismo acababa de crear:
la rejilla cruzaba el bloque entero mientras «ahora» —la línea contra la que se juzga todo
lo demás— eran siete palitos sueltos de diez píxeles. Ahora «ahora» es una línea del
bloque, y en teléfono vuelve a la fila; las dos decisiones salen del mismo contexto para
que no puedan discrepar.

### Ocho veces me corrigió una medición

Queda escrito porque es el método, no una anécdota: la fuente que parecía no aplicarse y
era el rastro de la cabecera; el icono que mi selector confundió con un título; el
`minHeight` que me llevé por delante al reescribir un estilo; el hueco de 32 px que
razoné como táctil y no lo era; el `formatClockTime` con la zona y el formato cambiados
de sitio; la prueba que pasaba igual poniendo infinito; el `minWidth` que cambié en la
tarjeta cuando quien manda es el envoltorio; y los cinco tonos de ancla que parecían
cinco y medidos eran uno.

**Editar no es lo mismo que cambiar, y ver no es lo mismo que medir.**

### Y una prueba que escribí y no probaba nada

La del cambio de horario afirmaba que las marcas de hora siguen «en punto» tras un cambio
de hora. **Eso no puede fallar**: el salto es de una hora exacta y el paso es múltiplo de
sesenta minutos, así que cruzarlo deja las marcas en punto igual, solo se salta una. Lo
descubrió el control —romper el código a propósito para ver si la prueba cae— y no cayó.
Reescrita a lo que de verdad se rompe: que los huecos midan lo mismo.

**Una prueba que no se ha visto caer no prueba nada.**

## Lo que se verifica, y no se opina

- `tema:check` — los dos temas enteros, y que **Archivo esté cargada y en uso**. Este
  último control se escribió tras comprobar que una fuente que no llega no rompe nada:
  el navegador cae a la del sistema y el título se ve «parecido».
- `contraste:check` — 3053 textos medidos en 8 pantallas × 2 anchos × 2 temas.
- `responsive:check` — que nada se salga ni se recorte.
- `inicio:check` — además de que los tres días se vean distintos, que la franja **tenga
  escala**: al menos dos rótulos de hora, y la línea de «ahora» dentro de la pista.
- `anclas-separan.test.ts` — que los tonos de identidad se distingan de verdad, que no se
  confundan con un estado y que lleguen a su contraste. Aritmética, no un comentario que
  diga que se miró una vez.

Las capturas de antes están en la tarea 1/7 del Publisher; el diagnóstico de arriba sale
de ellas.
