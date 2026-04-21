'use strict';

const { Router } = require('express');
const memberController = require('../controllers/member.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = Router();

router.use(authenticate);

router.get('/', memberController.list);
router.get('/:id', memberController.show);
router.patch('/:id', memberController.update);
router.delete('/:id', memberController.remove);

module.exports = router;
