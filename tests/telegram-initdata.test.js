import crypto from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import initDataModule from '../lib/telegram-initdata.js';

const { validateInitData } = initDataModule;
const BOT_TOKEN = '123456:dummy-token';
const NOW_SECONDS = 2000000000;

function signInitData(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    params.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();

  const hash = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  params.set('hash', hash);
  return params.toString();
}

function fixture(ageSeconds = 30) {
  return signInitData({
    auth_date: String(NOW_SECONDS - ageSeconds),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: {
      id: 12345,
      first_name: 'Ada',
      username: 'ada_goat',
      photo_url: 'https://example.com/avatar.jpg',
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('validateInitData', () => {
  it('accepts valid initData and parses the user id', () => {
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));

    const result = validateInitData(fixture(), BOT_TOKEN);

    expect(result.ok).toBe(true);
    expect(result.user.id).toBe(12345);
    expect(result.authDate).toBe(NOW_SECONDS - 30);
  });

  it('rejects a tampered field after signing', () => {
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));
    const params = new URLSearchParams(fixture());
    params.set('user', JSON.stringify({ id: 99999, first_name: 'Ada' }));

    expect(validateInitData(params.toString(), BOT_TOKEN)).toEqual({
      ok: false,
      reason: 'bad_hash',
    });
  });

  it('rejects the wrong hash', () => {
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));
    const params = new URLSearchParams(fixture());
    params.set('hash', '0'.repeat(64));

    expect(validateInitData(params.toString(), BOT_TOKEN)).toEqual({
      ok: false,
      reason: 'bad_hash',
    });
  });

  it('rejects auth_date older than maxAgeSeconds as expired', () => {
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));

    expect(validateInitData(fixture(7200), BOT_TOKEN)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects missing hash or garbage as malformed', () => {
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));
    const params = new URLSearchParams(fixture());
    params.delete('hash');

    expect(validateInitData(params.toString(), BOT_TOKEN)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(validateInitData('', BOT_TOKEN)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('accepts 3599s age and expires 3601s age with explicit maxAgeSeconds', () => {
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));

    expect(validateInitData(fixture(3599), BOT_TOKEN, 3600).ok).toBe(true);
    expect(validateInitData(fixture(3601), BOT_TOKEN, 3600)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});
