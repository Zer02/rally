// src/stores/brackets.ts — v0.0.8.5
//
// Knockout tournaments. Everything here is read-only from the app's side except
// through the four admin functions (preview / create / report / delete), which the
// database checks for league admin itself. Tournaments never touch ratings, XP,
// the pass or quests.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useLeagueStore } from './leagues'
import { rrScoreError } from '@/lib/score'
import { entrantError, profileName } from '@/lib/bracket'
import type { BracketEvent, BracketEntrant, BracketMatch, SeedPreviewRow } from '@/types'

const ENTRANT_SELECT = '*, profile:profiles(id, username, display_name, avatar_url, is_placeholder)'

export const useBracketsStore = defineStore('brackets', () => {
  const events   = ref<BracketEvent[]>([])
  const current  = ref<BracketEvent | null>(null)
  const entrants = ref<BracketEntrant[]>([])
  const matches  = ref<BracketMatch[]>([])
  const loading  = ref(false)
  const error    = ref<string | null>(null)

  const entrantByProfile = computed(() => {
    const map = new Map<string, BracketEntrant>()
    entrants.value.forEach(e => map.set(e.profile_id, e))
    return map
  })

  const championName = computed(() => {
    const id = current.value?.champion_id
    return id ? profileName(entrantByProfile.value.get(id)?.profile) : null
  })

  async function fetchEvents() {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) { events.value = []; return }
    loading.value = true
    const { data, error: err } = await supabase
      .from('bracket_events').select('*').eq('league_id', leagueId)
      .order('created_at', { ascending: false })
    loading.value = false
    if (err) { error.value = err.message; return }
    events.value = (data ?? []) as BracketEvent[]
  }

  async function fetchEvent(id: string) {
    loading.value = true
    error.value = null
    const { data: ev, error: e1 } = await supabase
      .from('bracket_events').select('*').eq('id', id).maybeSingle()
    if (e1 || !ev) {
      current.value = null; entrants.value = []; matches.value = []
      loading.value = false
      if (e1) error.value = e1.message
      return
    }
    current.value = ev as BracketEvent
    await Promise.all([fetchEntrants(id), fetchMatches(id)])
    loading.value = false
  }

  async function fetchEntrants(id: string) {
    const { data, error: err } = await supabase
      .from('bracket_entrants').select(ENTRANT_SELECT).eq('event_id', id).order('seed')
    if (err) { error.value = err.message; return }
    entrants.value = (data ?? []) as BracketEntrant[]
  }

  async function fetchMatches(id: string) {
    const { data, error: err } = await supabase
      .from('bracket_matches').select('*').eq('event_id', id)
      .order('round').order('slot')
    if (err) { error.value = err.message; return }
    matches.value = (data ?? []) as BracketMatch[]
  }

  // Admin. The draw as it would be made, without saving anything.
  async function previewSeeds(seeding: 'ladder' | 'round_robin', profileIds: string[]): Promise<SeedPreviewRow[]> {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) throw new Error('No league selected')
    const problem = entrantError(profileIds.length)
    if (problem) throw new Error(problem)
    const { data, error: err } = await supabase.rpc('preview_bracket_seeds', {
      p_league_id: leagueId, p_seeding: seeding, p_profile_ids: profileIds,
    })
    if (err) throw new Error(err.message)
    return (data ?? []) as SeedPreviewRow[]
  }

  // Admin. Generates and saves the bracket; returns the new event's id.
  async function createEvent(name: string, seeding: 'ladder' | 'round_robin', profileIds: string[]): Promise<string> {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) throw new Error('No league selected')
    const problem = entrantError(profileIds.length)
    if (problem) throw new Error(problem)
    const { data, error: err } = await supabase.rpc('create_bracket_event', {
      p_league_id: leagueId, p_name: name.trim(), p_seeding: seeding, p_profile_ids: profileIds,
    })
    if (err) throw new Error(err.message)
    await fetchEvents()
    return data as string
  }

  // Admin. Enter or correct a result.
  async function reportMatch(matchId: string, scoreA: number, scoreB: number) {
    const problem = rrScoreError(scoreA, scoreB)
    if (problem) throw new Error(problem)
    const { error: err } = await supabase.rpc('report_bracket_match', {
      p_match_id: matchId, p_score_a: scoreA, p_score_b: scoreB,
    })
    if (err) throw new Error(err.message)
    if (current.value) await fetchEvent(current.value.id)
  }

  // Admin. Removes the event, its entrants and its matches.
  async function deleteEvent(id: string) {
    const { error: err } = await supabase.rpc('delete_bracket_event', { p_event_id: id })
    if (err) throw new Error(err.message)
    current.value = null; entrants.value = []; matches.value = []
    await fetchEvents()
  }

  return {
    events, current, entrants, matches, loading, error, entrantByProfile, championName,
    fetchEvents, fetchEvent, previewSeeds, createEvent, reportMatch, deleteEvent,
  }
})
