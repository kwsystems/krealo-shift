#!/usr/bin/env python3
"""Genera `supabase/instalar-todo.sql`: las migraciones y el seed en un solo archivo.

POR QUE EXISTE
Sin la CLI de Supabase instalada, la unica forma de crear el esquema en un proyecto
nuevo es pegar SQL en el editor del panel. Pegar 17 archivos de uno en uno y en el
orden correcto es donde se equivoca cualquiera, asi que se pega uno solo.

POR QUE ES UN SCRIPT Y NO UN ARCHIVO ESCRITO A MANO
Es una copia de 235 KB de otros archivos. Una copia que nadie puede regenerar se
queda vieja en silencio: alguien cambia una migracion, el instalador sigue con la
version anterior, y el proyecto nuevo nace con un esquema que ya no es el del
repositorio. Con el generador, la verificacion es una linea:

    python3 scripts/generar-instalacion.py --verificar

que es lo que corre CI. Si alguien toco una migracion sin regenerar, falla ahi.

NO TRANSFORMA EL SQL. Concatena tal cual, en orden de nombre de archivo, que es el
mismo orden en que las aplica la CLI de Supabase. Reescribir el SQL al empaquetarlo
crearia una segunda version del esquema, y entonces habria dos verdades.
"""

import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
MIGRACIONES = RAIZ / 'supabase' / 'migrations'
SEED = RAIZ / 'supabase' / 'seed.sql'
SALIDA = RAIZ / 'supabase' / 'instalar-todo.sql'

REGLA = '-- ' + '=' * 74


def cabecera(total):
    return f"""-- =============================================================================
-- Krealo Shift — instalacion completa en un proyecto nuevo de Supabase
-- =============================================================================
--
-- QUE ES ESTE ARCHIVO
-- Las {total} migraciones del proyecto, en orden, mas los datos de demostracion. Todo
-- junto para poder pegarlo de una vez en el editor SQL de Supabase, que es lo que
-- hace falta cuando no se tiene la CLI instalada.
--
-- COMO SE USA
--   1. Entra a tu proyecto en supabase.com
--   2. Menu lateral -> SQL Editor -> New query
--   3. Pega TODO este archivo y pulsa Run
--
-- Tarda unos segundos. Al final deberia decir "Success. No rows returned".
--
-- ES PARA UN PROYECTO NUEVO, donde el esquema no esta instalado todavia. Si lo
-- ejecutas sobre uno que ya lo tiene, se detiene en el primer `create type` con
-- "type app_role already exists" y no cambia nada mas: los tipos y las tablas se
-- crean una sola vez a proposito, para no poder pisar datos reales por accidente.
-- Para empezar de cero, en Supabase: Project Settings -> General -> Reset database.
--
-- NO CONTIENE NINGUN SECRETO. Las credenciales de las Edge Functions se configuran
-- aparte, en el panel de Supabase.
--
-- DESPUES DE ESTO falta crear tu usuario para poder entrar: ver
-- supabase/crear-mi-usuario.sql.
--
-- ARCHIVO GENERADO. No se edita a mano: los cambios se hacen en
-- supabase/migrations/ o en supabase/seed.sql y se regenera con
--
--     python3 scripts/generar-instalacion.py
--
-- CI comprueba que este archivo coincide con las migraciones.
-- =============================================================================

"""


def bloque(titulo, cuerpo):
    return (
        f"\n\n{REGLA}\n-- {titulo}\n{REGLA}\n\n"
        + cuerpo.rstrip('\n')
        + '\n'
    )


def generar():
    migraciones = sorted(MIGRACIONES.glob('*.sql'))
    if not migraciones:
        sys.exit(f'No hay migraciones en {MIGRACIONES}')
    if not SEED.is_file():
        sys.exit(f'No encuentro {SEED}')

    partes = [cabecera(len(migraciones))]
    for m in migraciones:
        partes.append(bloque(f'MIGRACION: {m.name}', m.read_text(encoding='utf-8')))
    partes.append(bloque('DATOS DE DEMOSTRACION (supabase/seed.sql)',
                         SEED.read_text(encoding='utf-8')))
    return ''.join(partes)


if __name__ == '__main__':
    texto = generar()
    verificar = '--verificar' in sys.argv

    if verificar:
        actual = SALIDA.read_text(encoding='utf-8') if SALIDA.is_file() else None
        if actual == texto:
            print(f'{SALIDA.name} esta al dia.')
            sys.exit(0)
        print(
            f'{SALIDA.name} NO coincide con supabase/migrations/ ni con seed.sql.\n'
            'Alguien cambio una migracion sin regenerar el instalador. Corre:\n'
            '    python3 scripts/generar-instalacion.py',
            file=sys.stderr,
        )
        sys.exit(1)

    SALIDA.write_text(texto, encoding='utf-8')
    print(f'escrito {SALIDA.relative_to(RAIZ)} '
          f'({SALIDA.stat().st_size / 1024:.1f} KB, '
          f'{len(sorted(MIGRACIONES.glob("*.sql")))} migraciones + seed)')
