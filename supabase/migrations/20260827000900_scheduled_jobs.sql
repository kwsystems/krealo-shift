-- Krealo Shift — trabajos recurrentes (§22)
--
-- QUÉ FALTABA
-- `purge_expired_attendance_photos()` estaba escrita y probada, pero nada la
-- llamaba. Una purga que nadie ejecuta es exactamente igual que no tener purga:
-- las fotos del personal se quedan para siempre.
--
-- POR QUÉ ESTO ES UNA MIGRACIÓN Y NO UNA NOTA EN EL README
-- Porque una nota en el README se olvida en el despliegue, y lo que se olvida aquí
-- son fotos de las caras de las personas guardadas indefinidamente. Si `pg_cron`
-- está disponible, esta migración lo programa sola.
--
-- SI `pg_cron` NO ESTÁ (no todos los planes de Supabase lo traen), la migración no
-- falla: avisa y deja escrito qué hay que hacer a mano. Que se aplique igual
-- importa, porque si no, ninguna migración posterior corre.

do $$
declare
  v_has_cron boolean;
begin
  select exists (
    select 1 from pg_available_extensions where name = 'pg_cron'
  ) into v_has_cron;

  if not v_has_cron then
    raise notice
      'pg_cron no disponible: la purga de fotos NO queda programada. '
      'Hay que llamar a purge_expired_attendance_photos() a diario desde fuera '
      '(un Scheduled Function de Supabase, o cron propio con la service_role). '
      'Sin eso las fotos del personal se guardan indefinidamente.';
    return;
  end if;

  create extension if not exists pg_cron;

  -- Se borra antes de crear para que aplicar la migración dos veces no deje dos
  -- trabajos haciendo lo mismo.
  perform cron.unschedule('krealo-shift-purgar-fotos')
    where exists (
      select 1 from cron.job where jobname = 'krealo-shift-purgar-fotos'
    );

  -- A las 03:15 UTC, o sea las 22:15 en Lima: fuera del horario de cualquier
  -- tienda. Borrar archivos mientras alguien ficha no rompe nada, pero no hay
  -- ninguna razón para hacerlo en hora punta.
  --
  -- Diario y no cada hora: el plazo se mide en días, así que correr más seguido
  -- solo gasta. Y si un día falla, al siguiente recoge lo que quedó, porque la
  -- función busca por fecha y no lleva marcador de progreso.
  perform cron.schedule(
    'krealo-shift-purgar-fotos',
    '15 3 * * *',
    $job$ select public.purge_expired_attendance_photos(); $job$
  );

  raise notice 'Purga de fotos programada a diario (03:15 UTC).';
end
$$;
