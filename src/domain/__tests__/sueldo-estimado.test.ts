import { RMV, vigenteEn } from '../ley-laboral-peru';
import { pagoDeHorasExtraDelDia, sueldoEstimado } from '../sueldo-estimado';

/**
 * El sueldo aproximado del mes (13-oct), con cuentas hechas a mano. S/ 1,500 al mes: el
 * día vale 50 y la hora 6.25.
 */

const OCTUBRE = { desde: '2026-10-01', hasta: '2026-10-31' };
const base = (extra: Partial<Parameters<typeof sueldoEstimado>[0]> = {}) =>
  sueldoEstimado({
    datos: { sueldoMensual: 1500, asignacionFamiliar: false, pension: null },
    mes: OCTUBRE,
    faltas: [],
    extrasPorDia: [],
    feriadosTrabajados: 0,
    minutosQueDebe: 0,
    ...extra,
  });

describe('las cifras de la ley, con su fecha', () => {
  it('el sueldo mínimo es el vigente ese día', () => {
    expect(vigenteEn(RMV, '2026-09-30').valor).toBe(1130);
    expect(vigenteEn(RMV, '2026-10-01').valor).toBe(1230);
  });
});

describe('el sueldo aproximado del mes', () => {
  it('sin nada que sumar ni descontar es su sueldo, tenga el mes 31 días', () => {
    expect(base()).toMatchObject({ base: 1500, diasPagados: 30, bruto: 1500, neto: null });
  });

  it('la asignación familiar es el 10 % de la RMV de ese mes', () => {
    expect(
      base({ datos: { sueldoMensual: 1500, asignacionFamiliar: true, pension: null } }),
    ).toMatchObject({ asignacionFamiliar: 123, bruto: 1623, rmv: { valor: 1230 } });
    expect(
      base({
        datos: { sueldoMensual: 1500, asignacionFamiliar: true, pension: null },
        mes: { desde: '2026-09-01', hasta: '2026-09-30' },
      }).asignacionFamiliar,
    ).toBe(113);
  });

  it('una falta sin justificar descuenta su día y un sexto del descanso: 50 + 8.33', () => {
    const r = base({ faltas: [{ estado: 'injustificada' }, { estado: 'injustificada' }] });
    expect(r.faltas).toEqual({ dias: 2, monto: 116.67 });
    expect(r.bruto).toBe(1383.33);
  });

  it('la que nadie ha revisado descuenta igual, aparte; la justificada no descuenta', () => {
    const r = base({ faltas: [{ estado: 'sinRevisar' }, { estado: 'justificada' }] });
    expect(r.faltasSinRevisar).toEqual({ dias: 1, monto: 58.33 });
    expect(r.faltasJustificadas).toBe(1);
    expect(r.bruto).toBe(1441.67);
  });

  it('horas extra: las dos primeras al 25 %, la tercera al 35 %', () => {
    // 2 h × 6.25 × 1.25 = 15.625; 1 h × 6.25 × 1.35 = 8.4375.
    expect(pagoDeHorasExtraDelDia(180, 6.25)).toBeCloseTo(24.0625);
    expect(base({ extrasPorDia: [180, 60] }).horasExtra).toEqual({
      minutos: 240,
      monto: 31.88,
    });
  });

  it('un feriado trabajado suma dos días: con el que ya va en el sueldo, el triple', () => {
    expect(base({ feriadosTrabajados: 1 }).feriados).toEqual({ dias: 1, monto: 100 });
  });

  it('las horas que debe se descuentan a su valor', () => {
    expect(base({ minutosQueDebe: 120 }).horasQueDebe).toEqual({ minutos: 120, monto: 12.5 });
  });

  it('con ONP, el neto es el bruto menos el 13 %', () => {
    const r = base({ datos: { sueldoMensual: 1500, asignacionFamiliar: false, pension: 'onp' } });
    expect(r.pension).toEqual({ sistema: 'onp', monto: 195 });
    expect(r.neto).toBe(1305);
  });

  it('si entró a mitad de mes cobra los días en que tuvo contrato', () => {
    expect(base({ ingreso: '2026-10-17' })).toMatchObject({ diasPagados: 15, base: 750 });
  });

  it('si se fue a mitad de mes, también', () => {
    expect(base({ baja: '2026-10-10' })).toMatchObject({ diasPagados: 10, base: 500 });
  });

  it('un mes de faltas no deja el sueldo en negativo', () => {
    const faltas = Array.from({ length: 30 }, () => ({ estado: 'injustificada' as const }));
    expect(base({ faltas }).bruto).toBe(0);
  });

  it('avisa si el sueldo es menor que la RMV', () => {
    expect(
      base({ datos: { sueldoMensual: 1130, asignacionFamiliar: false, pension: null } })
        .menorQueLaRmv,
    ).toBe(true);
    expect(base().menorQueLaRmv).toBe(false);
  });
});
