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
- Default "Power change for update" parameter corrected from 80% to 10%.
- Power values now read on app startup (`getOnStart`).

### v1.1.1 - (re-pair of devices is needed)
**update:**

Update to SDKv3
