import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const baseEnvironment = {
  NODE_ENV: 'development',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key'
};

test('allows optional providers to be omitted in development', () => {
  const config = loadConfig(baseEnvironment);
  assert.equal(config.turnstileEnabled, false);
  assert.equal(config.resendEnabled, false);
  assert.equal(config.upstashEnabled, false);
});

test('rejects partially configured optional providers', () => {
  assert.throws(() => loadConfig({ ...baseEnvironment, TURNSTILE_SITE_KEY: 'public-key' }), /TURNSTILE_SECRET_KEY/);
  assert.throws(() => loadConfig({ ...baseEnvironment, RESEND_API_KEY: 'test-key' }), /EMAIL_FROM/);
});

test('requires Upstash for production shared rate limiting', () => {
  assert.throws(() => loadConfig({ ...baseEnvironment, NODE_ENV: 'production' }), /UPSTASH_REDIS_REST_URL/);
});

test('uses the modern Supabase secret key and ignores the publishable key for server auth', () => {
  const config = loadConfig({
    ...baseEnvironment,
    SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test'
  });
  assert.equal(config.supabaseServerKey, 'sb_secret_test');
});

test('keeps accepting the legacy Supabase service-role key', () => {
  const config = loadConfig({ ...baseEnvironment, SUPABASE_SECRET_KEY: '' });
  assert.equal(config.supabaseServerKey, 'server-only-test-key');
});

test('requires a server-side Supabase key', () => {
  assert.throws(() => loadConfig({
    NODE_ENV: 'development',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test'
  }), /SUPABASE_SECRET_KEY/);
});