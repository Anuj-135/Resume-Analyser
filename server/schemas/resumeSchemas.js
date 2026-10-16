const { z } = require('zod');

const createResumeBodySchema = z
  .object({
    companyName: z
      .string({ message: 'Company name is required' })
      .trim()
      .min(1, 'Company name is required')
      .max(100, 'Company name cannot exceed 100 characters'),

    jobTitle: z
      .string({ message: 'Job title is required' })
      .trim()
      .min(1, 'Job title is required')
      .max(100, 'Job title cannot exceed 100 characters'),

    jobDescription: z
      .string()
      .trim()
      .max(20000, 'Job description cannot exceed 20000 characters')
      .optional()
      .default(''),
  })
  .strip();

const resumeIdParamSchema = z.object({
  id: z
    .string({ message: 'Resume ID is required' })
    .trim()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid resume ID format'),
});

module.exports = {
  createResumeBodySchema,
  resumeIdParamSchema,
};
