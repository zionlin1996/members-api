'use strict'

// getClaims is a pure function; stub prisma so requiring the service doesn't
// spin up a real client.
jest.mock('../src/config/prisma', () => ({}))

const { getClaims, FIRST_PARTY_SCOPES } = require('../src/services/oidc.service')

const MEMBER = {
  id: 'm1',
  displayName: 'Yang Lin',
  username: 'yang.lin',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-06-01T00:00:00.000Z'),
}

const PROFILE = {
  givenName: 'Yang',
  familyName: 'Lin',
  middleName: null,
  nickname: 'YL',
  birthdate: '1990-05-20',
  gender: 'male',
  pronouns: 'he/him',
  locale: 'en-US',
  zoneinfo: 'Europe/Zurich',
  picture: 'https://x/p.png',
  website: 'https://x',
  profileUrl: 'https://x/u',
  phoneNumber: '+41791234567',
  phoneVerified: true,
  streetAddress: 'Main 1',
  locality: 'Zurich',
  region: 'ZH',
  postalCode: '8000',
  country: 'CH',
}

const NS = 'https://yangfrenz.club/'

describe('getClaims — scope gating', () => {
  it('openid only → just sub', () => {
    expect(getClaims(MEMBER, PROFILE, ['openid'])).toEqual({ sub: 'm1' })
  })

  it('profile → standard profile claims, no email/address/phone', () => {
    const c = getClaims(MEMBER, PROFILE, ['profile'])
    expect(c.name).toBe('Yang Lin')
    expect(c.preferred_username).toBe('yang.lin')
    expect(c.given_name).toBe('Yang')
    expect(c.birthdate).toBe('1990-05-20')
    expect(c.locale).toBe('en-US')
    expect(c.profile).toBe('https://x/u')
    expect(c.middle_name).toBeUndefined() // null pruned
    expect(c.email).toBeUndefined()
    expect(c.address).toBeUndefined()
    expect(c.phone_number).toBeUndefined()
  })

  it('email → computed email + verified flag', () => {
    const c = getClaims(MEMBER, PROFILE, ['email'])
    expect(c.email).toMatch(/^yang\.lin@/)
    expect(c.email_verified).toBe(true)
    expect(c.name).toBeUndefined()
  })

  it('address → structured OIDC address object', () => {
    const c = getClaims(MEMBER, PROFILE, ['address'])
    expect(c.address).toMatchObject({
      street_address: 'Main 1',
      locality: 'Zurich',
      region: 'ZH',
      postal_code: '8000',
      country: 'CH',
    })
    expect(typeof c.address.formatted).toBe('string')
  })

  it('phone → number + verified', () => {
    const c = getClaims(MEMBER, PROFILE, ['phone'])
    expect(c.phone_number).toBe('+41791234567')
    expect(c.phone_number_verified).toBe(true)
  })

  it('membership → namespaced custom claims', () => {
    const c = getClaims(MEMBER, PROFILE, ['membership'])
    expect(c[`${NS}membership_status`]).toBe('ACTIVE')
    expect(c[`${NS}pronouns`]).toBe('he/him')
    expect(typeof c[`${NS}member_since`]).toBe('number')
  })

  it('default-deny: profile scope leaks nothing from other scopes', () => {
    const c = getClaims(MEMBER, PROFILE, ['profile'])
    expect(c[`${NS}membership_status`]).toBeUndefined()
  })

  it('null profile → only member-derived claims, no profile-table fields', () => {
    const c = getClaims(MEMBER, null, ['profile', 'email'])
    expect(c.name).toBe('Yang Lin')
    expect(c.email).toMatch(/^yang\.lin@/)
    expect(c.given_name).toBeUndefined()
    expect(c.birthdate).toBeUndefined()
  })

  it('email_verified false when not ACTIVE', () => {
    const c = getClaims({ ...MEMBER, status: 'UNVERIFIED' }, PROFILE, ['email'])
    expect(c.email_verified).toBe(false)
  })

  it('FIRST_PARTY_SCOPES releases the full set', () => {
    const c = getClaims(MEMBER, PROFILE, FIRST_PARTY_SCOPES)
    expect(c.sub).toBe('m1')
    expect(c.name).toBeDefined()
    expect(c.email).toBeDefined()
    expect(c.address).toBeDefined()
    expect(c.phone_number).toBeDefined()
    expect(c[`${NS}membership_status`]).toBe('ACTIVE')
  })
})
