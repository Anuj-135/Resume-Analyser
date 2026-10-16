const express = require('express');
const router = express.Router();
const { register, login, logout, me } = require('../controllers/authController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { registerBodySchema, loginBodySchema } = require('../schemas/authSchemas');
const { registerLimiter, loginLimiter } = require('../middleware/rateLimiter');

router.post('/register', registerLimiter, validate({ body: registerBodySchema }), register);
router.post('/login', loginLimiter, validate({ body: loginBodySchema }), login);
router.post('/logout', logout);
router.get('/me', auth, me);

module.exports = router;
