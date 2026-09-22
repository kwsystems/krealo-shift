import type { Almacen, Fila } from './postgrest';
import { DEFAULT_PAID_REASONS, type BreakReason } from '@/domain/break-reason';

/**
 * Los datos de la demostración.
 *
 * QUÉ FORMA TIENEN Y POR QUÉ ESA
 * Cada pantalla valida con Zod lo que recibe (§22), así que estas filas no son
 * decorativas: si a una le falta una columna o le sobra un tipo, la pantalla muestra
 * "la respuesta no tiene la forma esperada" en vez de datos. Las columnas salieron de
 * barrer las 53 consultas del proyecto y leer el esquema Zod de cada una, no de
 * adivinar: son las mismas que pide la base de verdad.
 *
 * TODO ES RELATIVO A AHORA
 * Las fechas se calculan al arrancar, no están escritas a mano. Un tablero de fichajes
 * con fechas fijas envejece en un día: "quién está trabajando ahora" sale vacío, la
 * semana del horario queda en el pasado y lo que debería ser la pantalla más viva de la
 * app aparece muerta. Con fechas relativas, la demostración se ve igual de viva hoy que
 * dentro de seis meses.
 *
 * LOS DATOS SON INVENTADOS, y los nombres son deliberadamente genéricos: no se usa
 * ningún cliente real de la agencia ni ninguna persona real.
 */

export const DEMO_ORG_ID = '11111111-1111-4111-8111-111111111111';
export const DEMO_USER_ID = '99999999-9999-4999-8999-999999999991';
export const DEMO_EMAIL = 'demo@krealoshift.app';
export const DEMO_LOCATION_1 = '22222222-2222-4222-8222-222222222221';
export const DEMO_LOCATION_2 = '22222222-2222-4222-8222-222222222222';

/**
 * La zona de la organización de demostración. EXPORTADA porque los escenarios tienen
 * que preguntar «¿esto es hoy?» con el mismo huso que usa la app, no con el del
 * navegador: ver `escenarios.ts`.
 */
export const TZ = 'America/Lima';

/** `uuid` estable a partir de un número, para que las relaciones casen entre tablas. */
function id(prefijo: string, n: number): string {
  const cola = String(n).padStart(12, '0');
  return `${prefijo}-${prefijo.slice(0, 4)}-4${prefijo.slice(0, 3)}-8${prefijo.slice(0, 3)}-${cola}`;
}

const empleadoId = (n: number) => id('33333333', n);
const puestoId = (n: number) => id('44444444', n);
const turnoId = (n: number) => id('55555555', n);
const sesionId = (n: number) => id('66666666', n);
const eventoId = (n: number) => id('77777777', n);
const solicitudId = (n: number) => id('88888888', n);
const pausaId = (n: number) => id('aaaaaaaa', n);

/**
 * Los motivos que se reparten entre las personas de la demostración, en este orden.
 * Se recorren en círculo, así que hay al menos uno de cada en cuanto hay seis
 * personas fichando, que es lo que hace que el gráfico de motivos tenga algo que
 * enseñar.
 */
/**
 * Lo que la gente escribe al pausar por «Otro», que la app OBLIGA a rellenar.
 *
 * Están aquí para que la demostración enseñe de qué sirve pedirla: sin notas, Reportes
 * dice «Otro: 45 min» y no hay forma de saber si eso es un problema o un martes normal.
 *
 * SON INVENTADAS, y a propósito parecidas a lo que alguien escribiría de verdad: son
 * frases de un empleado sobre por qué se ausentó, o sea dato personal y a veces médico.
 * Ninguna sale de una persona real ni nombra a nadie.
 */
const NOTAS_DEMO: readonly string[] = [
  'Fui a la clínica, me dieron cita a esa hora y no pude moverla.',
  'Llamaron del colegio de mi hijo, tuve que salir a recogerlo.',
  'Trámite en el banco; solo atienden en horario de tienda.',
];

const MOTIVOS_DEMO: readonly BreakReason[] = [
  'meal',
  'rest',
  'permit',
  'meeting',
  'training',
  'other',
];

/**
 * Cuánto dura una pausa de cada tipo, en minutos.
 *
 * NO SON TODAS DE 30, y eso lo descubrió el arnés, no el ojo. Con la primera versión
 * —media hora para todo el mundo— el gráfico de «en qué se va el tiempo que no se
 * trabaja» salía con cuatro barras EXACTAMENTE iguales. No estaba roto: los datos eran
 * planos, y un gráfico de barras iguales no responde la pregunta que lo justifica. Una
 * demostración así enseña un tablero que parece inútil.
 *
 * Los números son los que se ven en una tienda de verdad: la comida es la pausa larga,
 * el descanso corto es corto, un permiso personal se lleva una hora, y una reunión o
 * una capacitación duran lo que duran.
 */
