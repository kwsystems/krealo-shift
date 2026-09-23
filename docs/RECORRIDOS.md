# Los nueve recorridos que hay que proteger

Esto era `e2e/`: ocho flujos de Maestro que describían los recorridos que no se pueden
romper nunca. Estaban bien pensados y **jamás se ejecutaron**: Maestro maneja un
simulador o un aparato real, no había simulador de iOS en un runner de Linux, y desde
que el reloj es la web tampoco hay aplicación nativa que manejar.

Ocho pruebas que no corren protegen exactamente lo mismo que ocho que no existen. Así que
el YAML se fue y los recorridos se quedan aquí, con **lo que de verdad los cubre hoy** y,
donde no hay nada, dicho sin adornos.

La decisión y su porqué están en `docs/DECISIONES.md`.

---

## 1. Jornada completa en el reloj: entrada, pausa, vuelta, salida

**Cubierto.** `submit-time-event.test.ts` contra el emulador ejercita la secuencia con
PIN y token de acción de verdad, incluida la idempotencia del doble toque.
`kiosco:check` recorre el reloj en Chromium en seis tamaños y dos temas, y `salida:check`
ficha una jornada de punta a punta y comprueba que aparece en el panel.

## 2. Salida sin conexión y que la sincronización NO duplique

**Cubierto por partes, y la parte que falta no se puede probar hoy.**

El lado del servidor sí: `sync-offline-events.test.ts` tiene ocho casos contra el
emulador, entre ellos que un lote reenviado no duplica horas ni contra un fichaje en
línea, que un evento inválido no corta el lote, y que el orden lo decide
`deviceSequence`. El lado del cliente también, por unidades: la migración de la cola, el
backoff y la firma.

Lo que no está cubierto es el viaje completo sin red desde el navegador, y **no se puede
estar**: `permiteFicharSinRed` es `false` en web. La cola vive en el código y vuelve
entera en cuanto haya aplicación nativa; ese día este recorrido hay que rehacerlo.

## 3. El reloj no ficha por alguien de otra sede

**Cubierto.** `sync-offline-events.test.ts` comprueba que un id de empleado que no es de
esa sede se rechaza y no escribe nada, y el propio `kiosk-api` filtra por el conjunto de
gente de la tienda antes de aceptar un lote.

## 4. Un reloj revocado no registra nada

**Cubierto.** `verify-pin.test.ts` comprueba que un reloj revocado no entra aunque su
credencial siga siendo buena.

## 5. El gerente corrige un fichaje y queda auditoría

**Cubierto.** `manager-adjust-time.test.ts` contra el emulador, y
`reclasificar-salida.test.ts` cubre además el caso nuevo de reclasificar una salida como
pausa: los eventos originales intactos y la corrección como fila nueva con su autor.

## 6. Copiar una semana de horario y publicarla

**No cubierto de punta a punta.** Hay pruebas de la forma del turno
(`forma-del-turno.test.ts`) y el arnés `demo:check` comprueba que la pantalla de Horario
tiene contenido, pero nadie copia una semana y la publica en un navegador.

Relacionado con la tarea de la etiqueta «Cambiado», que necesita una Cloud Function de
publicación: cuando se haga, este recorrido es su prueba natural.

## 7. Cambio de idioma es-EN

**Cubierto.** `interaccion-check.mjs` cambia el idioma en el navegador y comprueba que la
pantalla responde.

## 8. Un PIN de empleado no abre rutas de administración

**Cubierto por el lado que importa.** Las reglas de Firestore son lo que de verdad lo
impide, y `reglas.test.ts` las ejercita contra el emulador: un cliente sin la sesión
correcta no lee el hash del PIN, ni los fichajes, ni la gente de otra organización.

La navegación —que la ruta no se pinte— es una comodidad; la barrera es la regla. Un PIN
de empleado no crea sesión de Firebase en ningún momento, así que no hay nada que pueda
autorizar.

## 9. Tener dos empresas: crear la segunda, entrar en ella y que se recuerde

**Cubierto, y es nuevo del 2026-09-23.** No estaba en los ocho de Maestro porque hasta
ese día la app no lo permitía: no había función que creara una empresa —la que existe se
escribió a mano en la consola de Firebase— y el panel leía tus membresías con `.limit(1)`
ordenado por fecha, así que se quedaba con la más vieja y la segunda era invisible.

Lo cubren tres capas, y hacen falta las tres:

- `dos-empresas.test.ts` contra el emulador: que `createOrganization` escriba empresa,
  membresía de dueño y primera sede en una transacción, que solo pueda llamarla quien ya
  es dueño de otra, que rechace una zona horaria que `Intl` no acepta, y que
  `viewTimeAdjustmentsWithAuthor` conteste sobre la empresa de la SESIÓN con un usuario
  que pertenece a dos —el caso que ninguna prueba tenía antes—.
- `empresa-elegida` y `empresa-recordada` por unidades: la regla que elige empresa, y que
  la elección sobreviva a una recarga sin que cambiar el tema la borre.
- `empresas:check` en Chromium: que el selector NO salga con una sola empresa, que el
  alta esté a la vista, que crear una la deje elegible, que elegirla cambie la cabecera
  del panel —empresa y sede— y que la elección siga guardada después de recargar.

La tercera capa es la que encontró el fallo real: el alta simulada de la demostración
estaba en el despachador equivocado y el botón daba «algo no salió bien». Los dos
despachadores toman un string, así que el compilador no tenía nada que decir.

---

## Lo que queda sin red y por qué se dice aquí

| Recorrido        | Estado                                                           |
| ---------------- | ---------------------------------------------------------------- |
| 1, 3, 4, 5, 7, 9 | cubiertos con emulador y/o Chromium                              |
| 8                | cubierto por las reglas, que es la barrera real                  |
| 6                | **sin cubrir**: nadie copia y publica una semana en un navegador |
| 2                | **imposible hoy**: fichar sin red no existe en web               |

Dos huecos, los dos escritos. Es más de lo que había cuando existían los ocho ficheros.
