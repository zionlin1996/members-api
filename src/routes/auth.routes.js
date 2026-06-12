'use strict';

const { Router } = require('express');
const authController = require('../controllers/auth.controller');

const router = Router();

router.get('/availability', authController.checkAvailability);
router.post('/register/password', authController.registerPassword);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

module.exports = router;
