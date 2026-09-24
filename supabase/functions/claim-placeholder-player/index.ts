// supabase/functions/claim-placeholder-player/index.ts — v0.0.4.4
//
// Attaches a real email to a placeholder player created by
// create-placeholder-player, so they can be sent a "set your password"
// link and log in as themselves from then on.
//
// Deliberately stricter than create-placeholder-player: requires GLOBAL
// admin (profiles.is_admin), not just admin of the league the player is
// in. Adding a name-only player to run a week's matches is routine ref
// work; attaching someone's real email and handing them login access is
// a bigger step, so this defaults to the app owner / super-admins only.
// Flagged here as adjustable — relax to is_league_admin() for this
// player's league if per-league admins should be able to do this too.
//
// This function only sets + confirms the email and clears is_placeholder.
// It does NOT send the password-recovery email itself — the frontend
// calls supabase.auth.resetPasswordForEmail() right after this succeeds,
// once it has a confirmed-good email on file to send it to.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader)
      return jsonResponse({ error: "Missing Authorization header" }, 401);

    const { profile_id, email } = await req.json();
    if (!profile_id || typeof profile_id !== "string") {
      return jsonResponse({ error: "profile_id is required" }, 400);
    }
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return jsonResponse({ error: "A valid email is required" }, 400);
    }

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: caller },
      error: callerErr,
    } = await callerClient.auth.getUser();
    if (callerErr || !caller)
      return jsonResponse({ error: "Not authenticated" }, 401);

    const { data: callerProfile, error: profileErr } = await callerClient
      .from("profiles")
      .select("is_admin")
      .eq("id", caller.id)
      .single();
    if (profileErr) return jsonResponse({ error: profileErr.message }, 500);
    if (!callerProfile?.is_admin) {
      return jsonResponse(
        { error: "Global admin access required to claim a placeholder player" },
        403,
      );
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: target, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, is_placeholder")
      .eq("id", profile_id)
      .single();
    if (targetErr || !target)
      return jsonResponse({ error: "Player not found" }, 404);
    if (!target.is_placeholder)
      return jsonResponse({ error: "This player is not a placeholder" }, 400);

    const { error: updateAuthErr } =
      await adminClient.auth.admin.updateUserById(profile_id, {
        email,
        email_confirm: true,
      });
    if (updateAuthErr)
      return jsonResponse({ error: updateAuthErr.message }, 500);

    const { error: clearFlagErr } = await adminClient
      .from("profiles")
      .update({ is_placeholder: false })
      .eq("id", profile_id);
    if (clearFlagErr) return jsonResponse({ error: clearFlagErr.message }, 500);

    return jsonResponse({ profile_id, email, is_placeholder: false });
  } catch (e) {
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
