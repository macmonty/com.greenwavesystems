'use strict';

const { ZwaveDevice } = require('homey-zwavedriver');

class GreenwaveDevice extends ZwaveDevice {
  async onNodeInit({ node }) {
    this.enableDebug();
    this.printNode();

    const isRootDevice = this.node.MultiChannelNodes && Object.keys(this.node.MultiChannelNodes).length > 0;

    await this._migrateCapabilities(isRootDevice);
    await this._migrateSettings();

    if (isRootDevice) {
      // GreenWave firmware bug (treatDestinationEndpointAsSource):
      // All METER_REPORTs arrive at MC1 regardless of which socket sent them.
      // We refresh all sockets on each report. Socket 1 uses _inExplicitGet to
      // accept only GET-response updates (not spurious unsolicited events).
      const rootToken = this.getData().token;
      this.registerMultiChannelReportListener(1, 'METER', 'METER_REPORT', () => {
        if (this._refreshDebounce) this.homey.clearTimeout(this._refreshDebounce);
        this._refreshDebounce = this.homey.setTimeout(() => {
          this._refreshDebounce = null;
          // Only refresh sockets of THIS physical strip (same pairing token) that are
          // ON — sockets on other PowerNode-6 strips paired to the same Homey are
          // untouched, and OFF sockets already show 0W and need no GET.
          const subDevices = this.driver.getDevices().filter(d => d !== this
            && d.hasCapability('measure_power')
            && d.getData().token === rootToken
            && d.getCapabilityValue('onoff') !== false);
          this.log(`Power change — refreshing ${subDevices.length} ON sockets`);
          // Stagger the GETs (150ms apart) instead of firing them all at once —
          // this GreenWave firmware is known to choke on bursts of near-simultaneous
          // commands (see the Param 3 startup delay fix).
          subDevices.forEach((subDevice, i) => {
            this.homey.setTimeout(() => {
              subDevice._getCapabilityValue('measure_power', 'METER')
                .catch(err => this.log(`Socket refresh error: ${err.message}`));
            }, i * 150);
          });
        }, 50);
      });
    } else {
      const myMcId = Number(this.getData().multiChannelNodeId);
      const isSocket1 = myMcId === 1;

      this.registerCapability('measure_power', 'METER', {
        reportParserOverride: true,
        reportParser: report => {
          if (this.getCapabilityValue('onoff') === false) return 0;
          if (isSocket1 && !this._inExplicitGet) {
            // Reject unsolicited events: MC1 receives all sockets' reports due to firmware bug.
            // Only accept values that come from an explicit GET (_inExplicitGet = true).
            return null;
          }
          return report['Meter Value (Parsed)'] ?? null;
        },
        getOpts: {
          getOnStart: false,
        },
      });

      // Stagger each socket's startup GET (300ms apart) instead of firing them all
      // at once — avoids a burst of simultaneous METER_GET requests to this
      // congestion-prone firmware. Socket 1 goes last since its passive listener
      // must reject spurious unsolicited reports from sockets 2-6 while they start up.
      const startupDelay = isSocket1 ? 300 * 6 : 300 * (myMcId - 1);
      this.homey.setTimeout(() => {
        this._getCapabilityValue('measure_power', 'METER')
          .catch(err => this.log(`Socket ${myMcId} startup GET:`, err.message));
      }, startupDelay);

      // Periodic fallback poll for measure_power, staggered per socket so all 6
      // don't fire together. Needed because with a low "power change for update"
      // threshold, low/steady loads (~1-2W) may never vary enough to trigger a
      // spontaneous METER_REPORT, so the "poll on change" mechanism above never
      // fires for them. Handled manually (not via the library's getOpts.pollInterval)
      // so the stagger sticks even as the recurring poll reschedules itself.
      this._myMcId = myMcId;
      this._scheduleMeasurePowerPoll();

      this.registerCapability('meter_power', 'METER', {
        getOpts: {
          getOnStart: false,
          pollInterval: 'poll_interval_meter',
          pollMultiplication: 1000,
        },
      });
    }

    this.registerCapability('onoff', 'SWITCH_BINARY', {
      setOpts: {
        fn: value => {
          if (!isRootDevice && this.hasCapability('measure_power')) {
            if (value === false) {
              this.setCapabilityValue('measure_power', 0).catch(this.error);
            } else {
              this.homey.setTimeout(() => {
                this._getCapabilityValue('measure_power', 'METER')
                  .catch(err => this.log('measure_power get on turn on:', err.message));
              }, 500);
            }
          }
        },
      },
      getOpts: {
        getOnStart: false,
        pollInterval: 'poll_interval_onoff',
        pollMultiplication: 1000,
      },
    });
  }

