// supabase/functions/admin-send-reset/index.ts — v0.0.5.9
//
// Sends a "reset your password" email to a player who already has an
// account. The server looks the address up and sends the email itself, so
// the admin never sees the email or the link. Global admin only.
//
// Not for placeholder players (they have no password yet — use the invite
// flow) and not for accounts whose email was never confirmed (a reset can't
// reach a mailbox nobody has verified — use Change email, which sets a
// confirmed address, then the reset goes there).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  jsonResponse, maskEmail, isPlaceholderEmail, checkRedirect,
  requireGlobalAdmin, sendRecoveryEmail, logAction, RATE_LIMIT_MESSAGE,
} from '../_shared/accounts.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ctx = await requireGlobalAdmin(req)
    if (ctx instanceof Response) return ctx
    const { caller, callerName, adminClient } = ctx

    const { profile_id, redirect_to } = await req.json()
    if (!profile_id || typeof profile_id !== 'string') {
      return jsonResponse({ error: 'profile_id is required' }, 400)
    }
    const redirectTo = checkRedirect(redirect_to, req)
    if (redirect_to && !redirectTo) return jsonResponse({ error: 'Invalid redirect_to' }, 400)

    const { data: target, error: targetErr } = await adminClient
      .from('profiles')
      .select('id, display_name, username, is_placeholder')
      .eq('id', profile_id)
      .single()
    if (targetErr || !target) return jsonResponse({ error: 'Player not found' }, 404)

    if (target.is_placeholder) {
      return jsonResponse({ error: "This player hasn't set up an account yet. Send an invite instead." }, 400)
    }

    const { data: authData, error: authErr } = await adminClient.auth.admin.getUserById(profile_id)
    if (authErr || !authData?.user) return jsonResponse({ error: 'Account not found' }, 404)
    const email = authData.user.email
    if (!email || isPlaceholderEmail(email)) {
      return jsonResponse({ error: 'This player has no email on file. Use Change email first.' }, 400)
    }
    if (!authData.user.email_confirmed_at) {
      return jsonResponse({ error: "This player's email was never confirmed, so a reset can't be trusted to reach them. Use Change email to set a confirmed address." }, 400)
    }

    const sent = await sendRecoveryEmail(email, redirectTo)
    if (!sent.ok) {
      return jsonResponse(
        { error: sent.rateLimited ? RATE_LIMIT_MESSAGE : `Couldn't send the email: ${sent.message}` },
        sent.rateLimited ? 429 : 502,
      )
    }

    const masked = maskEmail(email)
    await logAction(adminClient, {
      actor_id: caller.id,
      actor_name: callerName,
      target_id: target.id,
      target_name: target.display_name || target.username || 'Unknown',
      action: 'send_reset',
      detail: { email_masked: masked },
    })

    return jsonResponse({ profile_id, masked_email: masked, sent: true })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unknown error' }, 500)
  }
})
