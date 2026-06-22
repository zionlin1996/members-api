'use strict'

const prisma = require('../config/prisma')
const { UPDATABLE_FIELDS, validateProfileUpdate } = require('../utils/profile')

// Fields returned from profile reads/writes. It's the member's own data, so no
// secrets — but we keep an explicit select for a stable shape (like SAFE_SELECT).
const PROFILE_SELECT = {
  givenName: true,
  familyName: true,
  middleName: true,
  nickname: true,
  birthdate: true,
  gender: true,
  pronouns: true,
  locale: true,
  zoneinfo: true,
  picture: true,
  website: true,
  profileUrl: true,
  phoneNumber: true,
  phoneVerified: true,
  streetAddress: true,
  locality: true,
  region: true,
  postalCode: true,
  country: true,
  createdAt: true,
  updatedAt: true,
}

// Shape returned when a member has no Profile row yet (all-null, never written).
const BLANK_PROFILE = Object.fromEntries(
  Object.keys(PROFILE_SELECT).map((k) => [k, k === 'phoneVerified' ? false : null]),
)

// Render birthdate as a plain YYYY-MM-DD string (it's a DB DateTime) for a
// friendlier read shape; everything else passes through untouched.
function serialize(profile) {
  if (profile.birthdate instanceof Date) {
    return { ...profile, birthdate: profile.birthdate.toISOString().slice(0, 10) }
  }
  return profile
}

async function findByMemberId(memberId) {
  const profile = await prisma.profile.findUnique({
    where: { memberId },
    select: PROFILE_SELECT,
  })
  return serialize(profile ?? { ...BLANK_PROFILE })
}

// Whitelist + normalize the payload into Prisma-ready field values.
function normalize(data) {
  const out = {}
  for (const key of UPDATABLE_FIELDS) {
    if (!(key in data)) continue
    let value = data[key]
    if (typeof value === 'string') value = value.trim()
    if (value === '' || value === undefined) value = null
    if (value === null) {
      out[key] = null
      continue
    }
    if (key === 'country') value = value.toUpperCase()
    if (key === 'birthdate') value = new Date(`${value}T00:00:00.000Z`)
    out[key] = value
  }
  return out
}

async function update(memberId, data) {
  const errors = validateProfileUpdate(data)
  if (errors.length) {
    const err = new Error(errors.join('; '))
    err.status = 400
    throw err
  }

  const fields = normalize(data)
  if (Object.keys(fields).length === 0) {
    const err = new Error('No updatable fields provided')
    err.status = 400
    throw err
  }

  // Upsert: the Profile row is created lazily on first write.
  const profile = await prisma.profile.upsert({
    where: { memberId },
    create: { memberId, ...fields },
    update: fields,
    select: PROFILE_SELECT,
  })
  return serialize(profile)
}

module.exports = { findByMemberId, update, PROFILE_SELECT }
