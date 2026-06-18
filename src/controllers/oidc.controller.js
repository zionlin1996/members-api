'use strict';

const oidcService = require('../services/oidc.service');

function discovery(_req, res) {
  return res.json(oidcService.discoveryDocument());
}

function jwks(_req, res) {
  return res.json(oidcService.jwks);
}

module.exports = { discovery, jwks };
