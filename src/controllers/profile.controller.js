'use strict'

const profileService = require('../services/profile.service')

// Self-service profile endpoints — operate on req.memberId (set by authenticate),
// so ownership is implicit; no :id param. Validation/whitelisting lives in the
// service, so these handlers stay thin.
async function getProfile(req, res, next) {
  try {
    const profile = await profileService.findByMemberId(req.memberId)
    return res.json(profile)
  } catch (err) {
    next(err)
  }
}

async function updateProfile(req, res, next) {
  try {
    const profile = await profileService.update(req.memberId, req.body ?? {})
    return res.json(profile)
  } catch (err) {
    next(err)
  }
}

module.exports = { getProfile, updateProfile }
