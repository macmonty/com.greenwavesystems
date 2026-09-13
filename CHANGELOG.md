# Changelog — GreenWave Systems Homey App

---

## v1.1.4 (2026-09-13)

### Fix — measure_power not updating for low/steady loads (PowerNode 6)

#### Problem
The "poll on change" mechanism (v1.1.2/v1.1.3) only refreshes a socket's
`measure_power` in reaction to a spontaneous `METER_REPORT` from the device. That
report is only sent when consumption varies more than the "Power change for
update" threshold. With a low, steady load (~1-2W), even a small percentage
variation is a fraction of a watt: the device may never cross that threshold, no
report is ever sent, and the refresh mechanism never fires. With
`poll_interval_measure` forced to 0 (disabled), there was no periodic fallback
either — these sockets could stay stuck showing a stale/0W reading indefinitely.

#### Solution
1. `defaultConfiguration` Param 0 lowered to **10%** (the device's documented
   factory default, per zwave-js's config for this hardware), so smaller load
   changes are more likely to cross the threshold on their own.
2. `poll_interval_measure` default changed from `0` (disabled) to **600 seconds**
   as a safety-net fallback poll, on top of (not replacing) the event-driven
   "poll on change" mechanism, which still gives fast reaction to larger changes.
3. The periodic poll is staggered per socket (each one offset by 300ms, baked into
   its own recurring interval) instead of using the library's built-in poll timer
   directly — avoids recreating the simultaneous-burst problem that motivated
   disabling polling in the first place. Reacts live if the user changes the
   interval in the device settings.
4. The existing `meter_power` (kWh) poll had the same un-staggered issue — all 6
   sockets polling every 300s in the same instant. Switched to the same manual
   staggered scheduling as `measure_power`.
5. **`defaultConfiguration` only applies at pairing time** — sockets paired before
   this fix would otherwise stay stuck on their old threshold (80%) forever,
   since `zwave_0`/`zwave_1`/`zwave_3` settings had no `zwave: {index, size}`
   metadata, so changing them in the Homey UI silently did nothing to the
   hardware. Added that metadata to `zwave_0` (Power change for update), and a
   one-time, staggered `CONFIGURATION_SET` migration on boot that pushes 10% to
   already-paired sockets without needing to remove/re-add the strip.
6. The `measure_power` GET fired 500ms after turning a socket on used the same
   fixed 500ms for every socket. Turning several sockets on within a short
   window queues their SET/GET commands to the same physical node, so a GET
   could land behind another socket's pending command and take several seconds
   instead of ~500ms. Staggered by socket (500ms + (mcId-1)*300ms).
7. A live comparison against zwave-js/Home Assistant on the same hardware
   showed this PowerNode sends spontaneous `METER_REPORT`s roughly every
   8-30 seconds, almost continuously — not just on real large changes. Since
   "poll on change" refreshed on every one of these, it generated steady-state
   traffic proportional to that chatter (~12-16 commands/minute with several
   sockets on). Added a 15-second minimum interval between refresh cycles,
   with a trailing refresh for reports arriving during the cooldown so a real
   change is still caught.
8. The `measure_power` GET fired after turning a socket on was a single
   attempt — if it failed (common right after turning on a switching-mode
   load like a charger, whose own startup inrush/noise causes `NO_ACK`), the
   reading stayed stale until the next poll-on-change or fallback poll. Now
   retries up to twice, 3 seconds apart, by which point the transient noise
   has usually settled. The retry delay is staggered by socket too (same
   (mcId-1)*300ms offset as the initial attempt), so if several sockets are
   turned on together and all fail, their retries stay spread out instead of
   drifting into each other.

> **Note (2026-09-13)**: Tested the turn-on retry logic by switching all 6
> sockets on/off in sequence — no retries actually fired (first attempt
> succeeded every time), because the environment was quiet at that moment.
> The mechanism is deployed but not yet exercised by a real failure in
> testing. Next planned test: repeat with light bulbs (pure resistive load,
> no switching-mode noise) as the test load instead of USB chargers, both to
> get a cleaner isolation test and to gather data on whether the fallback
> poll intervals (600s / 300s) can be safely reduced.

---

## v1.1.3 (2026-09-03)

### Z-Wave traffic reduction (PowerNode 6)

#### Problem
1. The "poll on change" refresh (added in v1.1.2) scoped its `METER_GET` refresh to
   `driver.getDevices()`, i.e. **every** PowerNode-6 sub-device registered with the
   driver. With more than one PowerNode-6 strip paired to the same Homey, a power
   change on one strip triggered unnecessary `METER_GET` requests to the sockets of
   every *other* strip too, needlessly saturating the Z-Wave network.
2. The GreenWave PowerNode 6 firmware is also known to be sensitive to bursts of
   near-simultaneous commands (see the Param 3 startup-delay fix). Two spots still
   fired several `METER_GET` requests at once: sockets 2-6 all issued their startup
   `METER_GET` in the same tick (only socket 1 was delayed), and every ON socket's
   `METER_GET` fired simultaneously on the debounced "poll on change" refresh.

#### Solution
1. The refresh is now scoped to sub-devices sharing the same pairing `token`
   (`getData().token`) as the root device that received the report — i.e. only the
   sockets of the physical strip that actually changed are refreshed.
2. Both startup and poll-on-change GETs are now staggered (300ms apart on startup,
   150ms apart on refresh) instead of firing in a burst. Same total number of
   Z-Wave messages, spread out over time to reduce the risk of the device dropping
   or NACKing commands sent too close together.

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
- `defaultConfiguration` Param 0 lowered from the stale 80% (later corrected
  further to the documented factory default, 10%, in v1.1.4).
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
| **Poll interval measure (W)** | **600 s** | Safety-net fallback poll for loads too steady to ever cross the "Power change" threshold. The poll-on-change mechanism still handles fast updates for larger changes. |
| **Poll interval meter (kWh)** | **300 s** | Energy accumulator polling every 5 minutes. Recommended to keep the kWh counter up to date. |

> **Note**: The "Power change for update" parameter is sent to the Z-Wave device via
> `CONFIGURATION_SET`. If the current value is not 10%, change it manually in each
> socket's settings in Homey (already-paired sockets get this pushed automatically
> since v1.1.4 — see above).

> **Note (2026-09-13)**: "Keep alive time" (Param 1) was double-checked against
> zwave-js's community config for this hardware, which labels the same parameter
> differently ("No Communication Light", default 2) — this raised a question about
> which description/default was correct. Independent real-world reports from other
> Z-Wave platforms (Domoticz, Home Assistant community) confirm our description and
> default are right: it's the number of minutes without contact from the controller
> before the device starts flashing its LED thinking it lost the network, and users
> on other platforms independently arrived at 255 (max) to stop that flashing —
> exactly why this driver defaults to it. No change needed.

---

## GreenWave NP240/NP242 firmware v4.27 — known issues

- **`treatDestinationEndpointAsSource` bug**: all unsolicited power reports arrive at
  endpoint 1. Handled by the driver since v1.1.2.
- **`TRANSMIT_COMPLETE_NO_ACK` bug**: device executes SET commands but occasionally
  does not send a Z-Wave ACK. Driver suppresses these errors since v1.1.1.
- Device has a **~11% TX error rate** (NO_ACK), which is normal for this firmware.
  It does not indicate Z-Wave network saturation.
