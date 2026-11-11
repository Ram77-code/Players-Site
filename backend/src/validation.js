import { z } from 'zod';

export const enquirySchema = z.object({
  submissionId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  service: z.enum([
    'Full-Stack Web Development',
    'Custom Software Development',
    'AI-Powered Applications',
    'Intelligent AI Agents',
    'Business Process Automation',
    'Digital Product Engineering',
    'Something else'
  ]),
  message: z.string().trim().min(20).max(5000),
  turnstileToken: z.string().trim().min(1).max(2048).optional()
}).strict();