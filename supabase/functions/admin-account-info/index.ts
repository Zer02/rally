// supabase/functions/admin-account-info/index.ts — v0.0.5.9
//
// Powers the "Player accounts" panel on the Round Robin page. For every
// player in a league, returns what an admin needs to know about their
// account WITHOUT exposing the email itself:
//
//   status          name_only | invited | unconfirmed | active | unknown
//   masked_email    j***@g***.com, or null when there is no real email
//   last_sign_in_at ISO timestamp or null
//
// Emails live in auth.users, which the browser can't read — hence a
// function. Global admin only.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { jsonResponse, maskEmail, isPlaceholderEmail, requireGlobalAdmin } from '../_shared/accounts.ts'

type Status = 'name_only' | 'invited' | 'unconfirmed' | 'active' | 'unknown'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ctx = await requireGlobalAdmin(req)
    if (ctx instanceof Response) return ctx
    const { adminClient } = ctx

    const { league_id } = await req.json()
    if (!league_id || typeof league_id !== 'string') {
      return jsonResponse({ error: 'league_id is required' }, 400)
    }

    const { data: rows, error: rowsErr } = await adminClient
      .from('players')
      .select('profile_id, profile:profiles(id, is_admin, is_placeholder, invited_email)')
      .eq('league_id', league_id)
    if (rowsErr) return jsonResponse({ error: rowsErr.message }, 500)

    async function lookup(row: any) {
      const profile = row.profile
      const profileId: string = row.profile_id
      const isAdmin = !!profile?.is_admin

      // Name-only placeholder: no real email exists, nothing to look up.
      if (profile?.is_placeholder && !profile?.invited_email) {
        return { profile_id: profileId, status: 'name_only' as Status, masked_email: null, last_sign_in_at: null, is_admin: isAdmin }
      }

      const { data, error } = await adminClient.auth.admin.getUserById(profileId)
      if (error || !data?.user) {
        return { profile_id: profileId, status: 'unknown' as Status, masked_email: null, last_sign_in_at: null, is_admin: isAdmin }
      }
      const u = data.user
      let status: Status
      if (profile?.is_placeholder) status = 'invited'
      else if (isPlaceholderEmail(u.email)) status = 'name_only'
      else status = u.email_confirmed_at ? 'active' : 'unconfirmed'

      return {
        profile_id: profileId,
        status,
        masked_email: maskEmail(u.email),
        last_sign_in_at: u.last_sign_in_at ?? null,
        is_admin: isAdmin,
      }
    }

    // Small batches so a big league doesn't fire everything at once.
    const accounts = []
    const list = rows ?? []
    for (let i = 0; i < list.length; i += 8) {
      accounts.push(...await Promise.all(list.slice(i, i + 8).map(lookup)))
    }

    return jsonResponse({ accounts })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unknown error' }, 500)
  }
})
