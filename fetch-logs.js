'use strict';

const fs = require('fs');
const path = require('path');

const homeyApiBase = path.join(process.env.APPDATA, 'npm', 'node_modules', 'homey', 'node_modules', 'homey-api');
const { AthomCloudAPI } = require(homeyApiBase);
const AthomCloudAPIToken = AthomCloudAPI.Token;

const settingsPath = path.join(process.env.APPDATA, 'athom-cli', 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const cloudToken = settings.homeyApi.token;

async function main() {
  const cloudApi = new AthomCloudAPI({
    clientId: 'homey-cli',
    clientSecret: 'homey-cli-secret',
    token: cloudToken,
  });

  const me = await cloudApi.getAuthenticatedUser();
  const homeys = await me.getHomeys();
  const homey = homeys.find(h => h.id === '694f69e656ee3485dacd5c48');

  if (!homey) {
    console.error('Homey not found');
    process.exit(1);
  }

  console.log('Connecting to', homey.name, '...');
  const api = await homey.authenticate();

  // Listen for real-time log events
  api.apps.on('app.log', ({ id, entry }) => {
    if (id === 'com.greenwavesystems') {
      process.stdout.write('[LOG] ' + entry + '\n');
    }
  });

  // Try to get existing crash log
  try {
    const app = await api.apps.getApp({ id: 'com.greenwavesystems' });
    console.log('App state:', app.state, '| crashed:', app.crashed);
    if (app.crashed) console.log('Crash reason:', app.crashedMessage || app.error);
  } catch(e) {
    console.log('Could not get app info:', e.message);
  }

  console.log('--- Streaming live logs (30s), send on/off command now ---\n');

  await new Promise(r => setTimeout(r, 30000));
  console.log('\n--- Done ---');
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
