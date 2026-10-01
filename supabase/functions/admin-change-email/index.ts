// supabase/functions/admin-change-email/index.ts — v0.0.5.9
//
// Replaces the email on an existing player's account (typo'd, lost, or
// never-confirmed address), then sends a password-reset link to the NEW
// address so only whoever owns that mailbox can get in. Global admin only.
//
// Guardrails, all enforced here rather than trusted from the browser:
//   - the new address must be typed twice and match
//   - refused for admin accounts
//   - refused for yourself
//   - refused for placeholder players (name-only or invited): they use the
//     invite flow (claim-placeholder-player), which already handles
//     "fix the email"
//   - refused if another account already uses the address
//   - every change is written to account_admin_log (masked emails only)
//
// The new email is marked confirmed straight away: the admin is vouching
// for it, and the reset link sent to it is the real proof of ownership.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  jsonResponse, maskEmail, normalizeEmail, isPlaceholderEmail, checkRedirect,
  requireGlobalAdmin, sendRecoveryEmail, logAction, RATE_LIMIT_MESSAGE,
} from '../_shared/accounts.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ctx = await requireGlobalAdmin(req)
    if (ctx instanceof Response) return ctx
    const { caller, callerName, adminClient } = ctx

    const body = await req.json()
    const { profile_id, redirect_to } = body
    if (!profile_id || typeof profile_id !== 'string') {
      return jsonResponse({ error: 'profile_id is required' }, 400)
    }

    const newEmail = normalizeEmail(body.new_email)
    const confirmEmail = normalizeEmail(body.confirm_email)
    if (!newEmail) return jsonResponse({ error: 'Enter a valid email address' }, 400)
    if (newEmail !== confirmEmail) {
      return jsonResponse({ error: "The two email addresses don't match" }, 400)
    }
    if (isPlaceholderEmail(newEmail)) {
      return jsonResponse({ error: 'Enter a real email address' }, 400)
    }
    const redirectTo = checkRedirect(redirect_to, req)
    if (redirect_to && !redirectTo) return jsonResponse({ error: 'Invalid redirect_to' }, 400)

    if (profile_id === caller.id) {
      return jsonResponse({ error: "You can't change your own email from here" }, 403)
    }

    const { data: target, error: targetErr } = await adminClient
      .from('profiles')
      .select('id, display_name, username, is_admin, is_placeholder')
      .eq('id', profile_id)
      .single()
    if (targetErr || !target) return jsonResponse({ error: 'Player not found' }, 404)

    if (target.is_admin) {
      return jsonResponse({ error: "Admin accounts' emails can't be changed from here" }, 403)
    }
    if (target.is_placeholder) {
      return jsonResponse({ error: "This player hasn't set up an account yet. Use Send invite / Fix email instead." }, 400)
    }

    const { data: authData, error: authErr } = await adminClient.auth.admin.getUserById(profile_id)
    if (authErr || !authData?.user) return jsonResponse({ error: 'Account not found' }, 404)
    const oldEmail = authData.user.email ?? null
    if (oldEmail && oldEmail.toLowerCase() === newEmail) {
      return jsonResponse({ error: "That's already this player's email" }, 400)
    }

    const { error: updateErr } = await adminClient.auth.admin.updateUserById(profile_id, {
      email: newEmail,
      email_confirm: true,
    })
    if (updateErr) {
      const taken = /already|registered|exists|duplicate/i.test(updateErr.message)
      return jsonResponse(
        { error: taken ? 'Another account already uses that email' : updateErr.message },
        taken ? 409 : 500,
      )
    }

    const sent = await sendRecoveryEmail(newEmail, redirectTo)
    const maskedNew = maskEmail(newEmail)

    await logAction(adminClient, {
      actor_id: caller.id,
      actor_name: callerName,
      target_id: target.id,
      target_name: target.display_name || target.username || 'Unknown',
      action: 'change_email',
      detail: {
        old_email_masked: maskEmail(oldEmail),
        new_email_masked: maskedNew,
        reset_sent: sent.ok,
      },
    })

    // The change itself succeeded either way; say plainly if the reset
    // email didn't go out so the admin can use Send password reset.
    return jsonResponse({
      profile_id,
      masked_email: maskedNew,
      reset_sent: sent.ok,
      reset_error: sent.ok ? null : (sent.rateLimited ? RATE_LIMIT_MESSAGE : sent.message),
    })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unknown error' }, 500)
  }
})
