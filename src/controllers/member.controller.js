'use strict';

const memberService = require('../services/member.service');

async function list(req, res, next) {
  try {
    const members = await memberService.findAll();
    return res.json({ members });
  } catch (err) {
    next(err);
  }
}

async function show(req, res, next) {
  try {
    const member = await memberService.findById(req.params.id);
    return res.json({ member });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    if (req.params.id !== req.memberId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const allowed = ['username', 'displayName'];
    const data = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => allowed.includes(key))
    );

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'No updatable fields provided' });
    }

    const member = await memberService.update(req.params.id, data);
    return res.json({ member });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, show, update };
