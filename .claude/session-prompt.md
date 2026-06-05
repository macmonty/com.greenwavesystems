# Prompt de sesión — GreenWave PowerNode Homey App

Usa este prompt al inicio de una nueva sesión para que Claude tenga todo el contexto
necesario y pueda continuar el trabajo desde el estado actual del código.

---

## PROMPT

```
Tengo un proyecto Homey app para el GreenWave PowerNode 6 (Z-Wave).
Partimos del repo original https://github.com/ronaldderksen/com.greenwavesystems
y está en C:\Developer\com.greenwavesystems.

Lee el workflow en .claude/workflow.md antes de empezar.

### Estado actual del código (v1.1.2)

Se han aplicado las siguientes modificaciones respecto al repo original:

---

#### 1. Bug corregido — Enrutamiento de consumo (drivers/powernode-6/device.js)

El firmware del PowerNode 6 tiene el bug "treatDestinationEndpointAsSource": todos los
reportes espontáneos de potencia (METER_REPORT, grupo de asociación 3) llegan siempre
al MultiChannelNode 1 (Toma 1), independientemente de qué toma generó el consumo.

SOLUCIÓN implementada:
- El root device registra un listener en MultiChannelNode 1 para METER_REPORT.
- Al recibir cualquier reporte espontáneo, llama a _getCapabilityValue('measure_power', 'METER')
  en cada sub-device (S1-S6).
- Cada sub-device envía su propio METER_GET al endpoint correcto y recibe la respuesta
  individualizada → consumo correcto por toma con latencia ~1-2s.
- reportParser en sub-devices: si onoff === false devuelve 0 siempre.
- Al encender una toma: timer de 1s + METER_GET activo para no esperar al reporte espontáneo.
- Al apagar una toma: fuerza measure_power = 0 inmediatamente.

---

#### 2. Configuración Z-Wave (drivers/powernode-6/driver.compose.json)

- defaultConfiguration Param 0: valor corregido de 20 a 10 (umbral de reporte al 10%).
- associationGroups: [1, 3] — se mantienen ambos grupos.
  - Grupo 1: lifeline (control ON/OFF)
  - Grupo 3: reportes de cambio de potencia

---

#### 3. Settings por defecto (drivers/powernode-6/driver.settings.compose.json)

- poll_interval_measure: 0 (desactivado — el mecanismo poll-on-change lo gestiona)
- poll_interval_onoff: 0 (desactivado)
- poll_interval_meter: 300s (kWh cada 5 min)

---

#### 4. getOnStart activado (drivers/powernode-6/device.js)

- measure_power: getOnStart = true (lee W al arrancar en cada toma)
- meter_power: getOnStart = false (solo polling programado)
- onoff: getOnStart = false

---

#### 5. Versión

- v1.1.2 en app.json y .homeycompose/app.json

---

### Configuración actual del dispositivo emparejado

Todas las tomas (S1-S6) tienen estos valores configurados en Homey:
- Power change for update (zwave_0): 10%
- Keep alive time (zwave_1): 255 min
- poll_interval_onoff: 0s
- poll_interval_measure: 0s
- poll_interval_meter: 300s

Device IDs en Homey:
- Root: 2daa069f-5250-4162-9392-94c84dab0d51
- S1:   3533f729-dd58-4e7c-a2e9-35cfe5f15c5c
- S2:   1559cb9b-b843-4a7e-91cc-387e2daae310
- S3:   340e3b55-751e-45bd-84c6-13c3e21b1101
- S4:   ad874050-6692-40aa-80da-41f51e9f4e85
- S5:   f9630e2f-cd45-4a28-a9f3-4b08129d056c
- S6:   34310c3a-2fa0-463d-add6-cdd834241d82

Z-Wave Node ID del dispositivo: 28

---

### Herramientas de desarrollo

- Para arrancar: homey app run --remote (desde C:\Developer\com.greenwavesystems)
- Para leer logs: leer el fichero .output del task en background
- Para leer consumos: usar homey api raw --path /api/manager/devices/device --json
- Detalle completo en .claude/workflow.md
```

---

## Notas de uso

- Este prompt da a Claude todo el contexto para continuar sin tener que re-descubrir
  el código ni los bugs.
- Si has hecho cambios adicionales desde v1.1.2, actualiza este documento con los nuevos
  cambios antes de iniciar la sesión.
- El prompt incluye los Device IDs del dispositivo emparejado — si reemparejas el
  dispositivo estos IDs cambiarán y habrá que actualizarlos aquí.
