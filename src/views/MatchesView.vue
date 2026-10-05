<!-- src/views/MatchesView.vue — v0.0.6.1 -->
<template>
  <main class="page">
    <div class="container">
      <div class="page-header" style="display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:1rem">
        <div>
          <p class="eyebrow">Activity</p>
          <h1>Matches</h1>
        </div>
        <div class="match-filters">
          <div class="field" style="min-width:140px">
            <label class="field-label">Board</label>
            <select v-model="board" class="input">
              <option value="rr">Round robin</option>
              <option value="ladder">Ladder</option>
            </select>
          </div>
          <div v-if="isAuthed" class="field" style="min-width:140px">
            <label class="field-label">Show</label>
            <select v-model="scope" class="input">
              <option value="all">All matches</option>
              <option value="mine">My matches</option>
            </select>
          </div>
        </div>
      </div>

      <!-- ── Round robin board ── -->
      <template v-if="board === 'rr'">
        <button
          v-if="isAuthed && ladderAttention"
          type="button"
          class="flash flash-error ladder-nudge"
          @click="board = 'ladder'"
        >
          {{ ladderAttention }} ladder {{ ladderAttention === 1 ? 'match needs' : 'matches need' }} your attention — view ladder →
        </button>

        <p v-if="removeNotice" class="flash flash-success" style="margin-bottom:1rem" role="status">{{ removeNotice }}</p>
        <p v-if="removeError" class="flash flash-error" style="margin-bottom:1rem" role="alert">{{ removeError }}</p>

        <div v-if="rrLoading" style="text-align:center;padding:3rem 0">
          <span class="spinner" style="width:28px;height:28px;border-width:3px" />
        </div>
        <template v-else>
          <p v-if="rrError" class="flash flash-error" style="margin-bottom:1rem">{{ rrError }}</p>
          <section>
            <h3 style="margin-bottom:0.875rem">Recent matches</h3>
            <div v-if="!rrCards.length" class="muted" style="padding:2rem 0">
              {{ scope === 'mine' ? "You haven't played a round robin match yet." : 'No round robin matches yet.' }}
            </div>
            <div style="display:flex;flex-direction:column;gap:0.75rem">
              <ScoreCard
                v-for="c in rrCards"
                :key="c.id"
                :sides="c.sides"
                :done="true"
                :when="c.when"
                :meta="c.meta"
                :result="c.result"
              >
                <!-- Admin only, and only while the match's season is still running -->
                <template v-if="c.removable" #footer>
                  <div v-if="confirmingId !== c.id" class="rm-row">
                    <button class="btn btn-ghost btn-sm" type="button" :disabled="removeBusy" @click="askRemove(c.id)">Remove</button>
                  </div>
                  <div v-else class="rm-confirm">
                    <p class="rm-text">
                      Remove <strong>{{ c.summary }}</strong>? Standings and ratings for this season are
                      recalculated as if it was never played. To fix a wrong score, remove it, then add the
                      match again on the Round Robin page.
                    </p>
                    <div class="rm-actions">
                      <button class="btn btn-danger btn-sm" type="button" :disabled="removeBusy" @click="doRemove(c)">
                        <span v-if="removeBusy" class="spinner" style="width:12px;height:12px;border-width:2px" />
                        <span v-else>Yes, remove it</span>
                      </button>
                      <button class="btn btn-ghost btn-sm" type="button" :disabled="removeBusy" @click="confirmingId = null">Cancel</button>
                    </div>
                  </div>
                </template>
              </ScoreCard>
            </div>
          </section>
        </template>
      </template>

      <template v-else>
      <div v-if="matchesStore.loading" style="text-align:center;padding:3rem 0">
        <span class="spinner" style="width:28px;height:28px;border-width:3px" />
      </div>

      <template v-else>
        <!-- Disputed — admin only -->
        <section v-if="isAdmin && matchesStore.disputed.length" style="margin-bottom:2rem">
          <h3 style="margin-bottom:0.875rem">⚠️ Disputed results</h3>
          <div class="flash flash-error" style="margin-bottom:0.875rem">
            Players reported conflicting results. As admin, pick which report is correct.
          </div>
          <div style="display:flex;flex-direction:column;gap:0.75rem">
            <div v-for="m in matchesStore.disputed" :key="m.id" class="card" style="padding:1.25rem">
              <div style="font-size:0.9rem;font-weight:500;color:var(--txt-primary);margin-bottom:0.375rem">
                {{ m.challenger?.display_name || m.challenger?.username }}
                vs
                {{ m.opponent?.display_name || m.opponent?.username }}
              </div>
              <div style="font-size:0.72rem;color:var(--txt-muted);margin-bottom:0.75rem;font-style:italic">
                {{ disputeReason(m) }}
              </div>
              <div style="font-size:0.8rem;color:var(--txt-muted);margin-bottom:4px">
                <span style="color:var(--txt-secondary)">{{ m.challenger?.display_name }} says:</span>
                {{ reportedWinnerName(m, 'challenger') }} won
                <span v-if="m.challenger_reported_score" class="mono" style="margin-left:4px">({{ m.challenger_reported_score }})</span>
              </div>
              <div style="font-size:0.8rem;color:var(--txt-muted);margin-bottom:1rem">
                <span style="color:var(--txt-secondary)">{{ m.opponent?.display_name }} says:</span>
                {{ reportedWinnerName(m, 'opponent') }} won
                <span v-if="m.opponent_reported_score" class="mono" style="margin-left:4px">({{ m.opponent_reported_score }})</span>
              </div>
              <div style="font-size:0.72rem;color:var(--txt-muted);margin-bottom:0.5rem">
                Pick whichever report is correct — winner and score are applied together, so you can't mix one player's winner with the other's score.
              </div>
              <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
                <button class="btn btn-ghost btn-sm" @click="resolve(m.id, true)">
                  Use {{ m.challenger?.display_name || 'challenger' }}'s report
                  — {{ reportedWinnerName(m, 'challenger') }} won ({{ m.challenger_reported_score }})
                </button>
                <button class="btn btn-ghost btn-sm" @click="resolve(m.id, false)">
                  Use {{ m.opponent?.display_name || 'opponent' }}'s report
                  — {{ reportedWinnerName(m, 'opponent') }} won ({{ m.opponent_reported_score }})
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Non-admin disputed notice -->
        <section v-if="!isAdmin && myDisputed.length" style="margin-bottom:2rem">
          <div class="flash flash-error">
            {{ myDisputed.length }} match{{ myDisputed.length > 1 ? 'es have' : ' has' }} a disputed result — an admin will resolve {{ myDisputed.length > 1 ? 'them' : 'it' }} shortly.
          </div>
        </section>

        <!-- Needs my action -->
        <section v-if="myPending.length && isAuthed" style="margin-bottom:2rem">
          <h3 style="margin-bottom:0.875rem">Needs your attention</h3>
          <div style="display:flex;flex-direction:column;gap:0.75rem">
            <MatchCard
              v-for="m in myPending"
              :key="m.id"
              :match="m"
              :current-user-id="user?.id"
              @accept="accept(m.id)"
              @decline="decline(m.id)"
              @submit="openResult"
            />
          </div>
        </section>

        <!-- Waiting for opponent -->
        <section v-if="waitingFor.length && isAuthed" style="margin-bottom:2rem">
          <h3 style="margin-bottom:0.875rem">Waiting for opponent</h3>
          <div style="display:flex;flex-direction:column;gap:0.75rem">
            <div
              v-for="m in waitingFor"
              :key="m.id"
              class="card"
              style="padding:1rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem"
            >
              <div style="font-size:0.875rem;color:var(--txt-secondary)">
                vs {{ opponentName(m) }} — you've submitted, waiting for their score
              </div>
              <span class="status status-pending">Pending</span>
            </div>
          </div>
        </section>

        <!-- Recent completed -->
        <section>
          <h3 style="margin-bottom:0.875rem">Recent matches</h3>
          <div v-if="!ladderCompleted.length" class="muted" style="padding:2rem 0">
            {{ scope === 'mine' ? "You haven't played a ladder match yet." : 'No matches yet — go challenge someone!' }}
          </div>
          <div style="display:flex;flex-direction:column;gap:0.75rem">
            <MatchCard
              v-for="m in ladderCompleted"
              :key="m.id"
              :match="m"
              :current-user-id="user?.id"
            />
          </div>
        </section>
      </template>
      </template>

      <ResultModal
        v-if="activeMatch"
        :match="activeMatch"
        :reporter-id="user?.id ?? ''"
        @close="activeMatch = null"
        @submit="submitResult"
      />
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useMatchesStore } from '@/stores/matches'
import { useAuth } from '@/composables/useAuth'
import { onLeagueChange } from '@/composables/useLeagueWatch'
import MatchCard from '@/components/match/MatchCard.vue'
import ResultModal from '@/components/match/ResultModal.vue'
import ScoreCard, { type ScoreSide } from '@/components/match/ScoreCard.vue'
import { useTournamentsStore } from '@/stores/tournaments'
import type { TournamentMatch } from '@/types'
import { rrMatchPoints } from '@/lib/score'
import type { Match } from '@/types'

