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
      // All unsolicited METER_REPORTs arrive at MultiChannelNode 1 regardless of which
      // socket generated them. When any report arrives, we trigger _getCapabilityValue
      // on every sub-device — each GET targets the correct endpoint and the response
      // routes back correctly, giving accurate per-socket readings.
      this.registerMultiChannelReportListener(1, 'METER', 'METER_REPORT', () => {
        const subDevices = this.driver.getDevices().filter(d => d !== this);
        this.log(`Power change detected — refreshing ${subDevices.length} sockets`);
        for (const subDevice of subDevices) {
          subDevice._getCapabilityValue('measure_power', 'METER')
            .catch(err => this.log(`Socket refresh error: ${err.message}`));
        }
      });
    } else {
      this.registerCapability('measure_power', 'METER', {
        reportParserOverride: true,
        reportParser: report => {
          if (this.getCapabilityValue('onoff') === false) return 0;
          return report['Meter Value (Parsed)'] ?? null;
        },
        getOpts: {
          getOnStart: true,
          pollInterval: 'poll_interval_measure',
          pollMultiplication: 1000,
        },
      });
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
              // Force 0W immediately on turn off
              this.setCapabilityValue('measure_power', 0).catch(this.error);
            } else {
              // Actively read power after 2s to avoid waiting for spontaneous report
              this.homey.setTimeout(() => {
                this._getCapabilityValue('measure_power', 'METER')
                  .catch(err => this.log('measure_power get on turn on:', err.message));
              }, 1000);
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

  // Greenwave PowerNode 6 executes commands but sometimes does not send Z-Wave ACK
  // Suppress NO_ACK errors to avoid false warnings in Homey UI
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
