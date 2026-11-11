import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createRateLimitMiddleware } from '../src/services/rate-limit.js';

const validEnquiry = {
  submissionId: '01234567-89ab-4cde-8fab-0123456789ab',
  name: 'Jordan Lee',
  email: 'jordan@example.com',
  service: 'AI-Powered Applications',
  message: 'We are looking for help building a customer support assistant.',
  turnstileToken: 'valid-turnstile-token'
};

function createTestApp({ captchaValid = true, rateLimit, turnstileEnabled = true, duplicateSubmission = false } = {}) {
  const state = { stored: [], captchaChecks: 0 };
  const supabase = {
    from() {
      return {
        insert(enquiry) {
          if (!duplicateSubmission) state.stored.push(enquiry);
          return {
            select() { return this; },
            async single() {
              return duplicateSubmission
                ? { data: null, error: { code: '23505', message: 'unique violation' } }
                : { data: { id: 'enquiry-123' }, error: null };
            }
          };
        }
      };
    }
  };
  const app = createApp({
    config: {
      TRUST_PROXY: 0,
      corsOrigins: ['https://players.example'],
      TURNSTILE_SITE_KEY: 'public-site-key',
      TURNSTILE_SECRET_KEY: 'server-secret',
      turnstileEnabled,
      turnstileAllowedHostnames: ['players.example']
    },
    supabase,
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

test('stores a valid enquiry without triggering email', async () => {
  const { app, state } = createTestApp();
  const response = await request(app).post('/api/enquiries').send(validEnquiry).expect(201);
  assert.equal(response.body.success, true);
  assert.equal(state.stored.length, 1);
  assert.equal(state.stored[0].turnstileToken, undefined);
  assert.equal(state.stored[0].submission_id, validEnquiry.submissionId);
  assert.equal(state.stored[0].notification_status, 'disabled');
});

test('rejects invalid data before database storage', async () => {
  const { app, state } = createTestApp();
  await request(app).post('/api/enquiries').send({ ...validEnquiry, email: 'bad' }).expect(400);
  assert.equal(state.stored.length, 0);
});

test('rejects a failed Turnstile verification without storing the enquiry', async () => {
  const { app, state } = createTestApp({ captchaValid: false });
  await request(app).post('/api/enquiries').send(validEnquiry).expect(400);
  assert.equal(state.stored.length, 0);
});

test('returns idempotent success for a repeated submission ID', async () => {
  const { app, state } = createTestApp({ duplicateSubmission: true });
  const response = await request(app).post('/api/enquiries').send(validEnquiry).expect(200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.duplicate, true);
  assert.equal(state.stored.length, 0);
});

test('does not process requests rejected by the rate limiter', async () => {
  const rateLimit = (request, response) => response.status(429).json({ success: false });
  const { app, state } = createTestApp({ rateLimit });
  await request(app).post('/api/enquiries').send(validEnquiry).expect(429);
  assert.equal(state.stored.length, 0);
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

test('stores an enquiry when Turnstile is disabled for local development', async () => {
  const { app, state } = createTestApp({ turnstileEnabled: false });
  await request(app).post('/api/enquiries').send({ ...validEnquiry, turnstileToken: undefined }).expect(201);
  assert.equal(state.captchaChecks, 0);
  assert.equal(state.stored[0].notification_status, 'disabled');
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