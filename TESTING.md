# Protocolo de pruebas — GreenWave PowerNode 6 (v1.1.3)

Objetivo: verificar que el on/off y el reporte de consumo por socket funcionan
correctamente tras los cambios de scoping por nodo, debounce y escalonado de
GETs, sin saturar la red Z-Wave.

Material recomendado: una carga fácil de identificar por su consumo (ej. una
lámpara de 40-60W) que puedas mover entre sockets, y acceso a los logs en vivo
(`npx homey app run --remote`, o Configuración > Apps > Greenwave Systems > Ver
logs en la app Homey).

---

## 0. Preparación

- [ ] Confirmar que el Homey tiene instalada la versión **1.1.3** (Ajustes de la
      app o `homey app info` / panel de developer).
- [ ] Abrir el stream de logs en una terminal aparte y dejarlo corriendo durante
      todas las pruebas: `npx homey app run --remote` (o simplemente ver logs
      desde la app Homey Developer Tools).
- [ ] Anotar qué dispositivo Homey corresponde a cada socket físico (S1–S6) del
      PowerNode-6 — apaga/enciende cada uno desde la app y confirma que el LED
      físico correcto responde.

---

## 1. On/Off básico, por socket

Para cada socket S1 a S6:

- [ ] Encender desde Homey → el LED/relé físico correcto se activa (no otro).
- [ ] Apagar desde Homey → el relé se desactiva.
- [ ] El capability `onoff` en la app se actualiza sin demora ni valores erróneos.
- [ ] En el log no aparece ningún error (`TRANSMIT_COMPLETE_NO_ACK` es aceptable
      y se registra como log informativo, no como fallo).

Adicional:
- [ ] Encender/apagar el **dispositivo raíz** (la regleta completa, no un socket
      individual) y confirmar que actúa como "todos" (según el comportamiento
      esperado del `SWITCH_BINARY` del nodo principal).

---

## 2. Consumo por socket — aislamiento correcto

Este es el punto crítico que motivó todos los fixes recientes (el bug de
firmware que mezclaba los reports de todos los sockets en el socket 1).

- [ ] Con **todos los sockets apagados**, confirmar que `measure_power` = 0W en
      los 6 sockets.
- [ ] Enchufar la carga de prueba en **Socket 2** y encenderlo.
      - [ ] Tras unos segundos, **solo Socket 2** debe mostrar el consumo real
        (~40-60W según la carga); S1, S3, S4, S5, S6 deben seguir en 0W.
      - [ ] Repetir la prueba moviendo la carga a **Socket 1** (el caso más
        delicado, por ser el que recibe todos los reports mal enrutados).
        Confirmar que Socket 1 refleja el consumo real y el resto sigue a 0W.
      - [ ] Repetir para el resto de sockets (S3–S6) al menos una vez.
- [ ] Encender 2 sockets con carga simultáneamente (ej. S2 y S5) y confirmar que
      cada uno reporta su propio valor de forma independiente (no se mezclan ni
      se "copian" entre sí).
- [ ] Apagar un socket con carga y confirmar que su `measure_power` cae a 0W
      inmediatamente (sin esperar al siguiente poll — esto está forzado en
      software al recibir el `onoff=false`).

---

## 3. Comportamiento de red / no saturación

- [ ] En el log, tras un cambio de potencia real, confirmar que las peticiones
      `METER_GET` a los distintos sockets **no** se disparan todas en el mismo
      instante — deben verse espaciadas (~150ms entre sí en el refresco por
      cambio, ~300ms entre sí en el arranque).
- [ ] Reiniciar la app (`homey app run --remote` de nuevo, o reinicio de la app
      desde Homey) y comprobar en el log que los 6 sockets hacen su GET inicial
      de forma escalonada, no todos a la vez.
- [ ] Provocar varios cambios de potencia seguidos en pocos segundos (encender/
      apagar una carga repetidamente) y confirmar que el debounce de 50ms
      coalesce las ráfagas en refrescos puntuales, no un refresco por cada
      evento.
- [ ] (Si tienes más de un PowerNode-6 emparejado) confirmar que un cambio de
      potencia en una regleta **no** genera tráfico `METER_GET` hacia los
      sockets de la otra regleta — revisar el log, debe listar solo los sockets
      de la regleta que cambió.
- [ ] Durante ~10 minutos de uso normal, no debería haber errores repetidos de
      timeout o `NO_ACK` en el log de forma sistemática (alguno aislado es
      normal en Z-Wave).

---

## 4. Meter (kWh acumulado) y settings

- [ ] `meter_power` en cada socket aumenta con el tiempo cuando hay consumo, y
      se mantiene estable con consumo 0.
- [ ] Revisar Ajustes del dispositivo de cada socket: `poll_interval_measure` y
      `poll_interval_onoff` deben estar a `0` (polling periódico desactivado,
      todo es "on-change"); `poll_interval_meter` a `300`.
- [ ] Cambiar manualmente `poll_interval_meter` a otro valor, reiniciar la app,
      y confirmar que el valor cambiado por el usuario **se respeta** (no se
      resetea al valor por defecto).

---

## 5. Regresión — PowerNode-1

- [ ] Si tienes un PowerNode-1 emparejado, confirmar que on/off y `measure_power`
      /`meter_power` siguen funcionando con normalidad (no debería haberse visto
      afectado por estos cambios, pero conviene confirmarlo).

---

## Criterio de aceptación

Todo lo anterior marcado ✔️ y sin errores no explicados en el log durante las
pruebas. Cualquier fallo (consumo cruzado entre sockets, ráfagas simultáneas de
GET, valores que no bajan a 0 al apagar) debe registrarse con el log
correspondiente para diagnosticar antes de dar la versión por buena.
