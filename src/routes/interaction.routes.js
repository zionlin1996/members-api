'use strict'

const { Router } = require('express')
const interactionController = require('../controllers/interaction.controller')

// Mounted at /interaction — the JSON API the SPA's /interaction/:uid route
// drives during an OIDC Authorization Server login/consent flow. The path MUST
// match interactions.url's pathname (configuration.js) so the provider's
// path-scoped `_interaction` cookie is delivered here. Credentialed.
const router = Router()

router.get('/:uid', interactionController.details)
router.post('/:uid/login', interactionController.login)
router.post('/:uid/consent', interactionController.consent)
router.post('/:uid/deny', interactionController.deny)

module.exports = router
