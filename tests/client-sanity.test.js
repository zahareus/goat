import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CLIENT_FILES = ['app.js', 'index.html', 'style.css'];

describe('client sanity checks', () => {
  it('no leaked API keys or secrets in client files', () => {
    const dangerPatterns = [
      /service_role/i,
      /secret_key/i,
      /SUPABASE_SERVICE_ROLE/,
      /GOAT_NOTIFY_SECRET/,
      /TELEGRAM_WEBHOOK_SECRET/,
    ];

    for (const file of CLIENT_FILES) {
      const content = readFileSync(join(ROOT, file), 'utf8');
      for (const pattern of dangerPatterns) {
        expect(content, `${file} should not contain ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('no hardcoded emails in app.js except ADMIN_EMAIL', () => {
    const content = readFileSync(join(ROOT, 'app.js'), 'utf8');
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = [...content.matchAll(emailRegex)].map(m => m[0]);
    const allowed = ['zahareus@gmail.com'];
    const unexpected = emails.filter(e => !allowed.includes(e));
    expect(unexpected, 'Unexpected hardcoded emails found').toEqual([]);
  });

  it('no escaped template literals in client JS', () => {
    const content = readFileSync(join(ROOT, 'app.js'), 'utf8');
    const escaped = content.match(/\\\$\{/g);
    expect(escaped, 'Found escaped template literals — likely a bug').toBeNull();
  });

  it('all API endpoints in api/ directory export a handler', () => {
    const apiDir = join(ROOT, 'api');
    const files = readdirSync(apiDir).filter(f => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = readFileSync(join(apiDir, file), 'utf8');
      expect(content, `${file} should export a handler`).toMatch(/module\.exports|export\s+default/);
    }
  });

  it('index.html references app.js and style.css', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('app.js');
    expect(html).toContain('style.css');
  });
});
