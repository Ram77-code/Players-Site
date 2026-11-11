import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  CORS_ORIGINS: z.string().default('http://localhost:5500'),
  FRONTEND_ORIGIN: z.string().url().default('https://players-site.players-technology77.workers.dev'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().default(''),
  SUPABASE_PUBLISHABLE_KEY: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default(''),
  EMAIL_TO: z.union([z.literal(''), z.string().email()]).default(''),
  TURNSTILE_SECRET_KEY: z.string().default(''),
  TURNSTILE_SITE_KEY: z.string().default(''),
  TURNSTILE_ALLOWED_HOSTNAMES: z.string().default(''),
  UPSTASH_REDIS_REST_URL: z.union([z.literal(''), z.string().url()]).default(''),
  UPSTASH_REDIS_REST_TOKEN: z.string().default('')
}).superRefine((config, context) => {
  const corsOrigins = config.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const parsedOrigin = new URL(origin);
      if (origin === '*' || parsedOrigin.origin !== origin || !['http:', 'https:'].includes(parsedOrigin.protocol)) {
        throw new Error('Invalid origin');
      }
    } catch {
      context.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Use a comma-separated list of exact HTTP(S) origins.' });
      break;
    }
  }

  if (config.NODE_ENV === 'production' && new URL(config.FRONTEND_ORIGIN).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['FRONTEND_ORIGIN'], message: 'The production frontend origin must use HTTPS.' });
  }

  if (!config.SUPABASE_SECRET_KEY && !config.SUPABASE_SERVICE_ROLE_KEY) {
    context.addIssue({
      code: 'custom',
      path: ['SUPABASE_SECRET_KEY'],
      message: 'Set SUPABASE_SECRET_KEY or the legacy SUPABASE_SERVICE_ROLE_KEY.'
    });
  }

  const providerGroups = [
    ['RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_TO'],
    ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']
  ];

  for (const group of providerGroups) {
    const configured = group.filter(key => config[key].length > 0);
    if (configured.length > 0 && configured.length < group.length) {
      context.addIssue({
        code: 'custom',
        path: [group.find(key => !config[key])],
        message: 'Configure all values for this provider or leave all of them empty.'
      });
    }
  }

  if (config.NODE_ENV === 'production' && !config.UPSTASH_REDIS_REST_URL) {
    context.addIssue({
      code: 'custom',
      path: ['UPSTASH_REDIS_REST_URL'],
      message: 'Upstash is required in production for shared rate limiting.'
    });
  }
});

export function loadConfig(environment = process.env) {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) {
    const missing = parsed.error.issues.map(issue => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${missing}`);
  }

  const frontendOrigin = new URL(parsed.data.FRONTEND_ORIGIN).origin;
  const configuredOrigins = parsed.data.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
  const corsOrigins = configuredOrigins.filter(origin => {
    if (parsed.data.NODE_ENV !== 'production') return true;
    const hostname = new URL(origin).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '::1'].includes(hostname);
  });

  return {
    ...parsed.data,
    supabaseServerKey: parsed.data.SUPABASE_SECRET_KEY || parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    corsOrigins: [...new Set([frontendOrigin, ...corsOrigins])],
    turnstileAllowedHostnames: parsed.data.TURNSTILE_ALLOWED_HOSTNAMES.split(',').map(host => host.trim().toLowerCase()).filter(Boolean),
    resendEnabled: Boolean(parsed.data.RESEND_API_KEY),
    turnstileEnabled: Boolean(parsed.data.TURNSTILE_SECRET_KEY),
    upstashEnabled: Boolean(parsed.data.UPSTASH_REDIS_REST_URL)
  };
}