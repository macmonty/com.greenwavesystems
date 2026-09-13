# Greenwave Systems

This app adds support for devices made by [Greenwave Systems](http://www.greenwavesystems.com).

## Supported devices with most common parameters:
* Greenwave powernode-1
* Greenwave powernode-6

## Supported Languages:
* English
* Dutch

## Installation:
If you don't already have the homey SDK, please read the homey apps developer website on how to get started:
https://apps.developer.homey.app/the-basics/getting-started

to install this app. Run the following:
```
git clone https://github.com/ronaldderksen/com.greenwavesystems.git
cd com.greenwavesystems
npm install
homey app install
```

## Changelog:

### v1.1.4
**Fix — measure_power not updating for low/steady loads (PowerNode 6):**

- The "poll on change" mechanism only reacts to a spontaneous `METER_REPORT`, which
  the device only sends when consumption varies past a threshold (20%). Steady loads
  of 1-2W could stay stuck without ever updating.
- "Power change for update" default lowered from 20% to 10% (factory default).
- `poll_interval_measure` default changed from disabled (0s) to a 600s fallback
  poll, staggered per socket to avoid simultaneous bursts.
- The existing `meter_power` (kWh) poll had the same un-staggered issue — now
  uses the same per-socket staggered scheduling.
- Sockets paired before this fix now get the new 10% threshold pushed to them
  automatically (one-time, staggered `CONFIGURATION_SET` on boot) — no need to
  remove and re-add the strip.
- The "turn on" `measure_power` GET (500ms after switching on) is now staggered
  per socket too, so turning several on at once doesn't queue their GETs behind
  each other.
- Live comparison against zwave-js/Home Assistant showed this PowerNode chatters
  every ~8-30s almost continuously; added a 15s minimum interval between
  poll-on-change refresh cycles (with a trailing refresh) to cut steady-state
  traffic without losing real changes.

### v1.1.3
**Improvement — Z-Wave traffic reduction (PowerNode 6):**

- The "poll on change" refresh (added in v1.1.2) now only refreshes sockets of the
  physical strip that actually changed, instead of every PowerNode-6 sub-device
  registered with the driver — avoids needless `METER_GET` traffic to unrelated
  strips when more than one PowerNode-6 is paired to the same Homey.
- Startup and poll-on-change `METER_GET` requests are now staggered (300ms/150ms
  apart) instead of firing in a burst, reducing the risk of the device dropping or
  NACKing commands sent too close together.

### v1.1.2
**Bug fix:**

- Fixed critical power consumption routing bug on PowerNode 6 (NP240/NP242).
  The firmware has a known issue (`treatDestinationEndpointAsSource`) where all unsolicited
  METER_REPORTs always arrived at endpoint 1, causing all power consumption to appear on
  Socket 1 regardless of which socket had a load connected.
  A "poll on change" mechanism now triggers individual METER_GET requests per socket
  whenever a spontaneous report arrives, giving accurate per-socket readings (~1–2s latency).
- Power reading forced to 0W immediately when a socket is turned off.
- Active METER_GET triggered 1 second after turning on a socket for near-instant feedback.
- Default "Power change for update" parameter corrected from 80% to 20%.
- Power values now read on app startup (`getOnStart`).

### v1.1.1 - (re-pair of devices is needed)
**update:**

Update to SDKv3
