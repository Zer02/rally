// src/lib/authMessages.ts — v0.0.5.8
// Plain-language versions of Supabase's auth errors, password rules, and
// the error Supabase puts in the URL when an emailed link is bad.

export const PASSWORD_MIN = 8

// Supabase's messages are written for developers ("Invalid login credentials",
// "Auth session missing!"). Translate the ones people actually hit; anything
// unrecognised is shown as-is rather than hidden.
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials'))
    return "That email and password don't match."
  if (m.includes('email not confirmed'))
    return 'Please confirm your email first: check your inbox for the link we sent.'
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'An account with that email already exists. Try signing in, or reset your password.'
  const len = m.match(/at least (\d+) characters?/)
  if (len) return `Passwords must be at least ${len[1]} characters.`
  if (m.includes('different from the old password'))
    return 'Your new password has to be different from your current one.'
  if (m.includes('weak') || m.includes('easy to guess') || m.includes('pwned') || m.includes('compromised'))
    return 'That password is too easy to guess. Try something longer or less common.'
  if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes'))
    return 'Too many attempts. Please wait a minute and try again.'
  if (m.includes('session missing') || m.includes('expired') || m.includes('invalid or has expired'))
    return 'That link has expired or was already used. Request a new one.'
  if (m.includes('failed to fetch') || m.includes('network'))
    return "Couldn't reach the server. Check your connection and try again."
  return message
}

export interface PasswordCheck { ok: boolean; label: string }

// Shown live under the new-password field. `confirm` is null until the person
// has started typing in the confirm box, so "Passwords match" doesn't nag early.
export function passwordChecks(password: string, confirm: string): PasswordCheck[] {
  const checks: PasswordCheck[] = [
    { ok: password.length >= PASSWORD_MIN, label: `At least ${PASSWORD_MIN} characters` },
  ]
  if (confirm.length > 0) checks.push({ ok: password === confirm, label: 'Passwords match' })
  return checks
}

export function passwordIsValid(password: string, confirm: string): boolean {
  return password.length >= PASSWORD_MIN && password === confirm
}

// When an emailed link is expired or already used, Supabase sends the person
// to the redirect URL with the error in the hash (implicit flow) or query
// string (PKCE): #error=access_denied&error_code=otp_expired&error_description=...
// Returns a message to show, and removes the error from the address bar so a
// refresh doesn't replay it. Null if the URL has no auth error.
export function readAuthLinkError(): string | null {
  if (typeof window === 'undefined') return null
  const hash  = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const get = (k: string) => hash.get(k) ?? query.get(k)
  const error = get('error'), code = get('error_code'), desc = get('error_description')
  if (!error && !code) return null

  const expired = code === 'otp_expired' || error === 'access_denied'
  const message = expired
    ? 'That link has expired or was already used. Enter your email below and we will send you a new one.'
    : (desc ? desc.replace(/\+/g, ' ') : 'Something went wrong with that link. Please try again.')

  const clean = new URL(window.location.href)
  clean.hash = ''
  for (const k of ['error', 'error_code', 'error_description']) clean.searchParams.delete(k)
  window.history.replaceState(null, '', clean.pathname + clean.search)
  return message
}
