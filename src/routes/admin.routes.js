'use strict';

const { Router } = require('express');
const { requireApiKey } = require('../middleware/apiKey.middleware');
const adminController = require('../controllers/admin.controller');

const router = Router();

router.use(requireApiKey);

router.post('/members/:id/approve', adminController.approveMember);

module.exports = router;
