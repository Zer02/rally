// src/composables/useHomeData.ts — v0.0.8.6
//
// The numbers on the home page, for visitors and players alike: how many players and matches
// the league has, the day streak, the top of the ladder with this week's change, and what the
// current round robin season is doing. Read straight from tables anyone can read, so a visitor
// sees the same as a member. Nothing here is scheduled or made up; where there is nothing
// (no league, no season) the value is simply empty and the page shows less.
import { computed, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useLeagueStore } from '@/stores/leagues'
import { countWithin, dayStreak, ratingChange } from '@/lib/homeStats'

export interface LadderRow {
  rank: number
  profile_id: string
  name: string
  rating: number
  change: number
}

export interface SeasonSummary {
  name: string
  weekNumber: number | null
  played: number       // matches finished this week
  total: number        // matches this week (byes excluded)
  players: number      // people with a match this week
}

const LADDER_SIZE = 5
const ROW_LIMIT = 2000

export function useHomeData() {
  const leagues = useLeagueStore()

  // The league being looked at. A visitor who has not picked one yet gets the only league
  // when the site has exactly one; with several, nothing is guessed.
  const leagueId = computed<string | null>(() =>
    leagues.currentLeagueId ?? (leagues.allLeagues.length === 1 ? leagues.allLeagues[0].id : null))

  const loaded = ref(false)
  const players = ref(0)
  const matches = ref(0)
  const matchesWeek = ref(0)
  const streak = ref(0)
  const ladder = ref<LadderRow[]>([])
  const season = ref<SeasonSummary | null>(null)

  let run = 0
  async function load() {
    const id = leagueId.value
    const mine = ++run
    if (!id) {
      players.value = matches.value = matchesWeek.value = streak.value = 0
      ladder.value = []; season.value = null; loaded.value = true
      return
    }
    const now = new Date()
    try {
      const [pl, lm, rm, tour] = await Promise.all([
        supabase.from('players')
          .select('profile_id, rating, profile:profiles(id, username, display_name)')
          .eq('league_id', id).order('rating', { ascending: false }).limit(500),
        supabase.from('matches').select('completed_at, status')
          .eq('league_id', id).eq('status', 'completed').limit(ROW_LIMIT),
        supabase.from('tournament_matches')
          .select('completed_at, status, tournament:tournaments!inner(league_id)')
          .eq('status', 'completed').eq('tournament.league_id', id).limit(ROW_LIMIT),
        supabase.from('tournaments').select('id, name').eq('league_id', id)
          .neq('status', 'completed').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (mine !== run) return

      const rows = (pl.data ?? []) as any[]
      players.value = rows.length
      // The queries already ask for finished matches; the filter here is a second guard so a
      // match that was never finished can never count towards the totals or the streak.
      const stamps = [...(lm.data ?? []), ...(rm.data ?? [])]
        .filter((m: any) => m.status === 'completed' && m.completed_at)
        .map((m: any) => m.completed_at as string)
      matches.value = stamps.length
      matchesWeek.value = countWithin(stamps, now)
      streak.value = dayStreak(stamps, now)

      const top = rows.slice(0, LADDER_SIZE)
      let hist: any[] = []
      if (top.length) {
        const h = await supabase.from('elo_history').select('profile_id, rating, recorded_at')
          .eq('league_id', id).in('profile_id', top.map(r => r.profile_id))
        hist = (h.data ?? []) as any[]
      }
      if (mine !== run) return
      ladder.value = top.map((r, i) => ({
        rank: i + 1,
        profile_id: r.profile_id,
        name: r.profile?.display_name || r.profile?.username || 'Player',
        rating: r.rating ?? 1000,
        change: ratingChange(hist.filter(h => h.profile_id === r.profile_id), r.rating ?? 1000, now),
      }))

      season.value = await loadSeason(tour.data as { id: string; name: string } | null)
    } catch {
      // The home page is a welcome, not a dependency: on any failure show what we have.
    } finally {
      if (mine === run) loaded.value = true
    }
  }

  async function loadSeason(t: { id: string; name: string } | null): Promise<SeasonSummary | null> {
    if (!t) return null
    const { data: weeks } = await supabase.from('tournament_weeks').select('id, week_number')
      .eq('tournament_id', t.id).order('week_number', { ascending: true })
    const wk = ((weeks ?? []) as any[]).slice(-1)[0]
    if (!wk) return { name: t.name, weekNumber: null, played: 0, total: 0, players: 0 }
    const { data } = await supabase.from('tournament_matches')
      .select('status, player_a_id, player_b_id, player_a2_id, player_b2_id')
      .eq('tournament_id', t.id).eq('week_id', wk.id)
    const wm = ((data ?? []) as any[]).filter(m => m.status !== 'bye')
    const who = new Set<string>()
    for (const m of wm) for (const k of ['player_a_id', 'player_b_id', 'player_a2_id', 'player_b2_id']) if (m[k]) who.add(m[k])
    return {
      name: t.name, weekNumber: wk.week_number,
      played: wm.filter(m => m.status === 'completed').length, total: wm.length, players: who.size,
    }
  }

  watch(leagueId, load, { immediate: true })
  return { loaded, leagueId, players, matches, matchesWeek, streak, ladder, season, reload: load }
}
