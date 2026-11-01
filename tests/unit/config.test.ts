// T014 — configuration from environment variables with the quickstart.md defaults.
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.ts';

describe('loadConfig', () => {
  it('uses the quickstart.md defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      dbFile: 'data/roombook.db',
      timeZone: 'Europe/Helsinki',
      opensAt: '08:00',
      closesAt: '22:00',
      allowedEmailDomains: ['uni.example'],
      rateLimitPerMinute: 300,
      sessionTtlMs: 8 * 60 * 60 * 1000,
      admin: null,
    });
  });

  it('reads every variable; empty values fall back to the defaults', () => {
    const config = loadConfig({
      PORT: '8080',
      DB_FILE: '/tmp/rb.db',
      CAMPUS_TIME_ZONE: 'Europe/Berlin',
      OPENING_HOURS: '07:30-21:00',
      ALLOWED_EMAIL_DOMAINS: ' Uni.Example, staff.uni.example ,',
      RATE_LIMIT_PER_MINUTE: '50',
      ADMIN_EMAIL: ' Admin@Uni.Example ',
      ADMIN_PASSWORD: 'a very long secret',
      ADMIN_DISPLAY_NAME: ' Facilities Office ',
    });
    expect(config).toMatchObject({
      port: 8080,
      dbFile: '/tmp/rb.db',
      timeZone: 'Europe/Berlin',
      opensAt: '07:30',
      closesAt: '21:00',
      allowedEmailDomains: ['uni.example', 'staff.uni.example'],
      rateLimitPerMinute: 50,
      admin: { email: 'admin@uni.example', password: 'a very long secret', displayName: 'Facilities Office' },
    });
    expect(loadConfig({ ADMIN_EMAIL: 'a@uni.example', ADMIN_PASSWORD: 'a very long secret' }).admin?.displayName).toBe('Administrator');
    expect(loadConfig({ PORT: '', CAMPUS_TIME_ZONE: '  ' })).toMatchObject({ port: 3000, timeZone: 'Europe/Helsinki' });
  });

  it.each([
    [{ PORT: 'abc' }, /PORT/],
    [{ PORT: '70000' }, /PORT/],
    [{ CAMPUS_TIME_ZONE: 'Mars/Olympus' }, /CAMPUS_TIME_ZONE/],
    [{ OPENING_HOURS: '8-22' }, /OPENING_HOURS/],
    [{ OPENING_HOURS: '22:00-08:00' }, /OPENING_HOURS/],
    [{ OPENING_HOURS: '08:15-22:00' }, /OPENING_HOURS/],
    [{ OPENING_HOURS: '08:00-24:00' }, /OPENING_HOURS/],
    [{ ALLOWED_EMAIL_DOMAINS: ' , ' }, /ALLOWED_EMAIL_DOMAINS/],
    [{ ALLOWED_EMAIL_DOMAINS: 'alice@uni.example' }, /ALLOWED_EMAIL_DOMAINS/],
    [{ RATE_LIMIT_PER_MINUTE: '0' }, /RATE_LIMIT_PER_MINUTE/],
    [{ RATE_LIMIT_PER_MINUTE: '1.5' }, /RATE_LIMIT_PER_MINUTE/],
    [{ ADMIN_EMAIL: 'admin@uni.example' }, /together/],
    [{ ADMIN_PASSWORD: 'a very long secret' }, /together/],
    [{ ADMIN_EMAIL: 'not-an-email', ADMIN_PASSWORD: 'a very long secret' }, /ADMIN_EMAIL/],
    [{ ADMIN_EMAIL: 'admin@uni.example', ADMIN_PASSWORD: 'short' }, /ADMIN_PASSWORD/],
    [{ ADMIN_EMAIL: 'admin@uni.example', ADMIN_PASSWORD: '' }, /ADMIN_PASSWORD/],
    [{ ADMIN_EMAIL: 'admin@uni.example', ADMIN_PASSWORD: 'replace-with-a-long-secret' }, /example value/],
    [{ ADMIN_EMAIL: 'admin@uni.example', ADMIN_PASSWORD: 'ADMIN@uni.example' }, /ADMIN_PASSWORD/],
    [{ ADMIN_EMAIL: 'admin@uni.example', ADMIN_PASSWORD: 'a very long secret', ADMIN_DISPLAY_NAME: 'x'.repeat(61) }, /ADMIN_DISPLAY_NAME/],
    [{ ADMIN_EMAIL: 'admin@uni.example', ADMIN_PASSWORD: 'a very long secret', ADMIN_DISPLAY_NAME: 'Bad\u0007Name' }, /ADMIN_DISPLAY_NAME/],
  ])('rejects %o', (env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });
});
