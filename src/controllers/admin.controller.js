'use strict'

const prisma = require('../config/prisma')
const oauthClientService = require('../services/oauthClient.service')

async function approveMember(req, res, next) {
  try {
    const { id } = req.params

    const member = await prisma.member.findUnique({
      where: { id },
      select: { id: true, status: true, username: true },
    })

    if (!member) {
      return res.status(404).json({ message: 'Member not found' })
    }

    if (member.status === 'ACTIVE') {
      return res.status(409).json({ message: 'Member is already active' })
    }

    const updated = await prisma.member.update({
      where: { id },
      data: { status: 'ACTIVE' },
      select: { id: true, username: true, status: true },
    })

    // TODO: create ProtonMail mailbox for `${member.username}@yangfrenz.club`
    // TODO: send recovery phrase to backupEmail (PASSWORD/PASSKEY) or via provider channel (GOOGLE/TELEGRAM)

    return res.json({ member: updated })
  } catch (err) {
    next(err)
  }
}

// ── OAuth client registry (Authorization Server third-party apps) ────────────

async function createOAuthClient(req, res, next) {
  try {
    const client = await oauthClientService.create(req.body || {})
    return res.status(201).json({ client })
  } catch (err) {
    next(err)
  }
}

async function listOAuthClients(_req, res, next) {
  try {
    return res.json({ clients: await oauthClientService.list() })
  } catch (err) {
    next(err)
  }
}

async function getOAuthClient(req, res, next) {
  try {
    return res.json({ client: await oauthClientService.findById(req.params.id) })
  } catch (err) {
    next(err)
  }
}

async function updateOAuthClient(req, res, next) {
  try {
    const client = await oauthClientService.update(req.params.id, req.body || {})
    return res.json({ client })
  } catch (err) {
    next(err)
  }
}

async function deleteOAuthClient(req, res, next) {
  try {
    await oauthClientService.remove(req.params.id)
    return res.status(204).end()
  } catch (err) {
    next(err)
  }
}

module.exports = {
  approveMember,
  createOAuthClient,
  listOAuthClients,
  getOAuthClient,
  updateOAuthClient,
  deleteOAuthClient,
}
