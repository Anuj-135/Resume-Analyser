const { z } = require('zod');

// Standard 24-character hexadecimal MongoDB ObjectId
const objectIdSchema = z
  .string({ message: 'ID is required' })
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format');

const objectIdParamSchema = z.object({
  id: objectIdSchema,
});

module.exports = {
  objectIdSchema,
  objectIdParamSchema,
};
