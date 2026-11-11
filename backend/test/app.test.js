import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createRateLimitMiddleware } from '../src/services/rate-limit.js';
import { retryNotifications } from '../src/services/retry-notifications.js';

const validEnquiry = {
  name: 'Jordan Lee',
  email: 'jordan@example.com',
  service: 'AI-Powered Applications',
  message: 'We are looking for help building a customer support assistant.',
  turnstileToken: 'valid-turnstile-token'
};

function createTestApp({ notificationError, captchaValid = true, rateLimit, turnstileEnabled = true, resendEnabled = true } = {}) {
  const state = { stored: [], statusUpdates: [], emails: [], captchaChecks: 0 };
  const supabase = {
    from() {
      return {
        insert(enquiry) {
          state.stored.push(enquiry);
          return {
            select() { return this; },
            async single() { return { data: { id: 'enquiry-123' }, error: null }; }
          };
        },
        update(values) {
          return {
            async eq() {
              state.statusUpdates.push(values);
              return { error: null };
            }
          };
        }
      };
    }
  };
  const resend = { emails: { async send(message, options) {
    state.emails.push({ message, options });
    return { error: notificationError || null };
  } } };
  const app = createApp({
    config: {
      TRUST_PROXY: 0,
      corsOrigins: ['https://players.example'],
      TURNSTILE_SITE_KEY: 'public-site-key',
      TURNSTILE_SECRET_KEY: 'server-secret',
      EMAIL_FROM: 'PLAYERS <enquiries@example.com>',
      EMAIL_TO: 'team@example.com',
      turnstileEnabled,
      resendEnabled,
      turnstileAllowedHostnames: ['players.example']
    },
    supabase,
    resend,
    rateLimit: rateLimit || ((request, response, next) => next()),
    verifyCaptcha: async () => { state.captchaChecks += 1; return captchaValid; },
    logger: { error() {} }
  });
  return { app, state };
}

test('serves only the public Turnstile configuration', async () => {
  const { app } = createTestApp();
  const response = await request(app).get('/api/config').expect(200);
  assert.deepEqual(response.body, { turnstileSiteKey: 'public-site-key' });
});

test('stores a valid enquiry and sends the team notification', async () => {
  const { app, state } = createTestApp();
  const response = await request(app).post('/api/enquiries').send(validEnquiry).expect(201);
  assert.equal(response.body.success, true);
  assert.equal(state.stored.length, 1);
  assert.equal(state.stored[0].turnstileToken, undefined);
  assert.equal(state.emails.length, 1);
  assert.equal(state.emails[0].options.idempotencyKey, 'enquiry-enquiry-123');
  assert.equal(state.statusUpdates[0].notification_status, 'sent');
});

test('rejects invalid data before contacting providers', async () => {
  const { app, state } = createTestApp();
  await request(app).post('/api/enquiries').send({ ...validEnquiry, email: 'bad' }).expect(400);
  assert.equal(state.stored.length, 0);
  assert.equal(state.emails.length, 0);
});

test('keeps the enquiry when email notification fails and records delivery status', async () => {
  const { app, state } = createTestApp({ notificationError: new Error('provider unavailable') });
  await request(app).post('/api/enquiries').send(validEnquiry).expect(201);
  assert.equal(state.stored.length, 1);
  assert.equal(state.statusUpdates[0].notification_status, 'failed');
});

test('rejects a failed Turnstile verification without storing the enquiry', async () => {
  const { app, state } = createTestApp({ captchaValid: false });
  await request(app).post('/api/enquiries').send(validEnquiry).expect(400);
  assert.equal(state.stored.length, 0);
  assert.equal(state.emails.length, 0);
});

test('does not process requests rejected by the rate limiter', async () => {
  const rateLimit = (request, response) => response.status(429).json({ success: false });
  const { app, state } = createTestApp({ rateLimit });
  await request(app).post('/api/enquiries').send(validEnquiry).expect(429);
  assert.equal(state.stored.length, 0);
});

test('claims and sends retryable notifications', async () => {
  const state = { updates: [], emails: [] };
  const supabase = {
    async rpc(name, parameters) {
      assert.equal(name, 'claim_enquiry_notifications');
      assert.equal(parameters.batch_size, 25);
      return { data: [{ ...validEnquiry, id: 'retry-123' }], error: null };
    },
    from() {
      return { update(values) {
        return { async eq() { state.updates.push(values); return { error: null }; } };
      } };
    }
  };
  const resend = { emails: { async send(message, options) {
    state.emails.push({ message, options });
    return { error: null };
  } } };
  const result = await retryNotifications({
    supabase,
    resend,
    config: { EMAIL_FROM: 'PLAYERS <enquiries@example.com>', EMAIL_TO: 'team@example.com' },
    logger: { error() {} }
  });
  assert.deepEqual(result, { processed: 1, sent: 1, failed: 0 });
  assert.equal(state.emails[0].options.idempotencyKey, 'enquiry-retry-123');
  assert.equal(state.updates[0].notification_status, 'sent');
});

test('serves a liveness response', async () => {
  const { app } = createTestApp();
  const response = await request(app).get('/api/health/live').expect(200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('allows configured browser origins and omits credentials', async () => {
  const { app } = createTestApp();
  const response = await request(app).get('/api/config').set('Origin', 'https://players.example').expect(200);
  assert.equal(response.headers['access-control-allow-origin'], 'https://players.example');
  assert.equal(response.headers['access-control-allow-credentials'], undefined);
  assert.equal(JSON.stringify(response.body).includes('server-secret'), false);
});

test('returns a structured error for malformed JSON', async () => {
  const { app } = createTestApp();
  const response = await request(app)
    .post('/api/enquiries')
    .set('Content-Type', 'application/json')
    .send('{invalid-json')
    .expect(400);
  assert.equal(response.body.error.code, 'invalid_json');
});

test('stores an enquiry when email and Turnstile are disabled', async () => {
  const { app, state } = createTestApp({ turnstileEnabled: false, resendEnabled: false });
  await request(app).post('/api/enquiries').send({ ...validEnquiry, turnstileToken: undefined }).expect(201);
  assert.equal(state.captchaChecks, 0);
  assert.equal(state.emails.length, 0);
  assert.equal(state.stored[0].notification_status, 'disabled');
  assert.equal(state.statusUpdates.length, 0);
});

test('uses the local limiter when Upstash is not configured', async () => {
  const { app, state } = createTestApp({ rateLimit: createRateLimitMiddleware() });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await request(app).post('/api/enquiries').send(validEnquiry).expect(201);
  }
  const response = await request(app).post('/api/enquiries').send(validEnquiry).expect(429);
  assert.equal(response.body.error.code, 'rate_limited');
  assert.equal(state.stored.length, 5);
});