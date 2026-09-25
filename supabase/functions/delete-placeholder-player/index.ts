// supabase/functions/delete-placeholder-player/index.ts — v0.0.4.6
//
// Fully removes a placeholder player who was added by mistake, or whose
// invite the admin would rather abandon than keep correcting. Requires
// GLOBAL admin — same bar as claiming one, since deleting an account
// (even a placeholder one) is at least as destructive as handing out
// login access to it.
//
// Deliberately does NOT try to pre-check whether this player has real
// match history before deleting. `players` and `tournament_participants`
// both cascade on profile deletion (they're enrollment records, fine to
// lose), but `matches.challenger_id`/`opponent_id` do NOT cascade —
// Postgres itself will reject the delete with a foreign-key violation if
// this placeholder has any 1v1 match on record, which is exactly the
// case this should refuse. Letting the database enforce that is more
// reliable than reimplementing the same check here and having it drift
// out of sync with the schema.
//
// Only ever deletes a profile still flagged is_placeholder — refuses to
// touch a real (claimed or normally signed-up) account, even if asked.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401)

    const { profile_id } = await req.json()
    if (!profile_id || typeof profile_id !== 'string') {
      return jsonResponse({ error: 'profile_id is required' }, 400)
    }

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return jsonResponse({ error: 'Not authenticated' }, 401)

    const { data: callerProfile, error: profileErr } = await callerClient
      .from('profiles')
      .select('is_admin')
      .eq('id', caller.id)
      .single()
    if (profileErr) return jsonResponse({ error: profileErr.message }, 500)
    if (!callerProfile?.is_admin) {
      return jsonResponse({ error: 'Global admin access required to remove a placeholder player' }, 403)
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: target, error: targetErr } = await adminClient
      .from('profiles')
      .select('id, is_placeholder, display_name')
      .eq('id', profile_id)
      .single()
    if (targetErr || !target) return jsonResponse({ error: 'Player not found' }, 404)
    if (!target.is_placeholder) {
      return jsonResponse({ error: 'This player has already set up their account and can\'t be removed this way' }, 400)
    }

    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(profile_id)
    if (deleteErr) {
      // Postgres's own FK constraint is what actually protects real
      // match history (see file header) — surface that plainly rather
      // than a raw constraint-violation message.
      const msg = /foreign key|violates|constraint/i.test(deleteErr.message)
        ? `${target.display_name || 'This player'} already has matches on record and can't be removed. Consider leaving them as-is instead.`
        : deleteErr.message
      return jsonResponse({ error: msg }, 500)
    }

    return jsonResponse({ profile_id })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unknown error' }, 500)
  }
})
