import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
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
if (!config.upstashEnabled) {
  console.warn({ event: 'rate_limit_using_process_memory', message: 'Configure Upstash for shared production rate limiting.' });
}
if (!config.turnstileEnabled) {
  console.warn({ event: 'turnstile_disabled', message: 'Contact form submissions are protected by rate limiting only.' });
}
const app = createApp({
  config,
  supabase,
  rateLimit: createRateLimitMiddleware(redis),
  verifyCaptcha: options => verifyTurnstile(options),
  logger: console
});

app.listen(config.PORT, () => {
  console.info({ event: 'server_started', port: config.PORT, environment: config.NODE_ENV });
});