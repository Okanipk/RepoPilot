const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repopilotSettingsPath = path.join(__dirname, '..', '.repopilot', 'settings.json');
const taskdeckSettingsPath = path.join(__dirname, '..', '.taskdeck', 'settings.json');
const settingsPath = fs.existsSync(repopilotSettingsPath)
  ? repopilotSettingsPath
  : (fs.existsSync(taskdeckSettingsPath) ? taskdeckSettingsPath : repopilotSettingsPath);

let saved = {};
if (fs.existsSync(settingsPath)) {
  try {
    saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!saved || Array.isArray(saved) || typeof saved !== 'object') throw new Error('Geçersiz ayarlar');
  } catch (error) {
    throw new Error(`Repo Pilot ayarları okunamadı: ${error.message}`);
  }
}

function save(values) {
  const next = { ...saved, ...values };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${settingsPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, settingsPath);
  saved = next;
}

if (!saved.sessionSecret) save({ sessionSecret: crypto.randomBytes(32).toString('hex') });

module.exports = {
  get(key, fallback) { return saved[key] === undefined ? fallback : saved[key]; },
  save
};
