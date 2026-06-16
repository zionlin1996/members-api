'use strict';

const prisma = require('../config/prisma');
const { isValidUsername } = require('../utils/username');

const SAFE_SELECT = {
  id: true,
  displayName: true,
  username: true,
  status: true,
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
  await findById(id);

  const updateData = {};
  if (data.displayName) updateData.displayName = data.displayName;
  if (data.username) {
    if (!isValidUsername(data.username)) {
      const err = new Error('Invalid username format');
      err.status = 400;
      throw err;
    }
    updateData.username = data.username;
  }

  try {
    return await prisma.member.update({
      where: { id },
      data: updateData,
      select: SAFE_SELECT,
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const out = new Error('Username already taken');
      out.status = 409;
      throw out;
    }
    throw err;
  }
}

module.exports = { findAll, findById, update };