const matchesStore = useMatchesStore()
const { user, isAuthed, isAdmin } = useAuth()
const tournaments = useTournamentsStore()
const activeMatch = ref<Match | null>(null)

// Round robin is the default board (as on Standings and Profile); the ladder
// is unchanged, one dropdown away.
const board = ref<'rr' | 'ladder'>('rr')
const scope = ref<'all' | 'mine'>('all')

type RRMatch = TournamentMatch & { tournament: { id: string; name: string; status?: string } }
const rrMatches = ref<RRMatch[]>([])
const rrDeltas  = ref<Record<string, number>>({})
const rrLoading = ref(false)
const rrError   = ref('')

// Removing a played match (admin only). One confirmation open at a time.
const confirmingId  = ref<string | null>(null)
const removeBusy    = ref(false)
const removeNotice  = ref('')
const removeError   = ref('')

async function loadRR() {
  rrLoading.value = true
  rrError.value = ''
  try {
    const r = await tournaments.fetchLeagueMatches()
    rrMatches.value = r.matches
    rrDeltas.value = r.deltas
  } catch (e) {
    rrMatches.value = []
    rrError.value = (e as Error).message
  } finally {
    rrLoading.value = false
  }
}

function loadAll() { matchesStore.fetch(); loadRR() }
onMounted(loadAll)
onLeagueChange(loadAll)
watch(board, (b) => { if (b === 'rr') loadRR() })

