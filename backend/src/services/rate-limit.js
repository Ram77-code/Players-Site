import { createHash } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';

export function createRateLimitMiddleware(redis, logger = console) {
  if (!redis) {
    const requestsByClient = new Map();
    const windowMs = 60 * 60 * 1000;
    const limit = 5;

    return function localRateLimit(request, response, next) {
      const now = Date.now();
      const identifier = createHash('sha256').update(request.ip || 'unknown').digest('hex');
      const timestamps = (requestsByClient.get(identifier) || []).filter(timestamp => timestamp > now - windowMs);
      const reset = timestamps.length ? timestamps[0] + windowMs : now + windowMs;
      response.set('RateLimit-Limit', String(limit));
      response.set('RateLimit-Reset', String(Math.ceil(reset / 1000)));

      if (timestamps.length >= limit) {
        response.set('RateLimit-Remaining', '0');
        response.set('Retry-After', String(Math.max(1, Math.ceil((reset - now) / 1000))));
        return response.status(429).json({
          success: false,
          error: { code: 'rate_limited', message: 'Too many enquiries. Please try again later.' }
        });
      }

      timestamps.push(now);
      requestsByClient.set(identifier, timestamps);
      response.set('RateLimit-Remaining', String(limit - timestamps.length));
      if (requestsByClient.size > 5000) {
        for (const [client, entries] of requestsByClient) {
          const activeEntries = entries.filter(timestamp => timestamp > now - windowMs);
          if (activeEntries.length) requestsByClient.set(client, activeEntries);
          else requestsByClient.delete(client);
        }
      }
      return next();
    };
  }

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 h'),
    analytics: true,
    prefix: 'players:contact'
  });

  return async function rateLimitRequest(request, response, next) {
    const identifier = createHash('sha256').update(request.ip || 'unknown').digest('hex');
    try {
      const result = await limiter.limit(identifier);
      response.set('RateLimit-Limit', String(result.limit));
      response.set('RateLimit-Remaining', String(result.remaining));
      response.set('RateLimit-Reset', String(Math.ceil(result.reset / 1000)));
      if (!result.success) {
        response.set('Retry-After', String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))));
        return response.status(429).json({
          success: false,
          error: { code: 'rate_limited', message: 'Too many enquiries. Please try again later.' }
        });
      }
      return next();
    } catch (error) {
      logger.error({ event: 'rate_limit_unavailable', error: error.message });
      return response.status(503).json({
        success: false,
        error: { code: 'service_unavailable', message: 'The contact service is temporarily unavailable.' }
      });
    }
  };
}