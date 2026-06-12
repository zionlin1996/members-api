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

async function remove(req, res, next) {
  try {
    await memberService.remove(req.params.id);
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, show, update, remove };
