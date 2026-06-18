'use strict'

const {
  validateProfileUpdate,
  isValidBirthdate,
  isValidLocale,
  isValidCountry,
  isValidPhone,
  isValidUrl,
  isValidZoneinfo,
} = require('../src/utils/profile')

describe('profile field validators', () => {
  it('birthdate — valid past date only', () => {
    expect(isValidBirthdate('1990-05-20')).toBe(true)
    expect(isValidBirthdate('2024-02-31')).toBe(false) // invalid calendar date
    expect(isValidBirthdate('20-5-1990')).toBe(false) // wrong format
    expect(isValidBirthdate('3000-01-01')).toBe(false) // future
    expect(isValidBirthdate(19900520)).toBe(false) // not a string
  })

  it('locale — BCP-47', () => {
    expect(isValidLocale('en-US')).toBe(true)
    expect(isValidLocale('zh')).toBe(true)
    expect(isValidLocale('zh-Hant-CN')).toBe(true)
    expect(isValidLocale('english')).toBe(false)
  })

  it('country — ISO 3166-1 alpha-2', () => {
    expect(isValidCountry('CH')).toBe(true)
    expect(isValidCountry('ch')).toBe(true)
    expect(isValidCountry('Switzerland')).toBe(false)
  })

  it('phone — E.164', () => {
    expect(isValidPhone('+41791234567')).toBe(true)
    expect(isValidPhone('0791234567')).toBe(false)
    expect(isValidPhone('+0123')).toBe(false) // leading zero after +
  })

  it('url — http(s) only', () => {
    expect(isValidUrl('https://example.com/x')).toBe(true)
    expect(isValidUrl('http://example.com')).toBe(true)
    expect(isValidUrl('ftp://example.com')).toBe(false)
    expect(isValidUrl('https://')).toBe(false)
  })

  it('zoneinfo — IANA time zone', () => {
    expect(isValidZoneinfo('Europe/Zurich')).toBe(true)
    expect(isValidZoneinfo('Mars/Phobos')).toBe(false)
    expect(isValidZoneinfo('')).toBe(false)
  })
})

describe('validateProfileUpdate', () => {
  it('passes a valid payload', () => {
    expect(
      validateProfileUpdate({
        givenName: 'Yang',
        locale: 'en-US',
        country: 'CH',
        birthdate: '1990-05-20',
        website: 'https://yangfrenz.club',
      }),
    ).toEqual([])
  })

  it('collects one error per bad field', () => {
    const errs = validateProfileUpdate({ locale: 'english', phoneNumber: '123', website: 'nope' })
    expect(errs).toHaveLength(3)
  })

  it('treats null/empty as clearing (no error)', () => {
    expect(validateProfileUpdate({ gender: null, nickname: '' })).toEqual([])
  })

  it('rejects over-long free text', () => {
    expect(validateProfileUpdate({ nickname: 'a'.repeat(300) })).toHaveLength(1)
  })

  it('ignores unknown keys', () => {
    expect(validateProfileUpdate({ notARealField: 'x' })).toEqual([])
  })
})
