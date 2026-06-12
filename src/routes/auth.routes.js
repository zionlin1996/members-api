'use strict';

const { Router } = require('express');
const authController = require('../controllers/auth.controller');

const router = Router();

router.get('/availability', authController.checkAvailability);
router.post('/register/password', authController.registerPassword);
router.post('/register/passkey/start', authController.startPasskeyRegistration);
router.post('/register/passkey/finish', authController.finishPasskeyRegistration);
router.get('/register/google', authController.redirectToGoogleRegister);
router.get('/login/google', authController.redirectToGoogleLogin);
router.get('/google/callback', authController.handleGoogleCallback);
router.post('/login', authController.login);
router.post('/login/passkey/start', authController.startPasskeyLogin);
router.post('/login/passkey/finish', authController.finishPasskeyLogin);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

module.exports = router;
