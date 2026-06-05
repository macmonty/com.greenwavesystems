# Changelog — GreenWave Systems Homey App

---

## v1.1.2 (2026-06-05)

### Critical bug fix — Power consumption routing (PowerNode 6)

#### Problem
The GreenWave PowerNode 6 (NP240/NP242) firmware has a known bug
(`treatDestinationEndpointAsSource`): all unsolicited power measurement reports
(METER_REPORT) were always sent from endpoint 1, regardless of which physical socket
generated the consumption. This caused **all power consumption to always appear on
Socket 1**, while sockets 2–6 showed 0W even when loads were connected.

#### Solution
A **"poll on change"** mechanism was implemented in the root device:

1. The root device registers a listener on MultiChannelNode 1 for `METER_REPORT`.
2. When any unsolicited report arrives (change ≥ configured threshold), the root device
   calls `_getCapabilityValue('measure_power', 'METER')` on each sub-device (S1–S6).
3. Each sub-device sends its own `METER_GET` to the correct Z-Wave endpoint and receives
   its individual response.
4. Result: accurate per-socket power readings with ~1–2 second latency after a change.

#### Additional changes
- `getOnStart: true` on `measure_power` — power values are read on app startup for all sockets.
- `defaultConfiguration` Param 0 corrected from 80% to **10%** — device reports on 10%
  current variation by default when paired.
- `reportParser` added to sub-devices: forces 0W when socket is turned off, preventing
  transient values appearing after switching off.
- On turn-on: active `METER_GET` triggered after 1 second so power reading appears
  immediately without waiting for the device's spontaneous report (~10s delay).
- `poll_interval_measure` default set to 0 (disabled) — the poll-on-change mechanism
  handles updates automatically.

---

## v1.1.1

- Fixed capability migration between root device and sub-devices.
- Suppressed `TRANSMIT_COMPLETE_NO_ACK` errors (firmware bug — device executes the
  command but does not always send a Z-Wave ACK). No functional impact.
- `poll_interval_meter` default: 300s (kWh energy counter).

---

## v1.1.0

- Multi-channel support for PowerNode 6: each socket appears as an independent device
  in Homey with its own `onoff`, `measure_power` and `meter_power` capabilities.
- When a socket is turned off, `measure_power` is immediately forced to 0W.

---

## Recommended device settings (advanced parameters)

Apply these values in **Device settings → each socket (S1–S6)** in Homey:

| Parameter | Recommended value | Description |
|-----------|-------------------|-------------|
| **Power change for update** | **10%** | Minimum current variation to send an unsolicited report to Homey. Lower values give faster updates but more Z-Wave traffic. Range: 1–100%. |
| **Keep alive time** | **255 min** | Minutes without contact before the LED starts blinking. 255 = effectively disabled. |
| **Poll interval on/off** | **0 s** (disabled) | On/off status polling. Not needed with unsolicited reports. |
| **Poll interval measure (W)** | **0 s** (disabled) | Instantaneous power polling. Not needed — the poll-on-change mechanism handles updates automatically. |
| **Poll interval meter (kWh)** | **300 s** | Energy accumulator polling every 5 minutes. Recommended to keep the kWh counter up to date. |

> **Note**: The "Power change for update" parameter is sent to the Z-Wave device via
> `CONFIGURATION_SET`. If the current value is 80% (old default), change it manually
> to 10% in each socket's settings in Homey.

---

## GreenWave NP240/NP242 firmware v4.27 — known issues

- **`treatDestinationEndpointAsSource` bug**: all unsolicited power reports arrive at
  endpoint 1. Handled by the driver since v1.1.2.
- **`TRANSMIT_COMPLETE_NO_ACK` bug**: device executes SET commands but occasionally
  does not send a Z-Wave ACK. Driver suppresses these errors since v1.1.1.
- Device has a **~11% TX error rate** (NO_ACK), which is normal for this firmware.
  It does not indicate Z-Wave network saturation.
