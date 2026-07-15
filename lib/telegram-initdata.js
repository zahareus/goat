const crypto = require('node:crypto');

function validateInitData(initDataString, botToken, maxAgeSeconds = 3600) {
  if (!initDataString || typeof initDataString !== 'string' || !botToken) {
    return { ok: false, reason: 'malformed' };
  }

  let params;
  try {
    params = new URLSearchParams(initDataString);
  } catch (_) {
    return { ok: false, reason: 'malformed' };
  }

  const hash = params.get('hash');
  const authDateValue = params.get('auth_date');
  const authDate = Number(authDateValue);

  if (!hash || !authDateValue || !Number.isFinite(authDate)) {
    return { ok: false, reason: 'malformed' };
  }

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') pairs.push([key, value]);
  }

  const dataCheckString = pairs
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const expected = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(hash, 'hex');

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return { ok: false, reason: 'bad_hash' };
  }

  if (Math.floor(Date.now() / 1000) - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'expired' };
  }

  try {
    return { ok: true, user: JSON.parse(params.get('user') || '{}'), authDate };
  } catch (_) {
    return { ok: false, reason: 'malformed' };
  }
}

module.exports = { validateInitData };
