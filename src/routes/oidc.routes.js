'use strict';

const { Router } = require('express');
const oidcController = require('../controllers/oidc.controller');

// Mounted at /.well-known
const router = Router();

router.get('/openid-configuration', oidcController.discovery);
router.get('/jwks.json', oidcController.jwks);

module.exports = router;
