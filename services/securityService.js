const crypto = require('crypto');
const settings = require('./settingsService');

const secret = settings.get('sessionSecret');
const apiToken = process.env.REPOPILOT_API_TOKEN || process.env.TASKDECK_API_TOKEN || '';
const calendarToken = process.env.REPOPILOT_CALENDAR_TOKEN || process.env.TASKDECK_CALENDAR_TOKEN ||
  crypto.createHmac('sha256', secret).update('calendar').digest('hex');

function equal(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function localRequest(req) {
  const address = req.socket.remoteAddress;
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
  const host = (req.headers.host || '').toLowerCase();
  return local && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
}

function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch { return false; }
}

function sessionValue(expires) {
  return `${expires}.${crypto.createHmac('sha256', secret).update(String(expires)).digest('hex')}`;
}

function authenticated(req) {
  if (apiToken && equal(req.headers.authorization, `Bearer ${apiToken}`)) return true;
  const cookies = (req.headers.cookie || '').split(';').map(v => v.trim());
  const cookie = cookies.find(v => v.startsWith('repopilot_session=')) || cookies.find(v => v.startsWith('taskdeck_session='));
  if (!cookie) return false;
  const value = cookie.replace(/^(repopilot_session|taskdeck_session)=/, '');
  const expires = Number(value.split('.')[0]);
  return Number.isSafeInteger(expires) && expires > Date.now() && equal(value, sessionValue(expires));
}

function session(req, res) {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Farklı origin isteği reddedildi.' });
  if (apiToken ? !equal(req.headers.authorization, `Bearer ${apiToken}`) : !localRequest(req)) {
    return res.status(401).json({ error: 'Repo Pilot API erişim anahtarı gerekli.' });
  }
  const secure = req.socket.encrypted ? '; Secure' : '';
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const sessionVal = sessionValue(expiresAt);
  res.setHeader('Set-Cookie', [
    `repopilot_session=${sessionVal}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`,
    `taskdeck_session=${sessionVal}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true });
}

function protect(req, res, next) {
  if (req.path === '/webhook') return next();
  if (req.path === '/calendar.ics' && equal(req.query.token, calendarToken)) return next();
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Farklı origin isteği reddedildi.' });
  if (!authenticated(req)) return res.status(401).json({ error: 'Repo Pilot oturumu gerekli.' });
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'application/json gerekli.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
}

function webhook(req, res, next) {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(503).json({ error: 'Webhook anahtarı yapılandırılmamış.' });
  const signature = `sha256=${crypto.createHmac('sha256', webhookSecret).update(req.rawBody || Buffer.alloc(0)).digest('hex')}`;
  if (!equal(req.headers['x-hub-signature-256'], signature)) {
    return res.status(401).json({ error: 'Geçersiz webhook imzası.' });
  }
  next();
}

module.exports = { session, protect, webhook, calendarToken };
