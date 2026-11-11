export async function sendEnquiryNotification(resend, config, enquiry, enquiryId) {
  const result = await resend.emails.send({
    from: config.EMAIL_FROM,
    to: config.EMAIL_TO,
    replyTo: enquiry.email,
    subject: `Website enquiry: ${enquiry.service}`,
    text: [
      `Name: ${enquiry.name}`,
      `Email: ${enquiry.email}`,
      `Service: ${enquiry.service}`,
      '',
      'Project details:',
      enquiry.message
    ].join('\n')
  }, { idempotencyKey: `enquiry-${enquiryId}` });
  if (result.error) throw result.error;
}