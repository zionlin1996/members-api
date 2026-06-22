'use strict'

const { Router } = require('express')
const authController = require('../controllers/auth.controller')
const profileController = require('../controllers/profile.controller')
const { authenticate } = require('../middleware/auth.middleware')

const router = Router()

router.get('/availability', authController.checkAvailability)
router.post('/register/password', authController.registerPassword)
router.post('/register/passkey/start', authController.startPasskeyRegistration)
router.post('/register/passkey/finish', authController.finishPasskeyRegistration)
router.get('/register/google', authController.redirectToGoogleRegister)
router.get('/login/google', authController.redirectToGoogleLogin)
router.get('/google/callback', authController.handleGoogleCallback)
router.post('/register/telegram', authController.registerWithTelegram)
router.post('/login', authController.login)
router.post('/login/telegram', authController.loginWithTelegram)
router.post('/login/passkey/start', authController.startPasskeyLogin)
router.post('/login/passkey/finish', authController.finishPasskeyLogin)
router.get('/me', authenticate, authController.me)
router.get('/me/profile', authenticate, profileController.getProfile)
router.patch('/me/profile', authenticate, profileController.updateProfile)
router.get('/userinfo', authenticate, authController.userinfo)
router.post('/refresh', authController.refresh)
router.post('/logout', authController.logout)

module.exports = router
