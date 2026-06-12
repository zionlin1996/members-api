'use strict';

const prisma = require('../config/prisma');

async function approveMember(req, res, next) {
  try {
    const { id } = req.params;

    const member = await prisma.member.findUnique({
      where: { id },
      select: { id: true, status: true, username: true },
    });

    if (!member) {
      return res.status(404).json({ message: 'Member not found' });
    }

    if (member.status === 'ACTIVE') {
      return res.status(409).json({ message: 'Member is already active' });
    }

    const updated = await prisma.member.update({
      where: { id },
      data: { status: 'ACTIVE' },
      select: { id: true, username: true, status: true },
    });

    // TODO: create ProtonMail mailbox for `${member.username}@yangfrenz.club`
    // TODO: send recovery phrase to backupEmail (PASSWORD/PASSKEY) or via provider channel (GOOGLE/TELEGRAM)

    return res.json({ member: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { approveMember };
