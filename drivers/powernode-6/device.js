'use strict';

const { ZwaveDevice } = require('homey-zwavedriver');

class GreenwaveDevice extends ZwaveDevice {
  async onNodeInit({ node }) {
    this.enableDebug();
    this.printNode();

    const isRootDevice = this.node.MultiChannelNodes && Object.keys(this.node.MultiChannelNodes).length > 0;

    await this._migrateCapabilities(isRootDevice);
    await this._migrateSettings();

    // One-time migration: push the corrected "Power change for update" (Param 0)
    // to strips paired before this fix — defaultConfiguration only applies at
    // pairing time, so already-paired strips would otherwise be stuck on their
    // old value forever. Only the root device has the CONFIGURATION command
    // class (sub-devices only see their own endpoint's classes), and Param 0 is
    // a single physical setting shared by the whole strip, not per-socket.
    if (isRootDevice) this._migrateParam0(2400);

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
          this._throttledRefresh(rootToken);
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

      this.registerCapability('meter_power', 'METER', {
        getOpts: {
          getOnStart: false,
        },
      });

      // Periodic polls for measure_power and meter_power, staggered per socket
      // (300ms apart, baked into each socket's own recurring interval) instead of
      // the library's shared pollInterval timer — avoids all 6 sockets polling in
      // the same instant, which this congestion-prone firmware chokes on.
      // measure_power's poll is also a fallback for low/steady loads (~1-2W) that
      // may never vary enough to trigger a spontaneous METER_REPORT, so the
      // "poll on change" mechanism above never fires for them.
      this._myMcId = myMcId;
      this._schedulePoll('measure_power', 'poll_interval_measure');
      this._schedulePoll('meter_power', 'poll_interval_meter');
    }

    this.registerCapability('onoff', 'SWITCH_BINARY', {
      setOpts: {
        fn: value => {
          if (!isRootDevice && this.hasCapability('measure_power')) {
            if (value === false) {
              this.setCapabilityValue('measure_power', 0).catch(this.error);
            } else {
              // Staggered by socket (500ms + (mcId-1)*300ms): turning on several
              // sockets within a short window queues their SET/GET commands to the
              // same physical node, so a fixed 500ms for everyone can land behind
              // another socket's pending command and take several seconds instead.
              const mcId = Number(this.getData().multiChannelNodeId);
              this.homey.setTimeout(() => {
                this._getCapabilityValue('measure_power', 'METER')
                  .catch(err => this.log('measure_power get on turn on:', err.message));
              }, 500 + (mcId - 1) * 300);
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

  // Rate-limits poll-on-change refreshes: this GreenWave firmware sends
  // spontaneous METER_REPORTs every ~8-30s more or less continuously (not just
  // on real large changes), so without a floor this refreshes on almost every
  // one of those, adding up to a lot of steady-state Z-Wave traffic. At most
  // one refresh cycle runs per REFRESH_MIN_INTERVAL_MS; a report arriving
  // during the cooldown schedules a single trailing refresh for when it ends,
  // so a real change is never delayed by more than the cooldown itself.
  _throttledRefresh(rootToken) {
    const REFRESH_MIN_INTERVAL_MS = 15000;
    const elapsed = Date.now() - (this._lastRefreshAt || 0);
    if (elapsed < REFRESH_MIN_INTERVAL_MS) {
      if (!this._refreshCooldown) {
        this._refreshCooldown = this.homey.setTimeout(() => {
          this._refreshCooldown = null;
          this._refreshSockets(rootToken);
        }, REFRESH_MIN_INTERVAL_MS - elapsed);
      }
      return;
    }
    this._refreshSockets(rootToken);
  }

  // Only refreshes sockets of THIS physical strip (same pairing token) that
  // are ON — sockets on other PowerNode-6 strips paired to the same Homey are
  // untouched, and OFF sockets already show 0W and need no GET. Stagger the
  // GETs (150ms apart) instead of firing them all at once — this GreenWave
  // firmware is known to choke on bursts of near-simultaneous commands (see
  // the Param 3 startup delay fix).
  _refreshSockets(rootToken) {
    this._lastRefreshAt = Date.now();
    const subDevices = this.driver.getDevices().filter(d => d !== this
      && d.hasCapability('measure_power')
      && d.getData().token === rootToken
      && d.getCapabilityValue('onoff') !== false);
    this.log(`Power change — refreshing ${subDevices.length} ON sockets`);
    subDevices.forEach((subDevice, i) => {
      this.homey.setTimeout(() => {
        subDevice._getCapabilityValue('measure_power', 'METER')
          .catch(err => this.log(`Socket refresh error: ${err.message}`));
      }, i * 150);
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

  // Periodic poll for a METER-based capability on sub-devices, staggered by
  // (mcId-1)*300ms — baked into the recurring interval itself, so sockets stay
  // out of phase across restarts too. Used instead of the library's shared
  // getOpts.pollInterval so 6 sockets can't end up polling in the same instant.
  _schedulePoll(capabilityId, settingKey) {
    this._customPollTimeouts = this._customPollTimeouts || {};
    if (this._customPollTimeouts[capabilityId]) this.homey.clearTimeout(this._customPollTimeouts[capabilityId]);
    const seconds = Number(this.getSetting(settingKey)) || 0;
    if (seconds <= 0) return;
    const intervalMs = seconds * 1000 + (this._myMcId - 1) * 300;
    this._customPollTimeouts[capabilityId] = this.homey.setTimeout(() => {
      this._getCapabilityValue(capabilityId, 'METER')
        .catch(err => this.log(`Socket ${this._myMcId} periodic ${capabilityId} GET:`, err.message))
        .finally(() => this._schedulePoll(capabilityId, settingKey));
    }, intervalMs);
  }

  async onSettings(args) {
    const result = await super.onSettings(args);
    if (this.hasCapability('measure_power')) {
      if (args.changedKeys.includes('poll_interval_measure')) this._schedulePoll('measure_power', 'poll_interval_measure');
      if (args.changedKeys.includes('poll_interval_meter')) this._schedulePoll('meter_power', 'poll_interval_meter');
    }
    return result;
  }

  // Sends CONFIGURATION_SET for Param 0 (Power change for update) once, so
  // sockets paired before this fix pick up the corrected 10% threshold without
  // being removed/re-added. Retries on next boot if it fails (flag is only set
  // after a successful send).
  async _migrateParam0(delayMs) {
    if (await this.getStoreValue('param0_migrated_v1')) return;
    this.homey.setTimeout(() => {
      this.configurationSet({ index: 0, size: 1, signed: true }, 10)
        .then(async () => {
          this.log('Migrated Param 0 (Power change for update) to 10%');
          // Keep the Homey settings UI in sync with the value just pushed to
          // hardware (harmless if this triggers one redundant CONFIGURATION_SET).
          if (this.getSetting('zwave_0') !== 10) {
            await this.setSettings({ zwave_0: 10 }).catch(err => this.log('zwave_0 setting sync failed:', err.message));
          }
          await this.setStoreValue('param0_migrated_v1', true);
        })
        .catch(err => this.log('Param 0 migration failed:', err.message));
    }, delayMs);
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
