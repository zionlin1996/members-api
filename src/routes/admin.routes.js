'use strict'

const { Router } = require('express')
const { requireApiKey } = require('../middleware/apiKey.middleware')
const adminController = require('../controllers/admin.controller')

const router = Router()

router.use(requireApiKey)

router.post('/members/:id/approve', adminController.approveMember)

// OAuth/OIDC client registry for the Authorization Server (third-party apps).
router.post('/oauth-clients', adminController.createOAuthClient)
router.get('/oauth-clients', adminController.listOAuthClients)
router.get('/oauth-clients/:id', adminController.getOAuthClient)
router.patch('/oauth-clients/:id', adminController.updateOAuthClient)
router.delete('/oauth-clients/:id', adminController.deleteOAuthClient)

module.exports = router