const mine = (m: Match) => m.challenger_id === user.value?.id || m.opponent_id === user.value?.id
const ladderCompleted = computed(() =>
  scope.value === 'mine' ? matchesStore.completed.filter(mine) : matchesStore.completed
)
// Ladder items waiting on the signed-in player — surfaced on the round robin
// board too so a challenge can't go unseen just because that board is showing.
const ladderAttention = computed(() => myPending.value.length + myDisputed.value.length)

function nm(p?: { display_name: string | null; username: string } | null) {
  return p?.display_name || p?.username || '?'
}
function whenLabel(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1)    return 'Just now'
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const rrCards = computed(() => {
  const me = user.value?.id
  const cards = rrMatches.value.map(m => {
    const aIds = [m.player_a_id, m.player_a2_id].filter(Boolean) as string[]
    const bIds = [m.player_b_id, m.player_b2_id].filter(Boolean) as string[]
    // Decided from the score: winner_id names only one player on a doubles match.
    const aWon = (m.score_a ?? 0) > (m.score_b ?? 0)
    const bWon = (m.score_b ?? 0) > (m.score_a ?? 0)
    const deltaFor = (ids: string[]) => {
      const d = ids.map(id => rrDeltas.value[`${m.id}:${id}`]).find(v => v != null)
      return d ?? null
    }
    // v0.0.6.3: the points this match added to each side's season total.
    // Challenge matches earn none (same rule as report_tournament_match()).
    const pointsFor = (mine: number | null, theirs: number | null) =>
      m.phase === 'challenge' || mine == null || theirs == null ? null : rrMatchPoints(mine, theirs)
    const side = (ids: string[], profs: (typeof m.player_a | undefined)[], won: boolean, score: number | null, other: number | null): ScoreSide => ({
      names: profs.filter(Boolean).map(nm),
      isWinner: won, isMe: !!me && ids.includes(me),
      delta: deltaFor(ids), total: score, points: pointsFor(score, other),
    })
    const sides: [ScoreSide, ScoreSide] = [
      side(aIds, [m.player_a, m.player_a2], aWon, m.score_a, m.score_b),
      side(bIds, [m.player_b, m.player_b2], bWon, m.score_b, m.score_a),
    ]
    const iAmA = !!me && aIds.includes(me), iAmB = !!me && bIds.includes(me)
    const result: 'win' | 'loss' | null =
      (iAmA && aWon) || (iAmB && bWon) ? 'win' : (iAmA || iAmB) && (aWon || bWon) ? 'loss' : null
    const namesOf = (profs: (typeof m.player_a | undefined)[]) => profs.filter(Boolean).map(nm).join(' & ')
    // Same rule the database enforces: a running season, and not a bracket match.
    const removable = isAdmin.value && m.tournament?.status === 'round_robin' && m.phase !== 'bracket'
    const kind = m.phase === 'bracket' ? ' · Bracket' : m.phase === 'challenge' ? ' · Challenge' : m.format === 'doubles' ? ' · Doubles' : ''
    return {
      id: m.id, sides, result, mine: iAmA || iAmB, removable,
      summary: `${namesOf([m.player_a, m.player_a2])} ${m.score_a}–${m.score_b} ${namesOf([m.player_b, m.player_b2])}`,
      when: whenLabel(m.completed_at), meta: `${m.tournament?.name ?? 'Round robin'}${kind}`,
    }
  })
  return scope.value === 'mine' ? cards.filter(c => c.mine) : cards
})

