# Changelog — GreenWave Systems Homey App

---

## v1.1.2 (2026-06-05)

### Corrección de bug crítico — Enrutamiento de reportes de potencia (PowerNode 6)

#### Problema
El firmware del GreenWave PowerNode 6 (NP240/NP242) tiene un bug conocido
(`treatDestinationEndpointAsSource`): todos los reportes espontáneos de medida de potencia
(METER_REPORT) se enviaban siempre desde el endpoint 1, independientemente de qué toma
física había generado el consumo. Esto provocaba que **todo el consumo apareciera siempre
en la Toma 1**, mientras las tomas 2-6 mostraban 0W aunque tuvieran carga conectada.

#### Solución implementada
Se implementó un mecanismo de **"poll on change"** en el root device:

1. El root device registra un listener en MultiChannelNode 1 para `METER_REPORT`.
2. Cuando llega cualquier reporte espontáneo (cambio ≥ umbral configurado), el root device
   llama a `_getCapabilityValue('measure_power', 'METER')` en cada sub-device (S1–S6).
3. Cada sub-device envía su propio `METER_GET` al endpoint Z-Wave correcto y recibe la
   respuesta individualizada.
4. Resultado: consumo correcto por toma con latencia de ~1-2 segundos tras el cambio.

#### Otros cambios
- `getOnStart: true` en `measure_power` — los valores de potencia se leen al arrancar la app.
- `defaultConfiguration` Param 0 corregido de 80% a **10%** — el dispositivo reporta al 10%
  de variación de corriente por defecto al emparejar.
- Eliminado `reportParserOverride` innecesario en sub-devices.

---

## v1.1.1

- Corrección de migración de capabilities entre root device y sub-devices.
- Supresión de errores `TRANSMIT_COMPLETE_NO_ACK` (bug de firmware — el dispositivo ejecuta
  el comando pero no siempre envía ACK Z-Wave).
- `poll_interval_meter` por defecto: 300s (kWh).

---

## v1.1.0

- Soporte multicanal para PowerNode 6: cada toma aparece como dispositivo independiente
  en Homey con sus propias capacidades `onoff`, `measure_power` y `meter_power`.
- Al apagar una toma, `measure_power` se fuerza a 0W inmediatamente.

---

## Configuración recomendada por toma (parámetros avanzados)

Aplica estos valores en **Ajustes del dispositivo → cada toma (S1–S6)** en Homey:

| Parámetro | Valor recomendado | Descripción |
|-----------|-------------------|-------------|
| **Power change for update** | **10 %** | Variación mínima de corriente para enviar un reporte espontáneo a Homey. Valores bajos dan más resolución pero más tráfico Z-Wave. Rango: 1–100%. |
| **Keep alive time** | **255 min** | Minutos sin contacto antes de que el LED empiece a parpadear. 255 = prácticamente desactivado. |
| **Poll interval on/off** | **0 s** (desactivado) | Polling del estado encendido/apagado. No necesario con reportes espontáneos. |
| **Poll interval measure (W)** | **0 s** (desactivado) | Polling de potencia instantánea. No necesario — el mecanismo "poll on change" lo gestiona automáticamente. |
| **Poll interval meter (kWh)** | **300 s** | Polling de energía acumulada cada 5 minutos. Recomendado para mantener el contador kWh actualizado. |

> **Nota**: El parámetro "Power change for update" se envía al dispositivo Z-Wave
> via `CONFIGURATION_SET`. Si el valor actual es 80% (configuración antigua), cámbialo
> manualmente a 10% en los ajustes de cada toma en Homey.

---

## Notas sobre el firmware GreenWave NP240/NP242 v4.27

- **Bug `treatDestinationEndpointAsSource`**: todos los reportes espontáneos de medida
  llegan al endpoint 1. Gestionado por el driver desde v1.1.2.
- **Bug `TRANSMIT_COMPLETE_NO_ACK`**: el dispositivo ejecuta los comandos SET pero
  ocasionalmente no envía ACK Z-Wave. El driver suprime estos errores desde v1.1.1.
- El dispositivo tiene **tasa de error ~11%** en tx (NO_ACK), lo cual es normal para
  este firmware. No indica saturación de red.
