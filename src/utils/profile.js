'use strict'

// Per-field validators for member Profile updates. Mirrors utils/username.js:
// small boolean helpers plus a combined validator returning error messages.
// Empty/null values mean "clear the field" and are not validated here.

const URL_RE = /^https?:\/\/.+/i
const LOCALE_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/ // BCP-47 (pragmatic)
const COUNTRY_RE = /^[A-Za-z]{2}$/ // ISO 3166-1 alpha-2
const E164_RE = /^\+[1-9]\d{1,14}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TEXT_MAX = 256

function isValidBirthdate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return false
  // Guard against invalid calendar dates (e.g. 2024-02-31 → rolls to March).
  if (d.toISOString().slice(0, 10) !== v) return false
  return d.getTime() <= Date.now() // not in the future
}

function isValidLocale(v) {
  return typeof v === 'string' && LOCALE_RE.test(v)
}

function isValidCountry(v) {
  return typeof v === 'string' && COUNTRY_RE.test(v)
}

function isValidPhone(v) {
  return typeof v === 'string' && E164_RE.test(v)
}

function isValidUrl(v) {
  return typeof v === 'string' && URL_RE.test(v)
}

function isValidZoneinfo(v) {
  if (typeof v !== 'string' || !v) return false
  try {
    // Throws RangeError for an unknown IANA time zone.
    Intl.DateTimeFormat(undefined, { timeZone: v })
    return true
  } catch {
    return false
  }
}

// Format-validated fields → [validator, error message].
const VALIDATORS = {
  birthdate: [isValidBirthdate, 'birthdate must be YYYY-MM-DD and not in the future'],
  locale: [isValidLocale, 'locale must be a BCP-47 tag (e.g. en-US)'],
  zoneinfo: [isValidZoneinfo, 'zoneinfo must be a valid IANA time zone'],
  country: [isValidCountry, 'country must be an ISO 3166-1 alpha-2 code'],
  phoneNumber: [isValidPhone, 'phoneNumber must be E.164 (e.g. +41791234567)'],
  picture: [isValidUrl, 'picture must be a valid http(s) URL'],
  website: [isValidUrl, 'website must be a valid http(s) URL'],
  profileUrl: [isValidUrl, 'profileUrl must be a valid http(s) URL'],
}

// Free-text fields validated only for type + length.
const TEXT_FIELDS = [
  'givenName',
  'familyName',
  'middleName',
  'nickname',
  'gender',
  'pronouns',
  'streetAddress',
  'locality',
  'region',
  'postalCode',
]

// Everything a member may set on their own profile (excludes id, memberId,
// phoneVerified, timestamps — those are system-managed).
const UPDATABLE_FIELDS = [...Object.keys(VALIDATORS), ...TEXT_FIELDS]

/**
 * Validate a profile update payload. Returns an array of error messages
 * (empty when valid). Unknown keys are ignored; empty/null values (clearing
 * a field) skip validation.
 */
function validateProfileUpdate(data) {
  const errors = []
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined || value === '') continue
    if (TEXT_FIELDS.includes(key)) {
      if (typeof value !== 'string' || value.length > TEXT_MAX) {
        errors.push(`${key} must be a string up to ${TEXT_MAX} characters`)
      }
      continue
    }
    const rule = VALIDATORS[key]
    if (rule && !rule[0](value)) errors.push(rule[1])
  }
  return errors
}

module.exports = {
  UPDATABLE_FIELDS,
  validateProfileUpdate,
  isValidBirthdate,
  isValidLocale,
  isValidCountry,
  isValidPhone,
  isValidUrl,
  isValidZoneinfo,
}
