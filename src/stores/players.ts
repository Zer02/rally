// src/stores/players.ts — v0.0.3.1
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useLeagueStore } from './leagues'
import type { Player } from '@/types'
import { FunctionsHttpError } from '@supabase/supabase-js'

// supabase.functions.invoke() throws a generic "Edge Function returned a
// non-2xx status code" on any error response — it does NOT surface the
// function's own { error: "..." } JSON body by default. The real message
// is on err.context, which is the raw Response, and has to be read and
// parsed separately. Falls back to the generic message if that read fails
// for any reason (network hiccup mid-parse, non-JSON body, etc).
async function describeFunctionError(err: unknown): Promise<string> {
  if (err instanceof FunctionsHttpError) {
    try {
      const body = await err.context.json()
      if (body?.error) return body.error
    } catch {
      // fall through to the generic message below
    }
  }
  return err instanceof Error ? err.message : 'Edge Function request failed'
}

export const usePlayersStore = defineStore('players', () => {
  const players     = ref<Player[]>([])
  const loading     = ref(false)
  const error       = ref<string | null>(null)
  let   subscription: ReturnType<typeof supabase.channel> | null = null

  const sorted = computed(() =>
    [...players.value].sort((a, b) => b.rating - a.rating)
  )

  async function fetch() {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) { players.value = []; return }

    loading.value = true
    const { data, error: err } = await supabase
      .from('players')
      .select('*, profile:profiles(id, username, display_name, unit, avatar_url, is_admin, is_placeholder)')
      .eq('league_id', leagueId)
      .order('rating', { ascending: false })

    if (err) { error.value = err.message }
    else { players.value = (data ?? []) as Player[] }
    loading.value = false
  }

  // Subscribe to realtime player row changes
  // so leaderboard and profile update automatically
  function subscribe() {
    if (subscription) return

    subscription = supabase
      .channel('players-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'players' },
        async () => {
          // Re-fetch all players when any player row updates
          await fetch()
        }
      )
      .subscribe()
  }

  function unsubscribe() {
    if (subscription) {
      supabase.removeChannel(subscription)
      subscription = null
    }
  }

  function byId(id: string) {
    return players.value.find(p => p.profile_id === id)
  }

  // Admin-only: zero out season_wins/season_losses for every player in
  // the currently selected league, archiving their standing first (see
  // reset_season() — it's not just a wipe). Authorization is enforced
  // server-side by is_league_admin(), not by anything client-side here.
  async function resetSeason() {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) throw new Error('No league selected')

    const { error: err } = await supabase.rpc('reset_season', { p_league_id: leagueId })
    if (err) throw new Error(err.message)
    await fetch()
  }

  // Admin-only (league admin). Adds a player to the current league by
  // display name only, no email — goes through the create-placeholder-player
  // Edge Function since creating an auth user needs the Admin API, which
  // isn't reachable from the browser client. Authorization is enforced
  // inside the function itself via is_league_admin(), same as every RPC
  // here — this is just the transport.
  async function createPlaceholderPlayer(displayName: string, unit?: string) {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) throw new Error('No league selected')

    const { data, error: err } = await supabase.functions.invoke('create-placeholder-player', {
      body: { league_id: leagueId, display_name: displayName, unit: unit || null },
    })
    if (err) throw new Error(await describeFunctionError(err))
    if (data?.error) throw new Error(data.error)

    await fetch()
    return data as { profile_id: string; display_name: string; is_placeholder: true }
  }

  // Global-admin-only. Attaches a real email to a placeholder player so
  // they can be sent a "set your password" link. Fires resetPasswordForEmail
  // right after the Edge Function confirms the email is now on file —
  // splitting it this way (rather than the function sending it) keeps the
  // Edge Function itself free of any email-sending config.
  async function claimPlaceholderPlayer(profileId: string, email: string) {
    const { data, error: err } = await supabase.functions.invoke('claim-placeholder-player', {
      body: { profile_id: profileId, email },
    })
    if (err) throw new Error(await describeFunctionError(err))
    if (data?.error) throw new Error(data.error)

    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email)
    if (resetErr) throw new Error(resetErr.message)

    await fetch()
    return data as { profile_id: string; email: string; is_placeholder: false }
  }

  return {
    players, loading, error, sorted, fetch, byId, subscribe, unsubscribe, resetSeason,
    createPlaceholderPlayer, claimPlaceholderPlayer,
  }
})
