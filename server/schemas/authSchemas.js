const { z } = require('zod');

const registerBodySchema = z
  .object({
    name: z
      .string({ message: 'Name is required' })
      .trim()
      .min(1, 'Name is required')
      .max(100, 'Name cannot exceed 100 characters'),

    email: z
      .string({ message: 'Email is required' })
      .trim()
      .min(1, 'Email is required')
      .email('Invalid email address')
      .max(254, 'Email cannot exceed 254 characters'),

    password: z
      .string({ message: 'Password is required' })
      .min(6, 'Password must be at least 6 characters long')
      .refine((val) => Buffer.byteLength(val, 'utf8') <= 72, {
        message: 'Password cannot exceed 72 bytes',
      }),
  })
  .strip();

const loginBodySchema = z
  .object({
    email: z
      .string({ message: 'Email is required' })
      .trim()
      .min(1, 'Email is required')
      .email('Invalid email address')
      .max(254, 'Email cannot exceed 254 characters'),

    password: z
      .string({ message: 'Password is required' })
      .min(1, 'Password is required')
      .max(1000, 'Password cannot exceed 1000 characters'),
  })
  .strip();

module.exports = {
  registerBodySchema,
  loginBodySchema,
};
