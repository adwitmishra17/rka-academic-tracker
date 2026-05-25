// =========================================================================
// phone.js — Indian phone number normalization and validation
//
// All phone numbers in the database should be stored in normalized form:
// +91 prefix, no spaces, no dashes, no leading zero.
// Example storage form: "+919876543210"
// =========================================================================

// Strip all non-digits, drop any leading 91 or 0, return the bare 10-digit
// Indian mobile number. Returns null if it can't be parsed.
//
// Accepts:
//   "9876543210"
//   "09876543210"
//   "+919876543210"
//   "919876543210"
//   "+91 98765 43210"
//   "98765-43210"
function extractTenDigits(input) {
  if (typeof input !== 'string') return null
  const digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  if (digits.length === 10) return digits
  return null
}

// True if the 10-digit number looks like a valid Indian mobile (starts 6-9).
function isValidMobile(tenDigits) {
  return /^[6-9]\d{9}$/.test(tenDigits)
}

// Public: take any reasonable input, return canonical "+91XXXXXXXXXX" or null.
export function normalizePhone(input) {
  const td = extractTenDigits(input)
  if (!td || !isValidMobile(td)) return null
  return '+91' + td
}

// Public: pretty form for display, "+91 98765 43210"
export function formatPhoneForDisplay(stored) {
  if (typeof stored !== 'string') return ''
  const td = extractTenDigits(stored)
  if (!td) return stored  // unrecognized — show as-is rather than break
  return `+91 ${td.slice(0, 5)} ${td.slice(5)}`
}

// Public: validity check that returns boolean. Convenient for forms.
export function isValidPhone(input) {
  return normalizePhone(input) !== null
}
