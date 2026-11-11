import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createRateLimitMiddleware } from './services/rate-limit.js';
import { verifyTurnstile } from './services/turnstile.js';

const config = loadConfig();
const supabase = createClient(config.SUPABASE_URL, config.supabaseServerKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const redis = config.upstashEnabled ? new Redis({
  url: config.UPSTASH_REDIS_REST_URL,
  token: config.UPSTASH_REDIS_REST_TOKEN
}) : undefined;
const resend = config.resendEnabled ? new Resend(config.RESEND_API_KEY) : undefined;
if (!config.upstashEnabled) {
  console.warn({ event: 'rate_limit_using_process_memory', message: 'Configure Upstash for shared production rate limiting.' });
}
if (!config.turnstileEnabled) {
  console.warn({ event: 'turnstile_disabled', message: 'Contact form submissions are protected by rate limiting only.' });
}
if (!config.resendEnabled) {
  console.warn({ event: 'email_notifications_disabled', message: 'Enquiries will be stored without email notifications.' });
}
const app = createApp({
  config,
  supabase,
  resend,
  rateLimit: createRateLimitMiddleware(redis),
  verifyCaptcha: options => verifyTurnstile(options),
  logger: console
});

app.listen(config.PORT, () => {
  console.info({ event: 'server_started', port: config.PORT, environment: config.NODE_ENV });
});