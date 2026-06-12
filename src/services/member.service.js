'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const env = require('../config/env');

const SAFE_SELECT = {
  id: true,
  username: true,
  assignedEmail: true,
  backupEmail: true,
  createdAt: true,
  updatedAt: true,
};

async function findAll() {
  return prisma.member.findMany({ select: SAFE_SELECT, orderBy: { createdAt: 'desc' } });
}

async function findById(id) {
  const member = await prisma.member.findUnique({ where: { id }, select: SAFE_SELECT });
  if (!member) {
    const err = new Error('Member not found');
    err.status = 404;
    throw err;
  }
  return member;
}

async function update(id, data) {
  await findById(id); // ensures member exists

  const updateData = {};
  if (data.backupEmail !== undefined) updateData.backupEmail = data.backupEmail;
  if (data.assignedEmail) updateData.assignedEmail = data.assignedEmail;
  if (data.username) updateData.username = data.username;
  if (data.password) updateData.password = await bcrypt.hash(data.password, env.BCRYPT_ROUNDS);

  try {
    return await prisma.member.update({
      where: { id },
      data: updateData,
      select: SAFE_SELECT,
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0];
      const out = new Error(field === 'username' ? 'Username already taken' : 'Email already taken');
      out.status = 409;
      throw out;
    }
    throw err;
  }
}

async function remove(id) {
  await findById(id); // ensures member exists
  await prisma.member.delete({ where: { id } });
}

module.exports = { findAll, findById, update, remove };
