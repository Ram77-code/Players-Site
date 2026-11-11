import test from 'node:test';
import assert from 'node:assert/strict';
import { enquirySchema } from '../src/validation.js';

const validEnquiry = {
  name: 'Jordan Lee',
  email: 'jordan@example.com',
  service: 'AI-Powered Applications',
  message: 'We are looking for help building a customer support assistant.',
  turnstileToken: 'valid-turnstile-token'
};

test('accepts a complete enquiry', () => {
  assert.equal(enquirySchema.safeParse(validEnquiry).success, true);
});

test('rejects invalid email, unsupported service, short message, and extra fields', () => {
  const result = enquirySchema.safeParse({
    ...validEnquiry,
    email: 'not-an-email',
    service: 'Unlisted service',
    message: 'Too short',
    unexpected: 'no'
  });
  assert.equal(result.success, false);
});