-- Krealo Shift — quitar dos escrituras directas que saltaban la auditoría (§11.4, §15)
--
-- EL AGUJERO
-- Auditando las políticas tabla por tabla —la contraparte de lo que se hizo con las
-- funciones en `20260827001400`— aparecieron dos políticas que permitían escribir
-- directamente donde solo debe escribir el servidor:
--
-- 1. `work_sessions_manager_write` (UPDATE). Cualquier gerente podía hacer
--    `update work_sessions set net_minutes = ...` con una petición normal de la app,
--    SALTÁNDOSE `manager_adjust_time`. Y `manager_adjust_time` es lo único que
--    escribe el rastro que exige §11.4: valor anterior, valor nuevo, autor, fecha
--    del servidor, motivo, canal y referencia a la solicitud.
--
--    O sea: se podían cambiar las horas pagadas de una persona sin dejar ni una
--    fila de auditoría. En una revisión laboral, la diferencia entre "corregido con
--    motivo" y "cambiado sin rastro" es toda la diferencia.
--
-- 2. `time_adjustments_insert` (INSERT). Permitía fabricar filas de ajuste: afirmar
--    un cambio que no ocurrió, o ponerle un motivo falso a uno que sí. Un registro
--    de auditoría que el auditado puede escribir a mano no es auditoría.
--
-- POR QUÉ SE PUEDEN QUITAR SIN ROMPER NADA
-- Se comprobó en todo el código: NINGUNA parte del cliente escribe esas dos tablas.
-- Las escribe `manager_adjust_time` y `manager_add_time_event`, que son
-- `security definer` y por tanto corren con los permisos del dueño y no evalúan
-- políticas. El camino legítimo sigue igual; el que se cierra no lo usaba nadie.
--
-- `shift_publications_insert` SÍ SE QUEDA: ahí el panel inserta de verdad al
-- publicar un horario (`src/features/schedules/api.ts`), y el disparador
-- `stamp_shift_publication` sella la versión. Quitarla habría roto la publicación.
-- La diferencia importa: no se trata de cerrar todo, sino de cerrar lo que nadie
-- usa y que permite mentir.

drop policy if exists work_sessions_manager_write on work_sessions;

comment on table work_sessions is
  'Proyeccion recalculable de las jornadas. SOLO la escribe el servidor: '
  'apply_event_to_projection, rebuild_work_session y manager_adjust_time, todas '
  'security definer. NO tiene politica de UPDATE a proposito —la tuvo y era un '
  'agujero—: un update directo cambiaria las horas pagadas sin dejar el rastro que '
  'exige la seccion 11.4. Para corregir, manager_adjust_time.';

drop policy if exists time_adjustments_insert on time_adjustments;

comment on table time_adjustments is
  'Rastro auditable de cada correccion. SOLO lo escribe el servidor desde '
  'manager_adjust_time y manager_add_time_event. NO tiene politica de INSERT a '
  'proposito: un registro de auditoria que el auditado puede escribir a mano no es '
  'auditoria. Se lee, no se escribe.';
