// supabase/functions/create-placeholder-player/index.ts — v0.0.4.4
//
// Lets a ref/admin add a player to a league by display name only, no
// email required. Creates a REAL auth.users row (not a name-only guest
// row in some separate table) so the placeholder is indistinguishable
// from a normal signup to every other RPC/RLS policy in the app —
// nothing else in the schema needs to special-case it.
//
// Why this needs a real email at all: supabase.auth.admin.createUser()
// with neither email nor phone set currently 500s (open Supabase Auth
// bug). Workaround: generate a non-deliverable placeholder address under
// a reserved local domain. Nobody will ever receive mail there — it's
// purely there to satisfy the Admin API, and gets overwritten for real
// once claim-placeholder-player runs.
//
// Auth model: the caller's own JWT (passed through as the Authorization
// header) is used to ask the database's own is_league_admin() RPC
// whether they're allowed — same check every other admin-only action in
// this app goes through, not reimplemented here. Only once that comes
// back true does this function switch to the service-role client to
// actually create the user.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLACEHOLDER_EMAIL_DOMAIN = "placeholder.rally.internal";

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

    const { league_id, display_name, unit } = await req.json();
    if (!league_id || typeof league_id !== "string") {
      return jsonResponse({ error: "league_id is required" }, 400);
    }
    const name = (display_name ?? "").trim();
    if (!name) return jsonResponse({ error: "display_name is required" }, 400);

    // Caller-context client — carries the requester's own JWT, so RLS
    // and is_league_admin() see the real caller, not the service role.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: isAdmin, error: adminCheckErr } = await callerClient.rpc(
      "is_league_admin",
      {
        p_league_id: league_id,
      },
    );
    if (adminCheckErr)
      return jsonResponse({ error: adminCheckErr.message }, 500);
    if (!isAdmin)
      return jsonResponse(
        { error: "Admin access required for this league" },
        403,
      );

    // Service-role client — only reached once the caller is confirmed a
    // league admin above.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const placeholderEmail = `placeholder-${crypto.randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`;

    const { data: created, error: createErr } =
      await adminClient.auth.admin.createUser({
        email: placeholderEmail,
        email_confirm: true, // never actually sent; nothing to confirm
        user_metadata: { display_name: name, unit: unit ?? null },
      });
    if (createErr || !created.user) {
      return jsonResponse(
        { error: createErr?.message ?? "Failed to create placeholder user" },
        500,
      );
    }

    const newUserId = created.user.id;

    // handle_new_user() already inserted the profiles row from the
    // trigger; flag it as a placeholder here.
    const { error: flagErr } = await adminClient
      .from("profiles")
      .update({ is_placeholder: true })
      .eq("id", newUserId);
    if (flagErr) return jsonResponse({ error: flagErr.message }, 500);

    // Enroll in the league. Placeholders aren't self-serve, so this
    // mirrors joinLeague()'s direct insert rather than going through a
    // player-facing RPC.
    const { error: enrollErr } = await adminClient
      .from("players")
      .insert({ profile_id: newUserId, league_id });
    if (enrollErr) return jsonResponse({ error: enrollErr.message }, 500);

    return jsonResponse({
      profile_id: newUserId,
      display_name: name,
      is_placeholder: true,
    });
  } catch (e) {
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
