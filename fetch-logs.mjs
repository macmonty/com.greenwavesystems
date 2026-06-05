import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load token from athom-cli settings
const settingsPath = path.join(process.env.APPDATA, 'athom-cli', 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const cloudToken = settings.homeyApi.token;

// Use homey-api from the homey CLI's node_modules
const homeyApiPath = new URL(
  'file:///' + path.join(process.env.APPDATA, 'npm', 'node_modules', 'homey', 'node_modules', 'homey-api', 'exports', 'node.mjs').replace(/\\/g, '/')
);
const { AthomCloudAPI } = await import(homeyApiPath);

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

// Listen for app log events
api.apps.on('app.log', ({ id, entry }) => {
  if (id === 'com.greenwavesystems') {
    process.stdout.write(entry);
  }
});

// Also get existing logs
try {
  const logs = await api.apps.getLogs({ id: 'com.greenwavesystems' });
  if (logs) console.log(logs);
} catch(e) {
  console.log('(no previous logs or endpoint unavailable)');
}

console.log('--- Streaming logs, press Ctrl+C to stop ---\n');
