/**
 * Interruptor del modo demostración.
 *
 * POR QUÉ EXISTE
 * Toda la app vive detrás de un inicio de sesión contra Supabase. Sin un proyecto
 * creado no hay contra qué autenticarse, así que abrir la web en un navegador
 * mostraba la pantalla de acceso y NADA MÁS: no es que faltaran pantallas, es que
 * no había forma de pasar de la primera. Para mirar la app, criticarla y decidir
 * sobre ella hacía falta primero montar una base de datos, que es justo al revés
 * de lo razonable.
 *
 * Con `EXPO_PUBLIC_DEMO=1` el cliente de Supabase se sustituye por uno en memoria
 * con datos sembrados. Se entra sin contraseña y se recorre la app entera.
 *
 * LO QUE NO ES
 * No es un backend: los datos viven en la memoria de la pestaña y se pierden al
 * recargar. No sustituye a RLS ni prueba nada sobre seguridad —el servidor de
 * verdad es la autoridad y aquí no hay servidor—. Sirve para VER, no para operar.
 *
 * Por eso la app enseña un aviso permanente cuando está en este modo: un tablero
 * con datos inventados que se confunda con datos reales es peor que no tenerlo.
 */
export const isDemoMode = process.env.EXPO_PUBLIC_DEMO === '1';
