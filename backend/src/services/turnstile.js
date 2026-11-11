const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile({ secret, token, remoteIp, allowedHostnames }) {
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return false;

    const result = await response.json();
    if (!result.success) return false;
    return allowedHostnames.length === 0 || allowedHostnames.includes(String(result.hostname || '').toLowerCase());
  } catch {
    return false;
  }
}