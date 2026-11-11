const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
menuButton.addEventListener('click', () => {
  const isOpen = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
  menuButton.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
});
nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
}));
document.getElementById('year').textContent = new Date().getFullYear();

const apiBaseUrl = document.querySelector('meta[name="players-api-url"]').content.trim().replace(/\/+$/, '');
const apiUrl = path => `${apiBaseUrl}${path}`;
const contactForm = document.getElementById('contactForm');
const formNote = document.getElementById('formNote');
const submitButton = contactForm.querySelector('button[type="submit"]');
const submitLabel = submitButton.querySelector('.submit-label');
let turnstileWidgetId;
let turnstileToken = '';
let submissionId = crypto.randomUUID();

function setFormStatus(message, state = '') {
  formNote.textContent = message;
  formNote.dataset.state = state;
}

async function initializeTurnstile() {
  try {
    const configResponse = await fetch(apiUrl('/api/config'), { headers: { Accept: 'application/json' } });
    if (!configResponse.ok) throw new Error('Contact configuration unavailable');
    const { turnstileSiteKey } = await configResponse.json();
    if (!turnstileSiteKey) return;

    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });

    turnstileWidgetId = window.turnstile.render('#turnstileWidget', {
      sitekey: turnstileSiteKey,
      callback: token => { turnstileToken = token; },
      'expired-callback': () => { turnstileToken = ''; },
      'error-callback': () => { turnstileToken = ''; }
    });
  } catch {
    setFormStatus('The secure contact form is temporarily unavailable. Please try again later.', 'error');
    submitButton.disabled = true;
  }
}

contactForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!contactForm.reportValidity()) return;
  if (window.turnstile && !turnstileToken) {
    setFormStatus('Please complete the spam protection check before sending.', 'error');
    return;
  }

  submitButton.disabled = true;
  submitLabel.textContent = 'Sending...';
  setFormStatus('Sending your enquiry...');

  const formData = new FormData(contactForm);
  const payload = Object.fromEntries(['name', 'email', 'service', 'message'].map(name => [name, formData.get(name)]));
  payload.submissionId = submissionId;
  if (turnstileToken) payload.turnstileToken = turnstileToken;

  try {
    const response = await fetch(apiUrl('/api/enquiries'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error?.message || 'We could not send your enquiry. Please try again.');

    contactForm.reset();
    submissionId = crypto.randomUUID();
    setFormStatus(result.message || 'Thanks. Your enquiry has been received.', 'success');
  } catch (error) {
    const message = error.name === 'TimeoutError'
      ? 'The request timed out. Please try again.'
      : error.message || 'We could not send your enquiry. Please try again.';
    setFormStatus(message, 'error');
  } finally {
    turnstileToken = '';
    if (window.turnstile && turnstileWidgetId !== undefined) window.turnstile.reset(turnstileWidgetId);
    submitButton.disabled = false;
    submitLabel.textContent = 'Send enquiry';
  }
});

initializeTurnstile();