function askRemove(id: string) {
  removeNotice.value = ''
  removeError.value = ''
  confirmingId.value = id
}

async function doRemove(c: { id: string; summary: string }) {
  removeBusy.value = true
  removeError.value = ''
  removeNotice.value = ''
  try {
    const res = await tournaments.removePlayedMatch(c.id)
    confirmingId.value = null
    removeNotice.value = `Removed ${c.summary}. ` + (res.recalculated
      ? `${res.recalculated} later ${res.recalculated === 1 ? 'match was' : 'matches were'} recalculated, and the season standings are updated.`
      : 'Standings and ratings are updated.')
    await loadRR()
  } catch (e) {
    removeError.value = (e as Error).message
  } finally {
    removeBusy.value = false
  }
}

const myPending = computed(() =>
  matchesStore.pending.filter(m => {
    const isParticipant = m.challenger_id === user.value?.id || m.opponent_id === user.value?.id
    if (!isParticipant) return false
    if (m.status === 'pending') return m.opponent_id === user.value?.id
    const iHaveReported = m.challenger_id === user.value?.id
      ? !!m.challenger_reported_winner
      : !!m.opponent_reported_winner
    return !iHaveReported
  })
)

const waitingFor = computed(() =>
  matchesStore.pending.filter(m => {
    const isParticipant = m.challenger_id === user.value?.id || m.opponent_id === user.value?.id
    if (!isParticipant || m.status !== 'accepted') return false
    const iHaveReported = m.challenger_id === user.value?.id
      ? !!m.challenger_reported_winner
      : !!m.opponent_reported_winner
    return iHaveReported
  })
)

const myDisputed = computed(() =>
  matchesStore.disputed.filter(m =>
    m.challenger_id === user.value?.id || m.opponent_id === user.value?.id
  )
)

function opponentName(m: Match) {
  if (m.challenger_id === user.value?.id)
    return m.opponent?.display_name || m.opponent?.username
  return m.challenger?.display_name || m.challenger?.username
}

function reportedWinnerName(m: Match, side: 'challenger' | 'opponent') {
  const winnerId = side === 'challenger' ? m.challenger_reported_winner : m.opponent_reported_winner
  if (!winnerId) return 'not yet submitted'
  if (winnerId === m.challenger_id) return m.challenger?.display_name || m.challenger?.username
  return m.opponent?.display_name || m.opponent?.username
}

// Explains *why* a match landed in disputed — winner disagreement and score
// disagreement need different handling by the admin, so don't lump them together.
function disputeReason(m: Match) {
  const winnerDisagree = m.challenger_reported_winner !== m.opponent_reported_winner
  const scoreDisagree  = m.challenger_reported_score  !== m.opponent_reported_score

  if (winnerDisagree && scoreDisagree) return 'Players disagree on both winner and score'
  if (winnerDisagree)                  return 'Players disagree on who won'
  if (scoreDisagree)                   return 'Same winner reported, but scores don\u2019t match — check for a typo'
  return 'Flagged for review'
}

async function accept(id: string)  { await matchesStore.respond(id, true) }
async function decline(id: string) { await matchesStore.respond(id, false) }
function openResult(match: Match)  { activeMatch.value = match }

async function submitResult(payload: any) {
  await matchesStore.submitResult(
    payload.matchId, payload.reporterId, payload.winnerId, payload.loserId,
    payload.challengerScores, payload.opponentScores,
  )
  activeMatch.value = null
}

// useChallengerReport: true = trust challenger's winner+score together,
// false = trust opponent's — never mix a winner from one report with a
// score from the other (that's the bug this replaces).
async function resolve(matchId: string, useChallengerReport: boolean) {
  await matchesStore.resolveDispute(matchId, useChallengerReport)
}
</script>

<style scoped>
.match-filters { display: flex; gap: 0.75rem; flex-wrap: wrap; }
.rm-row { display: flex; justify-content: flex-end; padding: 0.25rem 0.25rem 0; }
.rm-confirm { margin-top: 0.5rem; padding: 0.7rem 0.75rem; border-radius: var(--radius-sm); background: rgba(224,82,82,0.07); border: 1px solid rgba(224,82,82,0.25); }
.rm-text { font-size: 0.82rem; line-height: 1.5; margin: 0 0 0.6rem; color: var(--txt-secondary); word-break: break-word; }
.rm-text strong { color: var(--txt-primary); font-weight: 600; }
.rm-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.ladder-nudge { display: block; width: 100%; text-align: left; font: inherit; margin-bottom: 1.25rem; cursor: pointer; }
</style>
