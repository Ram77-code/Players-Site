import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { enquirySchema } from './validation.js';

function errorResponse(response, status, code, message, fields) {
  return response.status(status).json({
    success: false,
    error: { code, message, ...(fields ? { fields } : {}) }
  });
}

export function createApp({ config, supabase, rateLimit, verifyCaptcha, logger = console }) {
  const app = express();
  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || config.corsOrigins.includes(origin));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 600
  }));
  app.use(express.json({ limit: '10kb', strict: true }));

  app.get('/api/health/live', (request, response) => response.json({ status: 'ok' }));
  app.get('/api/config', (request, response) => {
    response.set('Cache-Control', 'public, max-age=300');
    return response.json({ turnstileSiteKey: config.turnstileEnabled ? config.TURNSTILE_SITE_KEY : null });
  });

  app.post('/api/enquiries', rateLimit, async (request, response) => {
    const parsed = enquirySchema.safeParse(request.body);
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0], issue.message]));
      return errorResponse(response, 400, 'invalid_input', 'Check the enquiry details and try again.', fields);
    }

    const { submissionId, turnstileToken, ...enquiry } = parsed.data;
    if (config.turnstileEnabled) {
      if (!turnstileToken) {
        return errorResponse(response, 400, 'captcha_required', 'Complete the spam protection check and try again.');
      }
      const captchaValid = await verifyCaptcha({
        token: turnstileToken,
        remoteIp: request.ip,
        secret: config.TURNSTILE_SECRET_KEY,
        allowedHostnames: config.turnstileAllowedHostnames
      });
      if (!captchaValid) {
        return errorResponse(response, 400, 'captcha_failed', 'Spam protection could not verify this request. Please try again.');
      }
    }

    try {
      const result = await supabase.from('enquiries').insert({
        ...enquiry,
        submission_id: submissionId,
        notification_status: 'disabled',
        notification_attempts: 0,
        notification_attempted_at: null
      }).select('id').single();
      if (result.error) throw result.error;
    } catch (error) {
      if (error.code === '23505') {
        return response.status(200).json({
          success: true,
          duplicate: true,
          message: 'This enquiry was already received.'
        });
      }
      logger.error({ event: 'enquiry_storage_failed', error: error.message });
      return errorResponse(response, 503, 'storage_unavailable', 'We could not receive your enquiry right now. Please try again shortly.');
    }

    return response.status(201).json({
      success: true,
      message: 'Thanks. Your enquiry has been received.'
    });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') {
      return errorResponse(response, 400, 'invalid_json', 'The request body must be valid JSON.');
    }
    if (error.type === 'entity.too.large') {
      return errorResponse(response, 413, 'request_too_large', 'The enquiry is too large.');
    }
    logger.error({ event: 'request_failed', error: error.message });
    return errorResponse(response, 500, 'internal_error', 'Something went wrong. Please try again later.');
  });

  return app;
}