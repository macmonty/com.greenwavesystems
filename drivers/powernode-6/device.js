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
      this.registerMultiChannelReportListener(1, 'METER', 'METER_REPORT', () => {
        if (this._refreshDebounce) this.homey.clearTimeout(this._refreshDebounce);
        this._refreshDebounce = this.homey.setTimeout(() => {
          this._refreshDebounce = null;
          // Skip sockets that are OFF — they already show 0W, no GET needed.
          const subDevices = this.driver.getDevices().filter(d => d !== this && d.getCapabilityValue('onoff') !== false);
          this.log(`Power change — refreshing ${subDevices.length} ON sockets`);
          for (const subDevice of subDevices) {
            subDevice._getCapabilityValue('measure_power', 'METER')
              .catch(err => this.log(`Socket refresh error: ${err.message}`));
          }
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
          getOnStart: !isSocket1,
          pollInterval: 'poll_interval_measure',
          pollMultiplication: 1000,
        },
      });

      if (isSocket1) {
        // Delayed startup GET after sockets 2-6 have finished theirs
        this.homey.setTimeout(() => {
          this._getCapabilityValue('measure_power', 'METER')
            .catch(err => this.log('Socket 1 startup GET:', err.message));
        }, 2000);
      }

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

  async _migrateSettings() {
    const current = this.getSettings();
    const desired = {
      poll_interval_measure: 0,
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
