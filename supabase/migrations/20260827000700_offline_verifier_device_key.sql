-- Krealo Shift — verificador offline ligado a la clave del dispositivo (§8)
--
-- QUÉ CAMBIA Y POR QUÉ
-- La versión anterior entregaba al iPad el hash bcrypt del PIN, que quedaba en su
-- SQLite. Eso tenía un agujero concreto: un archivo SQLite se exfiltra mucho más
-- fácil que el Keychain —un backup sin cifrar, un bug de compartición de
-- archivos— y con el hash en mano se prueban los 10⁶ PIN posibles sin límite.
--
-- Ahora el servidor NO manda el hash. Manda dos cosas:
--   * el `salt` de bcrypt, que por sí solo no permite verificar nada;
--   * un verificador derivado con una clave propia del dispositivo.
--
-- El iPad calcula `bcrypt(PIN_tecleado, salt)` y lo vuelve a derivar con su clave,
-- que vive en el Keychain de iOS. Robar el archivo SQLite deja de servir: sin la
-- clave, no se puede comprobar ni un intento.
--
-- Esto es lo que pide la especificación §8: "un verificador derivado y ligado al
-- dispositivo, emitido por servidor, con clave del dispositivo en SecureStore".
--
-- SOBRE LA CONSTRUCCIÓN DEL VERIFICADOR
-- Es un digest con clave —`sha256(clave || ':' || hash)`— y no un HMAC formal. El
-- motivo es práctico y se dice claro: `expo-crypto` solo expone digest sobre
-- cadenas UTF-8, así que un HMAC real (con su relleno de bloques sobre bytes
-- crudos) no se puede calcular igual en los dos lados sin agregar otra
-- dependencia de criptografía al dispositivo. La debilidad conocida de un digest
-- con clave frente a HMAC es la extensión de longitud, que aquí no aplica: no hay
-- ningún escenario en que un atacante quiera extender el mensaje, porque el
-- mensaje es un hash bcrypt de formato fijo y la comparación es de igualdad. Si
-- más adelante se agrega una librería con HMAC, cambiar las dos líneas de las dos
-- puntas es directo.
--
-- LO QUE SIGUE COSTANDO, DICHO SIN ADORNOS
-- Quien logre extraer TAMBIÉN la clave del Keychain —lo que exige acceso físico y
-- jailbreak, no solo un backup— vuelve al escenario anterior: fuerza bruta de
-- 10⁶ PIN a bcrypt coste 10, o sea horas por empleado. Revocar el dispositivo lo
-- corta de inmediato, porque un kiosco revocado deja de recibir verificadores.

-- ---------------------------------------------------------------------------
-- Clave de derivación por dispositivo
-- ---------------------------------------------------------------------------

alter table kiosk_devices
  add column if not exists offline_key text;

comment on column kiosk_devices.offline_key is
  'Clave aleatoria por dispositivo para derivar los verificadores offline del PIN. '
  'Se entrega al iPad una sola vez al activarse y alli vive en el Keychain. '
  'Guardarla aqui no agrega exposicion: quien tenga esta base ya tiene los hashes.';

-- Los dispositivos ya activados no tienen clave. Se les genera una: en su
-- siguiente refresco recibirán verificadores nuevos, y hasta entonces validan
-- online, que es el comportamiento que ya tenían.
update kiosk_devices
  set offline_key = encode(extensions.gen_random_bytes(32), 'hex')
  where offline_key is null;

-- ---------------------------------------------------------------------------
-- Activación: la clave se emite una sola vez
-- ---------------------------------------------------------------------------

-- `create or replace` no puede cambiar el tipo de fila que definen los parametros
-- OUT, y aqui se agrega `offline_key` al resultado. Hay que soltarla primero.
-- Es seguro: no tiene ningun `grant`, solo el `revoke all from public` que se
-- vuelve a aplicar abajo.
drop function if exists activate_kiosk_device(text, text, text, text);

