# PLAYERS Official Website

PLAYERS is a responsive company website with a Node.js/Express enquiry API. The frontend is static HTML, CSS, and JavaScript hosted on Cloudflare Workers; the API stores enquiries in Supabase PostgreSQL.

## Features

- Responsive company website with an accessible contact form.
- Express REST API with strict request validation, CORS allowlisting, security headers, and structured errors.
- Supabase PostgreSQL persistence with row-level security and a server-only credential.
- Cloudflare Turnstile verification and per-IP rate limiting.
- UUID-based idempotency to prevent duplicate enquiry records.
- Email delivery is intentionally not integrated. Enquiry responses confirm storage only and do not claim that anyone was emailed.

## Technology Stack

- Frontend: HTML, CSS, and browser JavaScript.
- Backend: Node.js 20+, Express 5, and Zod validation.
- Data: Supabase PostgreSQL and Row Level Security.
- Abuse prevention: Cloudflare Turnstile and Upstash Redis.

## Architecture

- `index.html`, `styles.css`, and `script.js`: static website and contact form.
- `backend/src/app.js`: Express middleware and HTTP routes.
- `backend/src/config.js`: validated environment configuration.
- `backend/src/validation.js`: strict request schema.
- `backend/src/services/`: Turnstile verification and shared rate limiting.
- `backend/supabase/schema.sql`: private enquiry table and indexes.

## Requirements

- Node.js 20 or newer and npm
- Supabase project
- Cloudflare Turnstile widget (optional; rate limiting remains enabled without it)
- Upstash Redis database (optional locally, required in production)

## Local setup

1. Apply `backend/supabase/schema.sql` in the Supabase SQL Editor.
2. Copy `backend/.env.example` to `backend/.env`. Set the Supabase project URL and server-only secret key; never put the secret in frontend code. Configure Turnstile for production and allow the deployed Workers hostname. Upstash may be omitted locally; production startup requires it. Keep `.env` out of source control.
3. From `backend/`, run `npm install`, then `npm test`.
4. Start the API with `npm run dev`. It listens on `http://localhost:3000` by default.
5. Serve the website over HTTP (for example with VS Code Live Server). Set `FRONTEND_ORIGIN` to the exact public site origin and the `players-api-url` meta tag in `index.html` to the API base URL when frontend and API use different origins; leave the meta value empty only when a reverse proxy exposes `/api` on the same origin.
6. Add the local frontend origin to `CORS_ORIGINS`. If using Turnstile, allow `localhost` in `TURNSTILE_ALLOWED_HOSTNAMES` and configure the widget for that hostname.

## API

`GET /api/health/live` returns the liveness status. `GET /api/config` exposes only the public Turnstile site key. `POST /api/enquiries` accepts `submissionId` (UUID), `name`, `email`, `service`, `message`, and a `turnstileToken`; success returns HTTP 201 and confirms storage only. Repeated requests with the same submission ID return idempotent success. Invalid submissions return HTTP 400, rate limits return HTTP 429, and temporary service failures return HTTP 503.

The API trims and bounds text, validates email and service values, rejects unknown fields, verifies Turnstile, and stores each submission ID under a unique database index. The form generates one UUID per enquiry and retains it on network failure so retries do not create duplicates. The API limits each client IP to five submissions per hour. With Upstash configured, the limiter is shared across instances; local development falls back to an in-process limiter.

## Deployment

Deploy `backend/` as a Node.js service and configure variables from `.env.example` in the hosting dashboard. Set `NODE_ENV=production`, the Supabase URL and secret, exact `FRONTEND_ORIGIN`, production Turnstile keys and hostname, and Upstash REST credentials. Set `TRUST_PROXY` to the hosting proxy configuration. Apply SQL migrations manually in Supabase; the API does not execute DDL at startup. Deploy the static site to Cloudflare Workers with the API base URL in its meta tag. Email is intentionally disabled until a custom domain and approved delivery service are available.

Set `TRUST_PROXY` to the exact number of trusted reverse-proxy hops used by the deployment. Leave it at `0` when the service is directly exposed; an incorrect value can make client-IP rate limits unreliable.

The Supabase table has row-level security enabled with no browser-facing policies; only the backend secret can access it. Use TLS, secret rotation, provider monitoring, and backups/retention policies. The health endpoint is a liveness check and intentionally does not expose dependency credentials or state.

## SEO and static assets

The website includes a favicon, canonical and Open Graph metadata, `robots.txt`, and `sitemap.xml` for its current Workers URL. Update these URLs if the frontend hostname changes.

## Testing

Run `npm test` from `backend/`. The frontend has no bundler or production-build step; serve the static files and test the deployed page in a browser. Do not send live enquiry requests except with explicit authorization.
