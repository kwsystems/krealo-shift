/**
 * La configuración del entorno acepta el `.env` que el README manda crear (§30).
 *
 * ESTA PRUEBA EXISTE POR UN FALLO EN EL CAMINO DOCUMENTADO, que es el peor sitio donde
 * puede haber uno. El README dice «copia `.env.example` a `.env`», y `.env.example` trae
 * `EXPO_PUBLIC_SUPPORT_EMAIL=` y `EXPO_PUBLIC_PRIVACY_URL=` en blanco, porque una
 * plantilla no puede traer el correo de soporte de nadie.
 *
 * `.optional()` de Zod NO cubre la cadena vacía: solo cubre `undefined`. Así que las dos
 * llegaban como `''`, fallaban `.email()` y `.url()`, y la app arrancaba diciendo «Falta
 * configuración del entorno» y nombrando dos variables que ni siquiera son obligatorias.
 * Quien lo viera pensaría que le falta algo más que conseguir.
 *
 * Se encontró clonando el repositorio desde cero y haciendo exactamente lo que dice el
 * README, no leyéndolo.
 */

/** Las seis de Firebase, con la forma que tienen de verdad. */
const FIREBASE_OK = {
  EXPO_PUBLIC_FIREBASE_API_KEY: 'AIzaSyBejemploDeClaveDeApiSuficientementeLarga',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'krealo-shift.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'krealo-shift',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'krealo-shift.firebasestorage.app',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '577753574972',
  EXPO_PUBLIC_FIREBASE_APP_ID: '1:577753574972:web:ejemplo',
};

/** Recarga `env.ts`, que lee `process.env` al importarse. */
function cargarEntorno(vars: Record<string, string | undefined>) {
  jest.resetModules();
  for (const [clave, valor] of Object.entries(vars)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../env') as typeof import('../env');
}

const CLAVES = [
  'EXPO_PUBLIC_APP_ENV',
  ...Object.keys(FIREBASE_OK),
  'EXPO_PUBLIC_SUPPORT_EMAIL',
  'EXPO_PUBLIC_PRIVACY_URL',
];

describe('variables de entorno', () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const clave of CLAVES) delete process.env[clave];
    Object.assign(process.env, original);
  });

  it('EL .env QUE MANDA EL README vale: opcionales en blanco y las de Firebase puestas', () => {
    const { isEnvConfigured, missingEnvKeys, env } = cargarEntorno({
      ...FIREBASE_OK,
      EXPO_PUBLIC_APP_ENV: 'development',
      EXPO_PUBLIC_SUPPORT_EMAIL: '',
      EXPO_PUBLIC_PRIVACY_URL: '',
    });

    expect(missingEnvKeys).toEqual([]);
    expect(isEnvConfigured).toBe(true);
    // Y en blanco significa "usa el valor por defecto", no "cadena vacía".
    expect(env.EXPO_PUBLIC_SUPPORT_EMAIL).toBe('soporte@krealomedia.com');
    expect(env.EXPO_PUBLIC_PRIVACY_URL).toBe('https://krealomedia.com/privacidad');
  });

  it('un valor puesto de verdad se respeta', () => {
    const { env } = cargarEntorno({
      ...FIREBASE_OK,
      EXPO_PUBLIC_SUPPORT_EMAIL: 'ayuda@krealoshift.com',
      EXPO_PUBLIC_PRIVACY_URL: 'https://krealoshift.com/privacidad',
    });

    expect(env.EXPO_PUBLIC_SUPPORT_EMAIL).toBe('ayuda@krealoshift.com');
  });

  it('un correo MAL escrito sigue fallando: vacío no es lo mismo que inválido', () => {
    // La corrección no puede volverse un "acepta cualquier cosa". Un valor puesto y
    // equivocado tiene que decirse, porque es un error de tecleo que alguien puede
    // arreglar.
    const { missingEnvKeys } = cargarEntorno({
      ...FIREBASE_OK,
      EXPO_PUBLIC_SUPPORT_EMAIL: 'esto-no-es-un-correo',
    });

    expect(missingEnvKeys).toContain('EXPO_PUBLIC_SUPPORT_EMAIL');
  });

  it('las OBLIGATORIAS vacías siguen fallando, y se nombran TODAS', () => {
    /*
     * Aquí una cadena vacía SÍ es un error: sin proyecto no hay a dónde conectarse. Y
     * se nombran todas: una versión anterior filtraba por código de error y con un
     * valor vacío nombraba solo algunas, así que alguien pegaba esas, volvía a arrancar
     * y seguía sin funcionar. Con seis variables en vez de dos, enumerar la mitad
     * costaría tres ciclos de prueba y error en vez de uno.
     */
    const vacias = Object.fromEntries(Object.keys(FIREBASE_OK).map((clave) => [clave, '']));
    const { isEnvConfigured, missingEnvKeys } = cargarEntorno(vacias);

    expect(isEnvConfigured).toBe(false);
    for (const clave of Object.keys(FIREBASE_OK)) {
      expect(missingEnvKeys).toContain(clave);
    }
  });

  it('el entorno de la app en blanco cae a development', () => {
    const { env } = cargarEntorno({ ...FIREBASE_OK, EXPO_PUBLIC_APP_ENV: '' });
    expect(env.EXPO_PUBLIC_APP_ENV).toBe('development');
  });
});