create function activate_kiosk_device(
  p_code text,
  p_installation_id text,
  p_display_name text,
  p_app_version text
)
returns table (
  device_id uuid,
  device_public_id text,
  credential text,
  offline_key text,
  organization_id uuid,
  location_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_credential text;
  v_offline_key text;
  v_public_id text;
  v_device_id uuid;
begin
  select * into v_row
  from public.kiosk_activation_codes c
  where c.expires_at > now()
    and c.used_count < c.max_uses
    and c.code_hash = extensions.crypt(p_code, c.code_hash)
  limit 1;

  if v_row is null then
    raise exception 'Código de activación inválido o vencido.'
      using errcode = 'invalid_authorization_specification';
  end if;

  v_credential := encode(extensions.gen_random_bytes(32), 'hex');
  -- Clave SEPARADA de la credencial. Antes se reutilizaba la credencial como
  -- clave de derivación; separarlas significa que rotar una no invalida la otra,
  -- y que la credencial que viaja en cada petición no es la que protege los
  -- verificadores guardados.
  v_offline_key := encode(extensions.gen_random_bytes(32), 'hex');
  v_public_id := encode(extensions.gen_random_bytes(9), 'hex');

  insert into public.kiosk_devices
    (organization_id, location_id, display_name, device_public_id, credential_hash,
     offline_key, installation_id, app_version, last_seen_at, created_by)
  values
    (v_row.organization_id, v_row.location_id, coalesce(nullif(btrim(p_display_name), ''), 'iPad'),
     v_public_id, extensions.crypt(v_credential, extensions.gen_salt('bf', 10)),
     v_offline_key, p_installation_id, p_app_version, now(), v_row.created_by)
  returning id into v_device_id;

  update public.kiosk_activation_codes
    set used_count = used_count + 1
    where id = v_row.id;

  insert into public.audit_logs
    (organization_id, actor_device_id, action, entity_type, entity_id, after_data)
  values
    (v_row.organization_id, v_device_id, 'kiosk_activated', 'kiosk_device', v_device_id,
     jsonb_build_object('locationId', v_row.location_id, 'appVersion', p_app_version));

  return query select v_device_id, v_public_id, v_credential, v_offline_key,
                      v_row.organization_id, v_row.location_id;
end;
$$;

revoke all on function activate_kiosk_device(text, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- Verificadores: salt + valor derivado, nunca el hash
-- ---------------------------------------------------------------------------

/**
 * Verificadores offline para UN dispositivo activo.
 *
 * Devuelve el salt de bcrypt y el verificador derivado con la clave del
 * dispositivo. NO devuelve el hash: es la diferencia entre que robar el archivo
 * SQLite del iPad sirva de algo o no sirva de nada.
 *
 * Un dispositivo revocado no recibe nada, igual que antes.
 */
-- Mismo motivo que arriba: la tabla de retorno cambia de `pin_offline_hash` a
-- `pin_salt` + `pin_verifier`.
drop function if exists kiosk_offline_verifiers(uuid);

create function kiosk_offline_verifiers(p_device_id uuid)
returns table (
  employee_opaque_id text,
  pin_salt text,
  pin_verifier text,
  pin_length smallint,
  pin_version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device record;
begin
  select d.id, d.location_id, d.organization_id, d.status, d.offline_key
  into v_device
  from public.kiosk_devices d
  where d.id = p_device_id;

  if v_device.id is null or v_device.status <> 'active' then
    raise exception 'Este reloj fue desactivado.'
      using errcode = 'invalid_authorization_specification';
  end if;

  if v_device.offline_key is null then
    raise exception 'Este reloj no tiene clave de derivación. Vuelve a activarlo.'
      using errcode = 'invalid_authorization_specification';
  end if;

  return query
  select
    encode(extensions.digest(e.id::text, 'sha256'), 'hex'),
    -- El salt de bcrypt son los primeros 29 caracteres del hash: $2a$10$ + 22 de
    -- salt. Por si solo no permite verificar nada.
    substring(c.pin_offline_hash from 1 for 29),
    -- Digest con clave del dispositivo. Las dos puntas calculan exactamente esto:
    -- sha256(clave || ':' || hash_bcrypt_completo).
    encode(
      extensions.digest(v_device.offline_key || ':' || c.pin_offline_hash, 'sha256'),
      'hex'
    ),
    c.pin_length,
    c.version
  from public.employee_pin_credentials c
  join public.employees e on e.id = c.employee_id
  join public.employee_location_assignments a on a.employee_id = e.id
  where a.location_id = v_device.location_id
    and e.status = 'active'
    and c.organization_id = v_device.organization_id
    and c.pin_offline_hash is not null;
end;
$$;

revoke all on function kiosk_offline_verifiers(uuid) from public;
-- Sin `grant`: solo la `service_role` de las Edge Functions la llama.
