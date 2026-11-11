import { sendEnquiryNotification } from './notifications.js';

export async function retryNotifications({ supabase, resend, config, logger = console, batchSize = 25 }) {
  const claim = await supabase.rpc('claim_enquiry_notifications', { batch_size: batchSize });
  if (claim.error) throw claim.error;

  let sent = 0;
  let failed = 0;
  for (const enquiry of claim.data || []) {
    try {
      await sendEnquiryNotification(resend, config, enquiry, enquiry.id);
      const update = await supabase.from('enquiries').update({
        notification_status: 'sent',
        notification_sent_at: new Date().toISOString()
      }).eq('id', enquiry.id);
      if (update.error) throw update.error;
      sent += 1;
    } catch (error) {
      logger.error({ event: 'enquiry_retry_failed', enquiryId: enquiry.id, error: error.message });
      try {
        const update = await supabase.from('enquiries').update({
          notification_status: 'failed',
          notification_sent_at: null
        }).eq('id', enquiry.id);
        if (update.error) throw update.error;
      } catch (statusError) {
        logger.error({ event: 'enquiry_retry_status_update_failed', enquiryId: enquiry.id, error: statusError.message });
      }
      failed += 1;
    }
  }

  return { processed: sent + failed, sent, failed };
}