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
  assert.equal(config.upstashEnabled, false);
});

test('rejects partially configured optional providers', () => {
  assert.throws(() => loadConfig({ ...baseEnvironment, TURNSTILE_SITE_KEY: 'public-key' }), /TURNSTILE_SECRET_KEY/);
});

test('requires Upstash for production shared rate limiting', () => {
  assert.throws(() => loadConfig({ ...baseEnvironment, NODE_ENV: 'production' }), /UPSTASH_REDIS_REST_URL/);
});

test('defaults to production safeguards when NODE_ENV is unset', () => {
  assert.throws(() => loadConfig({ ...baseEnvironment, NODE_ENV: undefined }), /UPSTASH_REDIS_REST_URL/);
});

test('allows the configured frontend origin and excludes loopback origins in production', () => {
  const config = loadConfig({
    ...baseEnvironment,
    NODE_ENV: 'production',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
    UPSTASH_REDIS_REST_TOKEN: 'test-token',
    TURNSTILE_SECRET_KEY: 'test-secret',
    TURNSTILE_SITE_KEY: 'public-site-key',
    TURNSTILE_ALLOWED_HOSTNAMES: 'players.example',
    CORS_ORIGINS: 'http://localhost:5500,https://preview.players.example',
    FRONTEND_ORIGIN: 'https://players.example'
  });
  assert.deepEqual(config.corsOrigins, ['https://players.example', 'https://preview.players.example']);
});

test('rejects wildcard CORS configuration', () => {
  assert.throws(() => loadConfig({ ...baseEnvironment, CORS_ORIGINS: '*' }), /CORS_ORIGINS/);
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

test('requires Turnstile and a hostname allowlist in production', () => {
  const production = {
    ...baseEnvironment,
    NODE_ENV: 'production',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
    UPSTASH_REDIS_REST_TOKEN: 'test-token'
  };
  assert.throws(() => loadConfig(production), /TURNSTILE_SECRET_KEY/);
  assert.throws(() => loadConfig({ ...production, TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_SITE_KEY: 'site' }), /TURNSTILE_ALLOWED_HOSTNAMES/);
});