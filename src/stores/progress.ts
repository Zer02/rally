// src/stores/progress.ts — v0.0.5.1
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/composables/useAuth'
import { useLeagueStore } from './leagues'
import type { QuestTemplate, PlayerQuestProgress } from '@/types'

export interface QuestView {
  template:   QuestTemplate
  progress:   number
  completed:  boolean
  xpAwarded:  number
}

export interface EarnedQuest {
  title:        string
  cadence:      QuestTemplate['cadence']
  xp:           number
  completed_at: string
}

export const useProgressStore = defineStore('progress', () => {
  const quests  = ref<QuestView[]>([])
  const recent  = ref<EarnedQuest[]>([])
  const playXpWeek = ref<{ matches: number; xp: number }>({ matches: 0, xp: 0 })
  const loading = ref(false)
  const error   = ref<string | null>(null)

  const byCadence = computed(() => ({
    weekly:   quests.value.filter(q => q.template.cadence === 'weekly'),
    monthly:  quests.value.filter(q => q.template.cadence === 'monthly'),
    seasonal: quests.value.filter(q => q.template.cadence === 'seasonal'),
  }))

  // Recomputes progress server-side first (sync_quest_progress is
  // idempotent and awards XP the first time a quest crosses its target),
  // then reads back the current user's quests for the current periods.
  async function fetch() {
    const leagueId = useLeagueStore().currentLeagueId
    const { user } = useAuth()
    if (!leagueId || !user.value) { quests.value = []; recent.value = []; return }

    loading.value = true
    error.value = null

    const { error: syncErr } = await supabase.rpc('sync_quest_progress', { p_league_id: leagueId })
    if (syncErr) error.value = syncErr.message // still show whatever's already recorded

    const weekStart = new Date()
    weekStart.setUTCHours(0, 0, 0, 0)
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7)) // Monday, matches date_trunc('week')

    const [tplRes, progRes, seasonRes, playRes] = await Promise.all([
      supabase.from('quest_templates').select('*').eq('active', true),
      supabase.from('player_quest_progress').select('*')
        .eq('league_id', leagueId).eq('profile_id', user.value.id),
      supabase.from('tournaments').select('created_at')
        .eq('league_id', leagueId).neq('status', 'completed')
        .order('created_at', { ascending: false }).limit(1),
      supabase.from('player_weekly_play_xp').select('matches_counted, xp_awarded')
        .eq('league_id', leagueId).eq('profile_id', user.value.id)
        .eq('week_start', weekStart.toISOString()).maybeSingle(),
    ])
    playXpWeek.value = {
      matches: playRes.data?.matches_counted ?? 0,
      xp:      playRes.data?.xp_awarded ?? 0,
    }

    if (tplRes.error || progRes.error) {
      error.value = (tplRes.error ?? progRes.error)!.message
      loading.value = false
      return
    }

    const templates = (tplRes.data ?? []) as QuestTemplate[]
    const rows      = (progRes.data ?? []) as PlayerQuestProgress[]
    const activeSeasonStart = seasonRes.data?.[0]?.created_at ?? null
    const now = Date.now()

    // Latest period per template. Weekly/monthly rows are only "current"
    // if their period hasn't ended; seasonal rows only if they belong to
    // the currently-active round robin season (their stored period_end is
    // 'infinity' while the season runs, so it can't be used to tell).
    const CADENCE_ORDER = { weekly: 0, monthly: 1, seasonal: 2 } as const
    const views: QuestView[] = []
    for (const t of templates) {
      const mine = rows
        .filter(r => r.quest_template_id === t.id)
        .sort((a, b) => b.period_start.localeCompare(a.period_start))
      const latest = mine[0]

      let isCurrent = false
      if (latest) {
        if (t.cadence === 'seasonal') {
          isCurrent = !!activeSeasonStart &&
            new Date(latest.period_start).getTime() === new Date(activeSeasonStart).getTime()
        } else {
          isCurrent = new Date(latest.period_end).getTime() > now
        }
      }

      // Seasonal quests with no active season are hidden entirely rather
      // than shown as a stale 0/N — nothing to progress until one starts.
      if (t.cadence === 'seasonal' && !activeSeasonStart) continue

      views.push({
        template:  t,
        progress:  isCurrent ? latest!.progress_count : 0,
        completed: isCurrent ? !!latest!.completed_at : false,
        xpAwarded: isCurrent ? latest!.xp_awarded : 0,
      })
    }
    views.sort((a, b) =>
      CADENCE_ORDER[a.template.cadence] - CADENCE_ORDER[b.template.cadence] ||
      a.template.xp_reward - b.template.xp_reward)
    quests.value = views

    // Everything ever earned, newest first — the "you've been doing
    // great" list, deliberately independent of the current period.
    const byId = new Map(templates.map(t => [t.id, t]))
    recent.value = rows
      .filter(r => r.completed_at && byId.has(r.quest_template_id))
      .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))
      .slice(0, 8)
      .map(r => {
        const t = byId.get(r.quest_template_id)!
        return { title: t.title, cadence: t.cadence, xp: r.xp_awarded, completed_at: r.completed_at! }
      })

    loading.value = false
  }

  return { quests, recent, playXpWeek, loading, error, byCadence, fetch }
})