  // For socket 1: sets _inExplicitGet so reportParser accepts the GET response.
  // For sockets 2-6: no special handling needed (their responses go through _onReport
  // correctly and socket 1 is gated by _inExplicitGet).
  async _getCapabilityValue(capabilityId, commandClassId) {
    if (capabilityId === 'measure_power') {
      const mcId = Number(this.getData().multiChannelNodeId);
      if (mcId === 1) {
        this._inExplicitGet = true;
        try {
          return await super._getCapabilityValue(capabilityId, commandClassId);
        } finally {
          this._inExplicitGet = false;
        }
      }
    }
    return super._getCapabilityValue(capabilityId, commandClassId);
  }

  // Fallback poll for measure_power on sub-devices, since the "poll on change"
  // mechanism depends on a spontaneous METER_REPORT that low/steady loads may
  // never trigger. Staggers each socket by (mcId-1)*300ms — baked into the
  // recurring interval itself, so sockets stay out of phase across restarts too.
  _scheduleMeasurePowerPoll() {
    if (this._measurePollTimeout) this.homey.clearTimeout(this._measurePollTimeout);
    const seconds = Number(this.getSetting('poll_interval_measure')) || 0;
    if (seconds <= 0) return;
    const intervalMs = seconds * 1000 + (this._myMcId - 1) * 300;
    this._measurePollTimeout = this.homey.setTimeout(() => {
      this._getCapabilityValue('measure_power', 'METER')
        .catch(err => this.log(`Socket ${this._myMcId} periodic measure_power GET:`, err.message))
        .finally(() => this._scheduleMeasurePowerPoll());
    }, intervalMs);
  }

  async onSettings(args) {
    const result = await super.onSettings(args);
    if (this.hasCapability('measure_power') && args.changedKeys.includes('poll_interval_measure')) {
      this._scheduleMeasurePowerPoll();
    }
    return result;
  }

  async _migrateSettings() {
    const current = this.getSettings();
    const desired = {
      poll_interval_measure: 600,
      poll_interval_onoff: 0,
      poll_interval_meter: 300,
    };
    const updates = {};
    for (const [key, value] of Object.entries(desired)) {
      if (current[key] !== value) updates[key] = value;
    }
    if (Object.keys(updates).length > 0) {
      await this.setSettings(updates);
      this.log('Settings migrated:', JSON.stringify(updates));
    }
  }

  async _migrateCapabilities(isRootDevice) {
    if (isRootDevice) {
      for (const cap of ['measure_power', 'meter_power']) {
        if (this.hasCapability(cap)) {
          await this.removeCapability(cap);
          this.log(`Migration: removed ${cap} from root device`);
        }
      }
    } else {
      for (const cap of ['measure_power', 'meter_power']) {
        if (!this.hasCapability(cap)) {
          await this.addCapability(cap);
          this.log(`Migration: added ${cap} to sub-device`);
        }
      }
    }
  }

  async _setCapabilityValue(capabilityId, commandClassId, value, opts = {}) {
    try {
      return await super._setCapabilityValue(capabilityId, commandClassId, value, opts);
    } catch (err) {
      if (err.message && err.message.includes('TRANSMIT_COMPLETE_NO_ACK')) {
        this.log(`${capabilityId} SET: command sent, device did not ACK`);
        return;
      }
      throw err;
    }
  }
}

module.exports = GreenwaveDevice;
