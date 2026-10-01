// supabase/functions/_shared/accounts.ts — v0.0.5.9
//
// Shared pieces for the three "Player accounts" admin functions
// (admin-account-info, admin-send-reset, admin-change-email).
//
// The rule they all follow: the browser never sees a player's full email.
// The server looks it up, uses it, and hands back at most a masked form
// (j***@g***.com). The one exception is the NEW address an admin types
// into Change email — they typed it, so they already know it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { corsHeaders } from './cors.ts'

export const PLACEHOLDER_EMAIL_DOMAIN = 'placeholder.rally.internal'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)
}

// "jane.doe@gmail.com" -> "j***@g***.com". Null for nothing or for the
// non-deliverable placeholder address (there is no real email to show).
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || isPlaceholderEmail(email)) return null
  const at = email.lastIndexOf('@')
  if (at < 1) return null
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  const domainMasked = dot > 0
    ? `${domain.slice(0, 1)}***${domain.slice(dot)}`
    : `${domain.slice(0, 1)}***`
  return `${local.slice(0, 1)}***@${domainMasked}`
}

// Trim + lowercase + a deliberately simple shape check. Supabase does the
// real validation; this just catches obvious typos before we call it.
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const e = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}

// redirect_to comes from the browser, so it is checked rather than
// trusted: must be http(s), must be the /login page, and must match the
// Origin the request came from. Supabase also checks its own Redirect URLs
// allow-list and silently falls back to the Site URL if it isn't listed.
export function checkRedirect(raw: unknown, req: Request): string | null {
  if (typeof raw !== 'string') return null
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.pathname !== '/login') return null
  const origin = req.headers.get('Origin')
  if (origin && origin !== url.origin) return null
  return url.toString()
}

export type AdminContext = {
  caller: { id: string }
  callerName: string
  adminClient: ReturnType<typeof createClient>
}

// Authenticates the caller and requires GLOBAL admin (profiles.is_admin),
// same bar as claim-placeholder-player. Returns a Response to send back
// when the check fails, so every function can do:
//   const ctx = await requireGlobalAdmin(req); if (ctx instanceof Response) return ctx
export async function requireGlobalAdmin(req: Request): Promise<AdminContext | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401)

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !user) return jsonResponse({ error: 'Not authenticated' }, 401)

  const { data: profile, error: profileErr } = await callerClient
    .from('profiles')
    .select('is_admin, display_name, username')
    .eq('id', user.id)
    .single()
  if (profileErr) return jsonResponse({ error: profileErr.message }, 500)
  if (!profile?.is_admin) {
    return jsonResponse({ error: 'Global admin access required' }, 403)
  }

  return {
    caller: { id: user.id },
    callerName: profile.display_name || profile.username || 'Admin',
    adminClient: createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  }
}

// Sends the standard Supabase "reset password" email from the server, so
// the admin never sees the address or the link. (generateLink() would hand
// the link back to the caller, which is exactly what we don't want.) A
// throwaway anon client keeps this from touching any session.
export async function sendRecoveryEmail(
  email: string,
  redirectTo: string | null,
): Promise<{ ok: true } | { ok: false; rateLimited: boolean; message: string }> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.resetPasswordForEmail(
    email,
    redirectTo ? { redirectTo } : undefined,
  )
  if (!error) return { ok: true }
  const status = (error as { status?: number }).status
  const rateLimited = status === 429 || /rate limit|too many|seconds/i.test(error.message)
  return { ok: false, rateLimited, message: error.message }
}

export const RATE_LIMIT_MESSAGE =
  'Too many reset emails for this account just now. Wait a minute and try again.'

export async function logAction(
  adminClient: AdminContext['adminClient'],
  row: {
    actor_id: string
    actor_name: string
    target_id: string
    target_name: string
    action: 'send_reset' | 'change_email'
    detail: Record<string, unknown>
  },
) {
  // A logging failure must not undo or hide an action that already
  // happened, so it is reported to the function logs and swallowed.
  const { error } = await adminClient.from('account_admin_log').insert(row)
  if (error) console.error('account_admin_log insert failed:', error.message)
}
