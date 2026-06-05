'use strict';

const { ZwaveDevice } = require('homey-zwavedriver');

class GreenwaveDevice extends ZwaveDevice {
  async onNodeInit({ node }) {
    // enable debugging
    this.enableDebug();

    // print the node's info to the console
    this.printNode();

    this.registerCapability('measure_power', 'METER', {
      getOpts: {
        getOnStart: true,
        pollInterval: 'poll_interval_measure',
        pollMultiplication: 1000,
      },
    });
    this.registerCapability('meter_power', 'METER', {
      getOpts: {
        getOnStart: true, 
        pollInterval: 'poll_interval_meter',
        pollMultiplication: 1000,
      },
    });
    this.registerCapability('onoff', 'SWITCH_BINARY', {
      get: 'SWITCH_BINARY_GET',
      getOpts: {
        getOnStart: true,
        pollInterval: 'poll_interval_onoff',
        pollMultiplication: 1000,
      },
      set: 'SWITCH_BINARY_SET',
      setParser: value => ({ 'Switch Value': value ? 'on/enable' : 'off/disable' }),
      report: 'SWITCH_BINARY_REPORT',
      reportParser: report => {
        const val = report['Value'];
        if (val === 'on/enable' || val === 255 || val === true) return true;
        if (val === 'off/disable' || val === 0 || val === false) return false;
        return null;
      },
    });

    this.registerReportListener(
      'SWITCH_BINARY',
      'SWITCH_BINARY_REPORT',
      (rawReport, parsedReport) => {
        this.log('SWITCH_BINARY_REPORT', rawReport, parsedReport);
      },
    );
  }
}

module.exports = GreenwaveDevice;