const MINUTOS_POR_MOTIVO: Readonly<Record<BreakReason, number>> = {
  meal: 45,
  rest: 12,
  permit: 60,
  meeting: 25,
  training: 40,
  other: 20,
};

function aISO(fecha: Date): string {
  return fecha.toISOString();
}

function conHora(base: Date, horas: number, minutos = 0): Date {
  const d = new Date(base);
  d.setHours(horas, minutos, 0, 0);
  return d;
}

function sumarDias(base: Date, dias: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  return d;
}

function fechaClave(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/*
 * LOS NOMBRES SON EL CASO DE PRUEBA, no relleno, y por eso hay uno largo de verdad.
 *
 * Toda la auditoría de anchos del 2026-09-22 se midió contra esta lista, y los fallos
 * que encontró —el ranking de Reportes recortando «Héctor Ramírez Pinto», el filtro de
 * Horas escondiendo seis de nueve— salieron con nombres de 19 y 20 caracteres. Con
 * nombres cortos, una pantalla puede parecer correcta y romperse el primer día en una
 * tienda real.
 *
 * `Irene Vásquez Molina` pasa a `María Fernanda Velásquez Herrera`: 32 caracteres, dos
 * nombres y dos apellidos, que es la forma normal de un nombre peruano completo. Se
 * RENOMBRA en vez de añadir a alguien a propósito: añadir una decimotercera persona
 * cambiaría las horas totales, las sumas del CSV y las filas del ranking, y con ellas
 * media docena de arneses que comparan cifras. Renombrar deja todos los números
 * idénticos y solo mueve el ancho, que es exactamente lo que se quiere medir.
 *
 * NINGUNO ES REAL. Este repositorio es público y los nombres de empleados de un cliente
 * no entran aquí: son inventados con la forma de los de verdad, que para medir anchos es
 * lo único que importa.
 */
const PERSONAS: { nombre: string; corto: string | null; puesto: number }[] = [
  { nombre: 'Ana Quispe Lara', corto: 'Ana', puesto: 1 },
  { nombre: 'Bruno Salazar Nieto', corto: null, puesto: 2 },
  { nombre: 'Carla Medina Rojas', corto: 'Carla', puesto: 1 },
  { nombre: 'Diego Paredes Vega', corto: null, puesto: 3 },
  { nombre: 'Elena Torres Campos', corto: 'Ele', puesto: 2 },
  { nombre: 'Fabián Ríos Delgado', corto: null, puesto: 4 },
  { nombre: 'Gabriela Núñez Soto', corto: 'Gaby', puesto: 1 },
  { nombre: 'Héctor Ramírez Pinto', corto: null, puesto: 3 },
  { nombre: 'María Fernanda Velásquez Herrera', corto: null, puesto: 2 },
  { nombre: 'Julio Contreras Bravo', corto: 'Julio', puesto: 4 },
  { nombre: 'Karina Espinoza Luna', corto: null, puesto: 1 },
  { nombre: 'Luis Guerrero Pacheco', corto: null, puesto: 2 },
];

const PUESTOS = [
  { n: 1, nombre: 'Cajero', color: '#6D4AFF' },
  { n: 2, nombre: 'Barista', color: '#0E9F6E' },
  { n: 3, nombre: 'Supervisor', color: '#F05252' },
  { n: 4, nombre: 'Almacén', color: '#FF8A4C' },
];

/**
 * Construye el almacén completo.
 *
 * Se llama una vez por carga de la pestaña. No se guarda en disco ni en localStorage a
 * propósito: recargar devuelve la demostración a su estado inicial, que es lo que uno
 * quiere al enseñarla, y evita que un experimento a medias quede pegado para siempre.
 */
export function crearAlmacen(): Almacen {
  const ahora = new Date();
  const hoy = new Date(ahora);
  hoy.setHours(0, 0, 0, 0);

  // Lunes de esta semana (la organización empieza la semana en lunes).
  const diaSemana = (hoy.getDay() + 6) % 7;
  const lunes = sumarDias(hoy, -diaSemana);

  const empleados: Fila[] = PERSONAS.map((persona, indice) => ({
    id: empleadoId(indice + 1),
    organization_id: DEMO_ORG_ID,
    full_name: persona.nombre,
    preferred_name: persona.corto,
    email: indice % 4 === 0 ? `persona${indice + 1}@ejemplo.com` : null,
    employee_number: String(1000 + indice + 1),
    status: indice === PERSONAS.length - 1 ? 'inactive' : 'active',
    hire_date: fechaClave(sumarDias(hoy, -(90 + indice * 17))),
    user_id: null,
  }));

  const puestos: Fila[] = PUESTOS.map((p) => ({
    id: puestoId(p.n),
    organization_id: DEMO_ORG_ID,
    name: p.nombre,
    color: p.color,
    is_active: true,
  }));

  /*
   * `organization_id` EN CADA FILA, aunque la demostración solo tenga una empresa.
   *
   * No es decoración: las consultas de la app acotan por organización porque las
   * reglas de Firestore lo exigen —una consulta que no acota por el campo que la
   * regla mira se deniega entera—. Si la semilla no trae el campo, la demostración
   * devuelve cero filas donde la app real devuelve datos, y entonces deja de servir
   * para lo único que sirve: enseñar lo mismo que se ve en producción.
   */
  const asignaciones: Fila[] = PERSONAS.map((_, indice) => ({
    organization_id: DEMO_ORG_ID,
    employee_id: empleadoId(indice + 1),
    location_id: indice % 3 === 2 ? DEMO_LOCATION_2 : DEMO_LOCATION_1,
    can_manage: indice === 3 || indice === 7,
    is_primary: true,
  }));

  const puestosDeEmpleado: Fila[] = PERSONAS.map((persona, indice) => ({
    organization_id: DEMO_ORG_ID,
    employee_id: empleadoId(indice + 1),
    job_role_id: puestoId(persona.puesto),
    is_primary: true,
  }));

  // ---------------------------------------------------------------- turnos
  /*
   * DOS SEMANAS, NO UNA: la anterior entera y la actual hasta hoy.
   *
   * La semilla sembraba solo la semana en curso, y los fichajes solo de sus días ya
   * transcurridos. Un LUNES eso es cero: cero fichajes, cero pausas, cero horas extra,
   * una sola columna en «Cómo va la semana». Consecuencias, todas vistas el lunes
   * 2026-09-21: `datos-demo.test.ts` fallaba —el CI entero en rojo un día de cada
   * siete—, `reportes:check` denunciaba tres gráficos vacíos, y las solicitudes de
   * abajo apuntaban a `sesionId(2)` y `sesionId(3)`, que ese día no existían.
   *
   * Nadie lo había visto porque nadie había pusheado un lunes. Con la semana anterior
   * sembrada entera (seis días, publicada), cualquier día de la semana tiene datos con
   * los que comparar, «Semana anterior» en Reportes lleva a algo, y esas dos sesiones
   * existen siempre.
   *
   * `dia` va de -7 (lunes de la semana pasada) a 6. La rotación de personas usa el día
   * de la semana y no el índice, para que la semana actual quede EXACTAMENTE como
   * estaba —los arneses comparan sus totales— y la anterior repita el mismo patrón.
   */
  const esDomingo = (dia: number) => ((dia % 7) + 7) % 7 === 6;
  const turnos: Fila[] = [];
  let contadorTurno = 0;
  for (let dia = -7; dia < 7; dia += 1) {
    const fecha = sumarDias(lunes, dia);
    // Domingo cerrado: una semana con siete días idénticos no se parece a ninguna tienda.
    if (esDomingo(dia)) continue;
    const diaDeLaSemana = ((dia % 7) + 7) % 7;
    const plantilla = [
      { desde: 8, hasta: 14 },
      { desde: 14, hasta: 20 },
    ];
    plantilla.forEach((tramo, tramoIndice) => {
      for (let puesto = 0; puesto < 3; puesto += 1) {
        contadorTurno += 1;
        const indiceEmpleado = (diaDeLaSemana + tramoIndice * 3 + puesto) % (PERSONAS.length - 1);
        const enBorrador = dia >= 5;
        turnos.push({
          id: turnoId(contadorTurno),
          organization_id: DEMO_ORG_ID,
          employee_id: empleadoId(indiceEmpleado + 1),
          location_id: indiceEmpleado % 3 === 2 ? DEMO_LOCATION_2 : DEMO_LOCATION_1,
          job_role_id: puestoId(PERSONAS[indiceEmpleado]?.puesto ?? 1),
          starts_at: aISO(conHora(fecha, tramo.desde)),
          ends_at: aISO(conHora(fecha, tramo.hasta)),
          timezone: TZ,
          planned_unpaid_break_minutes: tramo.hasta - tramo.desde >= 6 ? 30 : 0,
          employee_note: null,
          manager_note: puesto === 0 && dia === 2 ? 'Entrega de proveedor a las 9.' : null,
          status: enBorrador ? 'draft' : 'published',
          publication_version: enBorrador ? 0 : 7,
          // La semana pasada se publicó el sábado anterior a ella; esta, el sábado pasado.
          published_at: enBorrador ? null : aISO(sumarDias(lunes, dia < 0 ? -9 : -2)),
          updated_at: aISO(sumarDias(lunes, dia < 0 ? -9 : -2)),
        });
      }
    });
  }

  const publicaciones: Fila[] = [
    {
      id: id('aaaaaaaa', 7),
      organization_id: DEMO_ORG_ID,
      location_id: DEMO_LOCATION_1,
      // Se filtra por `week_starts_on`, así que tiene que ser la clave del lunes.
      week_starts_on: fechaClave(lunes),
      publication_version: 7,
      published_at: aISO(sumarDias(lunes, -2)),
      changed_shift_ids: [turnoId(1), turnoId(2)],
    },
  ];

  // -------------------------------------------------- fichajes y sesiones
  const eventos: Fila[] = [];
  const sesiones: Fila[] = [];
  const trabajandoAhora: Fila[] = [];
  const resumenDiario: Fila[] = [];
  const intervalos: Fila[] = [];
  const pausasPorMotivo: Fila[] = [];

  let contadorSesion = 0;
  let contadorEvento = 0;

  // Días cerrados: del lunes de la semana ANTERIOR hasta ayer, saltando domingos. Ver
  // el porqué de las dos semanas en el bloque de turnos.
  for (let dia = -7; dia < diaSemana; dia += 1) {
    if (esDomingo(dia)) continue;
    const fecha = sumarDias(lunes, dia);
    /*
     * LA SEMANA ANTERIOR NO ES PLANA. Con seis personas idénticas cada día, sus seis
     * columnas en «Cómo va la semana» medían exactamente lo mismo, y `reportes:check`
     * lo denunció como «la escala no se está aplicando». Tenía razón en el síntoma y no
     * en la causa: la escala funcionaba, los datos eran los que no variaban. Una tienda
     * no tiene la misma plantilla todos los días, así que la semana pasada tampoco:
     * seis personas los días fuertes, cuatro el jueves. La actual no se toca.
     */
    const plantilla = dia < 0 ? ([6, 5, 6, 4, 6, 5][((dia % 7) + 7) % 7] ?? 6) : 6;
    for (let persona = 0; persona < plantilla; persona += 1) {
      contadorSesion += 1;
      const entrada = conHora(fecha, 8, persona % 2 === 0 ? 0 : 9);
      /*
       * UNA PERSONA CIERRA LA TIENDA y se pasa del umbral diario; el resto sale a las
       * dos. Sin esto, la demostración no tenía ni un minuto de horas extra, así que el
       * gráfico que las compara enseñaba su estado vacío SIEMPRE y la barra apilada
       * —dos series, leyenda y hueco de superficie entre tramos— no se veía nunca.
       *
       * Lo cazó `scripts/reportes-check.mjs` leyendo «extra 00:00» en las dos pantallas:
       * cuadraban, sí, pero cuadraban en cero, que es la forma más fácil de cuadrar y
       * la que no demuestra nada.
       */
      const cierra = persona === 3 ? 'tarde' : persona === 0 ? 'pronto' : null;
      const salida =
        cierra === 'tarde'
          ? conHora(fecha, 19, 30)
          : cierra === 'pronto'
            ? conHora(fecha, 17, 10)
            : conHora(fecha, 14, persona % 3 === 0 ? 12 : 0);
      const brutos = Math.round((salida.getTime() - entrada.getTime()) / 60000);
      /*
       * CADA PERSONA SE AUSENTA POR UN MOTIVO DISTINTO, y de ahí sale si esos minutos
       * cuentan como trabajados o no. No es adorno: si en la demostración todas las
       * pausas fueran «comida», el gráfico de «en qué se va el tiempo que no se
       * trabaja» enseñaría una sola barra y no demostraría nada de lo que existe para
       * demostrar.
       *
       * El reparto pagado/no pagado NO se escribe a mano aquí: sale de
       * `DEFAULT_PAID_REASONS`, la misma tabla que usa la app de verdad. Así la
       * demostración no puede contradecir a la app —si mañana una reunión deja de
       * contar como trabajo, estos números cambian solos— y `net_minutes` sigue
       * siendo bruto menos lo que de verdad no se paga.
       */
      /*
       * EL MOTIVO SE CORRE UN DÍA CADA DÍA, y no es adorno: sin el desplazamiento el
       * motivo era `persona % 6` y la sede `persona % 3`, o sea que la sede quedaba
       * DETERMINADA por el motivo. Con doce personas eso dejaba «Otro» y «Permiso»
       * ENTEROS en la segunda sede, y el tablero mira la primera: dos de los seis
       * motivos no salían nunca donde alguien los iba a ver, y con ellos las
       * explicaciones que «Otro» obliga a escribir.
       *
       * Medido antes de tocar nada: de las 42 filas de `break_time_by_reason`, las 4 de
       * «Otro» y las 8 de «Permiso» estaban las doce en la sede 2.
       *
       * Sumar el día rompe esa atadura sin mover a nadie de sede: a lo largo de la
       * semana cada motivo pasa por gente de las dos.
       */
      const motivo = MOTIVOS_DEMO[(persona + Math.abs(dia)) % MOTIVOS_DEMO.length] ?? 'meal';
      const minutosPausa = MINUTOS_POR_MOTIVO[motivo];
      const pagada = DEFAULT_PAID_REASONS[motivo];
      const descansoPagado = pagada ? minutosPausa : 0;
      const descansoNoPagado = pagada ? 0 : minutosPausa;
      const netos = brutos - descansoNoPagado;
      const tarde = persona % 2 !== 0;
      const ubicacion = persona % 3 === 2 ? DEMO_LOCATION_2 : DEMO_LOCATION_1;

      sesiones.push({
        id: sesionId(contadorSesion),
        organization_id: DEMO_ORG_ID,
        employee_id: empleadoId(persona + 1),
        location_id: ubicacion,
        shift_id: null,
        starts_at: aISO(entrada),
        ends_at: aISO(salida),
        gross_minutes: brutos,
        paid_break_minutes: descansoPagado,
        unpaid_break_minutes: descansoNoPagado,
        net_minutes: netos,
        status: tarde ? 'needs_review' : 'complete',
        flags: tarde ? ['late_arrival'] : [],
        updated_at: aISO(salida),
      });

      resumenDiario.push({
        employee_id: empleadoId(persona + 1),
        location_id: ubicacion,
        work_date: fechaClave(fecha),
        sessions: 1,
        gross_minutes: brutos,
        paid_break_minutes: descansoPagado,
        unpaid_break_minutes: descansoNoPagado,
        net_minutes: netos,
        needs_review: tarde,
        flags: tarde ? ['late_arrival'] : [],
      });

      const inicioPausa = conHora(fecha, 11);
      const finPausa = conHora(fecha, 11, minutosPausa);
      const tipoPausa = pagada ? 'paid' : 'unpaid';

      /*
       * La nota solo existe cuando el motivo es «Otro», porque es el único que la pide.
       * Se reparte por persona para que en Reportes salgan varias distintas y se vea que
       * la lista es una lista, no un texto suelto.
       */
      const nota = motivo === 'other' ? (NOTAS_DEMO[persona % NOTAS_DEMO.length] ?? null) : null;

      intervalos.push({
        id: pausaId(contadorSesion),
        work_session_id: sesionId(contadorSesion),
        organization_id: DEMO_ORG_ID,
        employee_id: empleadoId(persona + 1),
        starts_at: aISO(inicioPausa),
        ends_at: aISO(finPausa),
        duration_minutes: minutosPausa,
        break_type: tipoPausa,
        break_reason: motivo,
        break_note: nota,
      });

      // La vista `break_time_by_reason` la calcula la base con SQL; aquí es una tabla
      // ya agregada, igual que `daily_time_summary`. Se construye del MISMO intervalo
      // de arriba para que el gráfico de motivos no pueda discrepar de las pausas.
      pausasPorMotivo.push({
        organization_id: DEMO_ORG_ID,
        location_id: ubicacion,
        employee_id: empleadoId(persona + 1),
        work_date: fechaClave(fecha),
        break_reason: motivo,
        break_type: tipoPausa,
        pauses: 1,
        minutes: minutosPausa,
        notes: nota === null ? [] : [{ at: aISO(inicioPausa), minutes: minutosPausa, note: nota }],
      });

      for (const [tipo, cuando, descanso] of [
        ['clock_in', entrada, null],
        ['break_start', inicioPausa, tipoPausa],
        ['break_end', finPausa, tipoPausa],
        ['clock_out', salida, null],
      ] as const) {
        contadorEvento += 1;
        eventos.push({
          id: eventoId(contadorEvento),
          organization_id: DEMO_ORG_ID,
          employee_id: empleadoId(persona + 1),
          location_id: ubicacion,
          event_type: tipo,
          break_type: descanso,
          occurred_at: aISO(cuando),
          source: 'kiosk',
          is_offline: false,
        });
      }
    }
  }

  /*
   * Turnos de HOY que ya terminaron.
   *
   * Sin esto, el lunes la demostración enseñaba 00:00 en todas partes: «registradas
   * 00:00 / 132:00», cada fila de Horas a cero y el resumen de la semana vacío. El
   * bucle de arriba solo cierra los días ANTERIORES a hoy, así que un lunes no cerraba
   * ninguno. Una app de control horario que enseña cero horas trabajadas parece rota,
   * y era justo la queja de la que salió todo esto.
   *
   * Las horas se cuentan hacia atrás desde AHORA, no desde una hora fija del día: así
   * son pasado a cualquier hora a la que se abra la demostración, también a las nueve
   * de la mañana.
   */
  for (let persona = 6; persona < 10; persona += 1) {
    contadorSesion += 1;
    const entrada = new Date(ahora.getTime() - (8 * 60 + persona * 7) * 60000);
    const salida = new Date(ahora.getTime() - (2 * 60 + persona * 5) * 60000);
    const brutos = Math.round((salida.getTime() - entrada.getTime()) / 60000);
    /*
     * EL DESCANSO SE DERIVA IGUAL QUE ARRIBA, y aquí estaba escrito a mano: «30 minutos
     * no pagados», sin motivo y sin intervalo que lo respaldara. La sesión afirmaba una
     * pausa que no existía en ninguna tabla.
     *
     * Un lunes eso dejaba `break_intervals` VACÍA —el bucle de días cerrados no corre
     * ningún día— así que Reportes enseñaba «en qué se va el tiempo» en blanco mientras
     * las filas de Horas decían que sí hubo descansos. La demostración se contradecía a
     * sí misma un día de cada siete, y con ella la prueba que lo vigila.
     */
    // El mismo corrimiento que arriba, con un desfase fijo: hoy no tiene índice de día,
    // pero tampoco puede repetir el reparto del lunes.
    const motivo = MOTIVOS_DEMO[(persona + 2) % MOTIVOS_DEMO.length] ?? 'meal';
    const minutosPausa = MINUTOS_POR_MOTIVO[motivo];
    const pagada = DEFAULT_PAID_REASONS[motivo];
    const tipoPausa = pagada ? 'paid' : 'unpaid';
    const descansoPagado = pagada ? minutosPausa : 0;
    const descansoNoPagado = pagada ? 0 : minutosPausa;
    const netos = brutos - descansoNoPagado;
    const inicioPausa = new Date(entrada.getTime() + 3 * 60 * 60000);
    const finPausa = new Date(inicioPausa.getTime() + minutosPausa * 60000);
    const ubicacion = persona % 3 === 2 ? DEMO_LOCATION_2 : DEMO_LOCATION_1;
    const revisar = persona === 7;
    /*
     * Alguien que cubrió sin turno programado. Lo marca el servidor con `unscheduled`,
     * y existe aquí porque es el caso que el gráfico de puntualidad tiene que saber
     * dejar fuera: sin turno no hay hora a la que llegar, así que no puede llegar
     * tarde ni a tiempo. Sin una fila así, la nota que lo explica no se ve nunca en la
     * demostración y nadie se entera de que la regla existe.
     */
    const sinTurno = persona === 9;

    sesiones.push({
      id: sesionId(contadorSesion),
      organization_id: DEMO_ORG_ID,
      employee_id: empleadoId(persona + 1),
      location_id: ubicacion,
      shift_id: null,
      starts_at: aISO(entrada),
      ends_at: aISO(salida),
      gross_minutes: brutos,
      paid_break_minutes: descansoPagado,
      unpaid_break_minutes: descansoNoPagado,
      net_minutes: netos,
      status: revisar ? 'needs_review' : 'complete',
      flags: sinTurno ? ['unscheduled'] : revisar ? ['late_arrival'] : [],
      updated_at: aISO(salida),
    });

    resumenDiario.push({
      employee_id: empleadoId(persona + 1),
      location_id: ubicacion,
      work_date: fechaClave(hoy),
      sessions: 1,
      gross_minutes: brutos,
      paid_break_minutes: descansoPagado,
      unpaid_break_minutes: descansoNoPagado,
      net_minutes: netos,
      needs_review: revisar,
      flags: sinTurno ? ['unscheduled'] : revisar ? ['late_arrival'] : [],
    });

    // La misma nota que arriba: solo la tiene «Otro», que es el único motivo que la pide.
    const nota = motivo === 'other' ? (NOTAS_DEMO[persona % NOTAS_DEMO.length] ?? null) : null;

    intervalos.push({
      id: pausaId(contadorSesion),
      work_session_id: sesionId(contadorSesion),
      organization_id: DEMO_ORG_ID,
      employee_id: empleadoId(persona + 1),
      starts_at: aISO(inicioPausa),
      ends_at: aISO(finPausa),
      duration_minutes: minutosPausa,
      break_type: tipoPausa,
      break_reason: motivo,
      break_note: nota,
    });

    // Del MISMO intervalo, por lo mismo que arriba: el gráfico de motivos no puede
    // discrepar de las pausas que lo alimentan.
    pausasPorMotivo.push({
      organization_id: DEMO_ORG_ID,
      location_id: ubicacion,
      employee_id: empleadoId(persona + 1),
      work_date: fechaClave(hoy),
      break_reason: motivo,
      break_type: tipoPausa,
      pauses: 1,
      minutes: minutosPausa,
      notes: nota === null ? [] : [{ at: aISO(inicioPausa), minutes: minutosPausa, note: nota }],
    });

    for (const [tipo, cuando, descanso] of [
      ['clock_in', entrada, null],
      ['break_start', inicioPausa, tipoPausa],
      ['break_end', finPausa, tipoPausa],
      ['clock_out', salida, null],
    ] as const) {
      contadorEvento += 1;
      eventos.push({
        id: eventoId(contadorEvento),
        organization_id: DEMO_ORG_ID,
        employee_id: empleadoId(persona + 1),
        location_id: ubicacion,
        event_type: tipo,
        break_type: descanso,
        occurred_at: aISO(cuando),
        source: 'kiosk',
        is_offline: false,
      });
    }
  }

  // Hoy: gente dentro ahora mismo, que es lo que hace viva la pantalla de inicio.
  const enCurso = [
    { persona: 0, entradaHace: 185, enDescanso: false },
    { persona: 1, entradaHace: 142, enDescanso: true },
    { persona: 2, entradaHace: 96, enDescanso: false },
    { persona: 4, entradaHace: 41, enDescanso: false },
  ];

  for (const quien of enCurso) {
    contadorSesion += 1;
    const entrada = new Date(ahora.getTime() - quien.entradaHace * 60000);
    const ubicacion = quien.persona % 3 === 2 ? DEMO_LOCATION_2 : DEMO_LOCATION_1;
    const inicioDescanso = quien.enDescanso ? new Date(ahora.getTime() - 12 * 60000) : null;

    sesiones.push({
      id: sesionId(contadorSesion),
      organization_id: DEMO_ORG_ID,
      employee_id: empleadoId(quien.persona + 1),
      location_id: ubicacion,
      shift_id: null,
      starts_at: aISO(entrada),
      ends_at: null,
      gross_minutes: null,
      paid_break_minutes: 0,
      unpaid_break_minutes: 0,
      net_minutes: null,
      status: 'open',
      flags: [],
      updated_at: aISO(entrada),
    });

    contadorEvento += 1;
    eventos.push({
      id: eventoId(contadorEvento),
      organization_id: DEMO_ORG_ID,
      employee_id: empleadoId(quien.persona + 1),
      location_id: ubicacion,
      event_type: 'clock_in',
      break_type: null,
      occurred_at: aISO(entrada),
      source: 'kiosk',
      is_offline: false,
    });

    const persona = PERSONAS[quien.persona];
    trabajandoAhora.push({
      organization_id: DEMO_ORG_ID,
      location_id: ubicacion,
      work_session_id: sesionId(contadorSesion),
      employee_id: empleadoId(quien.persona + 1),
      full_name: persona?.nombre ?? 'Empleado',
      preferred_name: persona?.corto ?? null,
      starts_at: aISO(entrada),
      shift_id: null,
      break_started_at: inicioDescanso === null ? null : aISO(inicioDescanso),
      attendance_state: quien.enDescanso ? 'ON_BREAK' : 'WORKING',
    });
  }

  // --------------------------------------------------------- solicitudes
  const solicitudes: Fila[] = [
    {
      id: solicitudId(1),
      organization_id: DEMO_ORG_ID,
      employee_id: empleadoId(3),
      location_id: DEMO_LOCATION_2,
      work_session_id: sesionId(3),
      target_date: fechaClave(sumarDias(hoy, -1)),
      kind: 'forgot_clock_out',
      proposed_value: { endsAt: aISO(conHora(sumarDias(hoy, -1), 14, 30)) },
      reason: 'Se me olvidó marcar la salida, cerré la caja a las 2:30.',
      status: 'pending',
      reviewer_comment: null,
      reviewed_at: null,
      created_at: aISO(sumarDias(ahora, -1)),
    },
    {
      id: solicitudId(2),
      organization_id: DEMO_ORG_ID,
      employee_id: empleadoId(5),
      location_id: DEMO_LOCATION_1,
      work_session_id: null,
      target_date: fechaClave(sumarDias(hoy, -2)),
      kind: 'forgot_clock_in',
      proposed_value: { startsAt: aISO(conHora(sumarDias(hoy, -2), 8, 0)) },
      reason: 'El iPad estaba apagado cuando llegué.',
      status: 'pending',
      reviewer_comment: null,
      reviewed_at: null,
      created_at: aISO(sumarDias(ahora, -2)),
    },
  ];

  // --------------------------------------------------------- correcciones
  const correcciones: Fila[] = [
    {
      id: id('bbbbbbbb', 1),
      organization_id: DEMO_ORG_ID,
      work_session_id: sesionId(2),
      target_type: 'work_session',
      before_value: { ends_at: aISO(conHora(sumarDias(hoy, -3), 14, 0)) },
      after_value: { ends_at: aISO(conHora(sumarDias(hoy, -3), 14, 45)) },
      reason: 'Se quedó cerrando inventario y marcó tarde.',
      created_at: aISO(sumarDias(ahora, -3)),
      channel: 'manager',
      author_name: 'Andree (demostración)',
    },
  ];

  // -------------------------------------------------------------- períodos
  const periodos: Fila[] = [
    {
      id: id('cccccccc', 1),
      organization_id: DEMO_ORG_ID,
      location_id: DEMO_LOCATION_1,
      starts_on: fechaClave(lunes),
      ends_on: fechaClave(sumarDias(lunes, 6)),
      status: 'open',
      approved_at: null,
    },
    {
      id: id('cccccccc', 2),
      organization_id: DEMO_ORG_ID,
      location_id: DEMO_LOCATION_1,
      starts_on: fechaClave(sumarDias(lunes, -7)),
      ends_on: fechaClave(sumarDias(lunes, -1)),
      status: 'approved',
      approved_at: aISO(sumarDias(lunes, -1)),
    },
  ];

  // ---------------------------------------------------------------- kioscos
  const kioscos: Fila[] = [
    {
      id: id('dddddddd', 1),
      organization_id: DEMO_ORG_ID,
      display_name: 'iPad mostrador',
      location_id: DEMO_LOCATION_1,
      location_name: 'Sede Principal',
      device_public_id: 'demo-kiosk-main',
      status: 'active',
      app_version: '1.0.0',
      last_seen_at: aISO(new Date(ahora.getTime() - 3 * 60000)),
      last_sync_at: null,
      minutes_since_seen: 3,
      minutes_since_sync: null,
    },
    {
      id: id('dddddddd', 2),
      organization_id: DEMO_ORG_ID,
      display_name: 'iPad almacén',
      location_id: DEMO_LOCATION_2,
      location_name: 'Sucursal Miraflores',
      device_public_id: 'demo-kiosk-almacen',
      status: 'active',
      app_version: '1.0.0',
      last_seen_at: aISO(new Date(ahora.getTime() - 190 * 60000)),
      last_sync_at: aISO(new Date(ahora.getTime() - 190 * 60000)),
      minutes_since_seen: 190,
      minutes_since_sync: 190,
    },
  ];

  const almacen: Almacen = new Map<string, Fila[]>();
  almacen.set('organizations', [
    {
      id: DEMO_ORG_ID,
      name: 'Café Demostración',
      default_locale: 'es',
      default_timezone: TZ,
      week_starts_on: 1,
      logo_path: null,
    },
  ]);
  almacen.set('organization_memberships', [
    {
      organization_id: DEMO_ORG_ID,
      user_id: DEMO_USER_ID,
      role: 'owner',
      // `status` y `created_at` NO son adorno: la consulta de alcance filtra por
      // `status = 'active'` y ordena por `created_at`. Sin ellos la fila existe pero no
      // la alcanza ningún filtro, no hay membresía, y la app entera responde «falta un
      // permiso». Pasó tal cual la primera vez que se probó esto.
      status: 'active',
      created_at: aISO(sumarDias(hoy, -400)),
    },
  ]);
  almacen.set('profiles', [{ id: DEMO_USER_ID, full_name: 'Andree (demostración)', locale: 'es' }]);
  almacen.set('locations', [
    {
      id: DEMO_LOCATION_1,
      organization_id: DEMO_ORG_ID,
      name: 'Sede Principal',
      address: 'Av. Larco 345, Miraflores',
      timezone: TZ,
      is_active: true,
      settings: { photoEnabled: false, pinLength: 6 },
    },
    {
      id: DEMO_LOCATION_2,
      organization_id: DEMO_ORG_ID,
      name: 'Sucursal Miraflores',
      address: 'Calle Berlín 1002',
      timezone: TZ,
      is_active: true,
      settings: { photoEnabled: true, pinLength: 6, lateGraceMinutes: 10 },
    },
  ]);
  almacen.set('employees', empleados);
  almacen.set('job_roles', puestos);
  almacen.set('employee_location_assignments', asignaciones);
  almacen.set('employee_job_roles', puestosDeEmpleado);
  almacen.set('shifts', turnos);
  almacen.set('shift_publications', publicaciones);
  almacen.set('time_events', eventos);
  almacen.set('work_sessions', sesiones);
  almacen.set('time_edit_requests', solicitudes);
  almacen.set('timesheet_periods', periodos);
  almacen.set('notification_preferences', []);
  almacen.set('push_tokens', []);
  almacen.set('announcements', []);
  almacen.set('audit_logs', []);
  almacen.set('break_intervals', intervalos);
  almacen.set('time_adjustments', correcciones);

  // Vistas: aquí son tablas de solo lectura ya calculadas. La base las deriva con SQL.
  almacen.set('employees_working_now', trabajandoAhora);
  almacen.set('daily_time_summary', resumenDiario);
  almacen.set('break_time_by_reason', pausasPorMotivo);
  almacen.set('time_adjustments_with_author', correcciones);
  almacen.set('kiosk_devices_admin', kioscos);

  return almacen;
}
