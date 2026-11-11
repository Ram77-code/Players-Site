import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { sendEnquiryNotification } from './services/notifications.js';
import { enquirySchema } from './validation.js';

function errorResponse(response, status, code, message, fields) {
  return response.status(status).json({
    success: false,
    error: { code, message, ...(fields ? { fields } : {}) }
  });
}

export function createApp({ config, supabase, resend, rateLimit, verifyCaptcha, logger = console }) {
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

    const { turnstileToken, ...enquiry } = parsed.data;
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

    let record;
    try {
      const result = await supabase.from('enquiries').insert({
        ...enquiry,
        notification_status: config.resendEnabled ? 'processing' : 'disabled',
        notification_attempts: config.resendEnabled ? 1 : 0,
        notification_attempted_at: config.resendEnabled ? new Date().toISOString() : null
      }).select('id').single();
      if (result.error) throw result.error;
      record = result.data;
    } catch (error) {
      logger.error({ event: 'enquiry_storage_failed', error: error.message });
      return errorResponse(response, 503, 'storage_unavailable', 'We could not receive your enquiry right now. Please try again shortly.');
    }

    let notificationSent = false;
    if (config.resendEnabled) {
      try {
        await sendEnquiryNotification(resend, config, enquiry, record.id);
        notificationSent = true;
      } catch (error) {
        logger.error({ event: 'enquiry_notification_failed', enquiryId: record.id, error: error.message });
      }

      try {
        const update = supabase.from('enquiries').update({
          notification_status: notificationSent ? 'sent' : 'failed',
          notification_sent_at: notificationSent ? new Date().toISOString() : null
        }).eq('id', record.id);
        const result = await update;
        if (result.error) throw result.error;
      } catch (error) {
        logger.error({ event: 'enquiry_status_update_failed', enquiryId: record.id, error: error.message });
      }
    }

    return response.status(201).json({
      success: true,
      message: 'Thanks. Your enquiry has been received and the PLAYERS team will be in touch.'
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