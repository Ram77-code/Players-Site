# PLAYERS Official Website

Responsive single-page website with an Express enquiry API. The frontend remains plain HTML, CSS, and JavaScript; the backend stores enquiries in Supabase and can use Cloudflare Turnstile, Upstash Redis, and Resend when configured.

## Features

- Responsive company website with an accessible contact form.
- Express REST API with strict request validation, CORS allowlisting, security headers, and structured errors.
- Supabase PostgreSQL persistence with row-level security and a server-only credential.
- Cloudflare Turnstile verification and per-IP rate limiting.
- Resend team notifications with idempotent retry processing.
- Optional local-development integrations with production safeguards for shared rate limits.

## Technology Stack

- Frontend: HTML, CSS, and browser JavaScript.
- Backend: Node.js 20+, Express 5, and Zod validation.
- Data: Supabase PostgreSQL and Row Level Security.
- Integrations: Cloudflare Turnstile, Resend, and Upstash Redis.

## Architecture

- `index.html`, `styles.css`, and `script.js`: static website and contact form.
- `backend/src/app.js`: Express middleware and HTTP routes.
- `backend/src/config.js`: validated environment configuration.
- `backend/src/validation.js`: strict request schema.
- `backend/src/services/`: Turnstile verification and shared rate limiting.
- `backend/supabase/schema.sql`: private enquiry table and indexes.

The API persists each validated enquiry before attempting email delivery. Delivery outcomes are recorded as `pending`, `processing`, `sent`, `failed`, or `disabled`; a notification failure does not discard an enquiry already stored. A scheduled retry job claims notifications atomically from Supabase, retries with the same Resend idempotency key, and stops after five attempts.

## Requirements

- Node.js 20 or newer and npm
- Supabase project
- Resend account with a verified sender domain (optional for local development)
- Cloudflare Turnstile widget (optional; rate limiting remains enabled without it)
- Upstash Redis database (optional locally, required in production)

## Local setup

1. Apply `backend/supabase/schema.sql` in the Supabase SQL Editor.
2. Copy `backend/.env.example` to `backend/.env` and set the Supabase URL and server-side secret key (`SUPABASE_SECRET_KEY`; legacy `SUPABASE_SERVICE_ROLE_KEY` is also accepted). The publishable key is not used by this site and must never be substituted for the secret. Configure Resend and Turnstile as complete groups or leave each group empty. Upstash may be omitted locally; production startup requires it. Keep `.env` out of source control.
3. From `backend/`, run `npm install`, then `npm test`.
4. Start the API with `npm run dev`. It listens on `http://localhost:3000` by default.
5. Serve the website over HTTP (for example with VS Code Live Server). Set `FRONTEND_ORIGIN` to the exact public site origin and the `players-api-url` meta tag in `index.html` to the API base URL when frontend and API use different origins; leave the meta value empty only when a reverse proxy exposes `/api` on the same origin.
6. Add the local frontend origin to `CORS_ORIGINS`. If using Turnstile, allow `localhost` in `TURNSTILE_ALLOWED_HOSTNAMES` and configure the widget for that hostname.

## API

`GET /api/health/live` returns the liveness status. `GET /api/config` exposes only the public Turnstile site key (or `null` when disabled). `POST /api/enquiries` accepts JSON fields `name`, `email`, `service`, `message`, and an optional `turnstileToken`; success returns HTTP 201 and a user-safe confirmation. Invalid submissions return HTTP 400, rate limits return HTTP 429, and temporary service failures return HTTP 503.

The API accepts only the service names shown in the contact form, bounds all field sizes, rejects unexpected properties, and limits each client IP to five submissions per hour. With Upstash configured, the limiter is shared across instances; local development falls back to an in-process limiter. Turnstile verification is enforced when configured. If Resend is omitted, the enquiry is still stored with notification status `disabled`.

## Deployment

Deploy `backend/` as a Node.js service and configure the variables in `.env.example` in the hosting provider's secret/environment settings. Supabase is required; Upstash is also required in production to retain shared rate limiting. Configure Resend and Turnstile to enable email alerts and challenge verification. Keep `SUPABASE_SECRET_KEY` (or its legacy service-role equivalent), `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, and `UPSTASH_REDIS_REST_TOKEN` server-only. Set `FRONTEND_ORIGIN` to the exact production website origin; the backend adds it to the allowlist and removes localhost origins in production. Set `TURNSTILE_ALLOWED_HOSTNAMES` to the production widget hostname and `players-api-url` to the deployed API base when the frontend and API use separate hosts. Resend requires a verified sender domain and correct `EMAIL_FROM`. Schedule `npm run retry:notifications` every 15 minutes (or more frequently); the database claim function prevents overlapping workers and recovers jobs left processing for over 15 minutes.

Set `TRUST_PROXY` to the exact number of trusted reverse-proxy hops used by the deployment. Leave it at `0` when the service is directly exposed; an incorrect value can make client-IP rate limits unreliable.

The Supabase table has row-level security enabled with no browser-facing policies; only the backend service-role credential can access it. Use TLS, secret rotation, provider monitoring, backups/retention policies, and production Turnstile keys before launch. The health endpoint is a liveness check and intentionally does not expose dependency credentials or state.

## Testing

Run `npm test` from `backend/`. Tests cover configuration, all API routes, validation, provider-disabled behavior, persistence and notification flow, rate limits, captcha rejection, and notification retry behavior. Live Supabase, Resend, Turnstile, and Redis interactions should be smoke-tested in the target environment with provisioned credentials.
