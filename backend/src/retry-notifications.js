import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { loadConfig } from './config.js';
import { retryNotifications } from './services/retry-notifications.js';

try {
  const config = loadConfig();
  if (!config.resendEnabled) {
    console.info({ event: 'notification_retry_skipped', reason: 'resend_not_configured' });
    process.exit(0);
  }
  const supabase = createClient(config.SUPABASE_URL, config.supabaseServerKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const resend = new Resend(config.RESEND_API_KEY);
  const result = await retryNotifications({ supabase, resend, config, logger: console });
  console.info({ event: 'notification_retry_complete', ...result });
  if (result.failed > 0) process.exitCode = 1;
} catch (error) {
  console.error({ event: 'notification_retry_job_failed', error: error.message });
  process.exitCode = 1;
}