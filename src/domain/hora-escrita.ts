/**
 * UNA HORA, COMO LA ESCRIBE UNA PERSONA (8-oct). Un solo lector para todos los campos de
 * hora: corregir un fichaje, el fichaje manual, el turno, la disponibilidad, la Bandeja y el
 * reloj. Antes solo el reloj entendía «8.30» o «0830»; en Horas, «18.30» dejaba el botón vivo
 * y no pasaba nada, y en el celular «9:00» no valía porque se exigía «09:00».
 *
 * Vale: «9», «18», «9:00», «09:00», «18.30», «18,30», «18h30», «930», «1830», «6pm»,
 * «6:30 pm», «6:30 p. m.». Devuelve siempre «HH:MM», que es lo que se guarda.
 */
export function horaEscrita(texto: string): string | null {
  // «p. m.» y «p.m.» son «pm»; el punto de «18.30» separa horas y minutos.
  let limpio = texto
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/([ap])\.?m\.?$/, '$1m');
  let meridiano: 'am' | 'pm' | null = null;
  const sufijo = /(am|pm)$/.exec(limpio);
  if (sufijo !== null) {
    meridiano = sufijo[1] as 'am' | 'pm';
    limpio = limpio.slice(0, -2);
  }

  let horas: number;
  let minutos: number;
  const separada = /^(\d{1,2})[:.,h](\d{2})$/.exec(limpio);
  const pegada = /^(\d{1,2})(\d{2})$/.exec(limpio);
  const sola = /^(\d{1,2})h?$/.exec(limpio);
  if (separada !== null) {
    horas = Number(separada[1]);
    minutos = Number(separada[2]);
  } else if (pegada !== null) {
    horas = Number(pegada[1]);
    minutos = Number(pegada[2]);
  } else if (sola !== null) {
    horas = Number(sola[1]);
    minutos = 0;
  } else {
    return null;
  }

  if (meridiano !== null) {
    if (horas < 1 || horas > 12) return null;
    horas = (horas % 12) + (meridiano === 'pm' ? 12 : 0);
  }
  if (horas > 23 || minutos > 59) return null;
  return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}
