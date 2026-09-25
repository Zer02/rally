// supabase/functions/claim-placeholder-player/index.ts — v0.0.4.5
//
// Sends (or resends) a "set your password" invite to a placeholder
// player's real email. Deliberately does NOT clear profiles.is_placeholder
// here — that used to happen immediately on send, which meant a
// mistyped email or an ignored invite was indistinguishable from a real
// activated account, with no way to go back and fix it. is_placeholder
// now only clears once the person actually sets a password (see
// useAuth.ts's updatePassword()) — the real "became a live account"
// moment. Until then this function can be called again any number of
// times with a corrected or same email, which is what powers "resend" /
// "fix the email" in PlaceholderPlayersPanel.vue — there's no separate
// resend endpoint, just calling this again.
//
// Still requires GLOBAL admin (profiles.is_admin), not just admin of the
// league the player is in — same reasoning as before: handing out login
// access is a bigger step than adding a name-only player for the week.
// Flagged as adjustable if per-league admins should be trusted with this
// too.
//
// Still doesn't send the email itself — the frontend calls
// supabase.auth.resetPasswordForEmail() right after this succeeds, once
// it has a confirmed-good email on file to send it to.

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

    const { profile_id, email } = await req.json()
    if (!profile_id || typeof profile_id !== 'string') {
      return jsonResponse({ error: 'profile_id is required' }, 400)
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return jsonResponse({ error: 'A valid email is required' }, 400)
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
      return jsonResponse({ error: 'Global admin access required to claim a placeholder player' }, 403)
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: target, error: targetErr } = await adminClient
      .from('profiles')
      .select('id, is_placeholder')
      .eq('id', profile_id)
      .single()
    if (targetErr || !target) return jsonResponse({ error: 'Player not found' }, 404)
    if (!target.is_placeholder) {
      return jsonResponse({ error: 'This player has already set up their account' }, 400)
    }

    const { error: updateAuthErr } = await adminClient.auth.admin.updateUserById(profile_id, {
      email,
      email_confirm: true,
    })
    if (updateAuthErr) return jsonResponse({ error: updateAuthErr.message }, 500)

    // is_placeholder is intentionally left alone here — see file header.
    const { error: recordInviteErr } = await adminClient
      .from('profiles')
      .update({ invited_email: email, invited_at: new Date().toISOString() })
      .eq('id', profile_id)
    if (recordInviteErr) return jsonResponse({ error: recordInviteErr.message }, 500)

    return jsonResponse({ profile_id, email, invited_at: new Date().toISOString() })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unknown error' }, 500)
  }
})

