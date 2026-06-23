'use strict'

const { Router } = require('express')
const authController = require('../controllers/auth.controller')
const profileController = require('../controllers/profile.controller')
const connectionsController = require('../controllers/connections.controller')
const { authenticate, requireActive } = require('../middleware/auth.middleware')

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
// Profile detail getters are ACTIVE-only; PATCH stays open pending product decision.
router.get('/me/profile', authenticate, requireActive, profileController.getProfile)
router.patch('/me/profile', authenticate, profileController.updateProfile)
router.get('/userinfo', authenticate, requireActive, authController.userinfo)
// Connected third-party apps (OIDC grants) — the member's own data; any logged-in
// member may view/revoke regardless of approval status.
router.get('/me/connections', authenticate, connectionsController.listConnections)
router.delete('/me/connections/:clientId', authenticate, connectionsController.revokeConnection)
router.post('/refresh', authController.refresh)
router.post('/logout', authController.logout)

module.exports = router
