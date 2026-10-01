<template>
  <div class="card accounts-panel" style="padding:1.25rem">
    <button
      class="accounts-head"
      type="button"
      :aria-expanded="open"
      aria-controls="player-accounts-body"
      @click="toggle"
    >
      <span>
        <span class="field-label" style="margin-bottom:0.2rem;display:block">Player accounts</span>
        <span v-if="!playersStore.loading || rows.length" class="muted" style="font-size:0.8rem">
          <template v-if="waitingCount">{{ waitingCount }} waiting on an invite · </template>{{ rows.length }}
          {{ rows.length === 1 ? 'player' : 'players' }} in this league
        </span>
      </span>
      <span class="accounts-chevron" aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
    </button>

    <div v-if="open" id="player-accounts-body" style="margin-top:1rem">
      <p class="muted" style="font-size:0.8rem;margin-bottom:0.75rem">
        Send a password reset, fix a wrong email, or invite someone who has no account yet.
        Emails stay hidden: you see a masked version, and reset links go straight to the player.
      </p>

      <div class="accounts-toolbar">
        <span v-if="loading" class="muted" style="font-size:0.8rem">
          <span class="spinner" style="width:12px;height:12px;border-width:2px;vertical-align:-2px" /> Loading accounts…
        </span>
        <span v-else-if="counts" class="muted" style="font-size:0.78rem">{{ counts }}</span>
        <span class="acct-toolbar-btns">
          <button
            v-if="activeCount"
            class="btn btn-ghost btn-sm"
            type="button"
            :aria-pressed="showActive"
            @click="toggleActive"
          >{{ showActive ? 'Hide active players' : `Show active players (${activeCount})` }}</button>
          <button class="btn btn-ghost btn-sm" type="button" :disabled="loading" @click="reload">Refresh</button>
        </span>
      </div>

      <p v-if="loadError" class="flash flash-error">{{ loadError }}</p>

      <div v-for="r in visibleRows" :key="r.profile_id" class="acct-row" :data-status="r.status">
        <div class="acct-main">
          <div class="acct-name-line">
            <span class="acct-name">{{ r.name }}</span>
            <span v-if="r.isMe" class="acct-tag">You</span>
            <span v-else-if="r.isAdmin" class="acct-tag">Admin</span>
            <span class="acct-status" :class="`acct-status-${r.status}`">{{ statusLabel(r.status) }}</span>
          </div>
          <div class="muted acct-meta">
            <template v-if="r.status === 'name_only'">No email yet. They can't sign in.</template>
            <template v-else-if="r.status === 'invited'">
              Invite sent<template v-if="r.maskedEmail"> to {{ r.maskedEmail }}</template><template v-if="r.invitedAt"> · {{ timeAgo(r.invitedAt) }}</template>
              · {{ signInText(r.lastSignIn, 'Not opened yet') }}
            </template>
            <template v-else-if="r.status === 'unknown'">Couldn't load this account. Try Refresh.</template>
            <template v-else>
              {{ r.maskedEmail || 'No email on file' }} · {{ signInText(r.lastSignIn, 'Never signed in') }}
            </template>
          </div>

          <!-- Inline: invite / fix email (placeholder players) -->
          <div v-if="act.id === r.profile_id && act.mode === 'invite'" class="acct-form">
            <input
              v-model="inviteEmail"
              type="email"
              class="input"
              placeholder="their@email.com"
              aria-label="Their email address"
              autocomplete="off" autocapitalize="none" spellcheck="false"
              @keyup.enter="submitInvite(r)"
            />
            <button class="btn btn-primary btn-sm" type="button" :disabled="!inviteEmail.trim() || busy" @click="submitInvite(r)">
              <span v-if="busy" class="spinner" style="width:12px;height:12px;border-width:2px" />
              <span v-else>{{ r.status === 'invited' ? 'Resend invite' : 'Send invite' }}</span>
            </button>
            <button class="btn btn-ghost btn-sm" type="button" @click="closeAction">Cancel</button>
          </div>

          <!-- Inline: remove placeholder -->
          <div v-else-if="act.id === r.profile_id && act.mode === 'remove'" class="acct-form">
            <span class="muted" style="font-size:0.8rem">Remove {{ r.name }} for good?</span>
            <button class="btn btn-danger btn-sm" type="button" :disabled="busy" @click="submitRemove(r)">
              <span v-if="busy" class="spinner" style="width:12px;height:12px;border-width:2px" />
              <span v-else>Yes, remove</span>
            </button>
            <button class="btn btn-ghost btn-sm" type="button" @click="closeAction">Cancel</button>
          </div>

          <!-- Inline: change email, step 1 (type it twice) -->
          <div v-else-if="act.id === r.profile_id && act.mode === 'email' && act.step === 'form'" class="acct-form acct-form-col">
            <input
              v-model="newEmail"
              type="email"
              class="input"
              placeholder="New email address"
              aria-label="New email address"
              autocomplete="off" autocapitalize="none" spellcheck="false"
            />
            <input
              v-model="confirmEmail"
              type="email"
              class="input"
              placeholder="Type it again to confirm"
              aria-label="Confirm new email address"
              autocomplete="off" autocapitalize="none" spellcheck="false"
              @keyup.enter="emailFormValid && (act.step = 'confirm')"
            />
            <span v-if="emailFormHint" class="muted" style="font-size:0.75rem">{{ emailFormHint }}</span>
            <div class="acct-form-actions">
              <button class="btn btn-primary btn-sm" type="button" :disabled="!emailFormValid" @click="act.step = 'confirm'">Review</button>
              <button class="btn btn-ghost btn-sm" type="button" @click="closeAction">Cancel</button>
            </div>
          </div>

          <!-- Inline: change email, step 2 (confirm) -->
          <div v-else-if="act.id === r.profile_id && act.mode === 'email' && act.step === 'confirm'" class="acct-form acct-form-col">
            <p class="acct-confirm">
              Change <strong>{{ r.name }}</strong>'s email<template v-if="r.maskedEmail"> from <strong>{{ r.maskedEmail }}</strong></template>
              to <strong>{{ newEmailClean }}</strong>?
              A password reset link will be sent to the new address, and the old one stops working for sign-in.
            </p>
            <div class="acct-form-actions">
              <button class="btn btn-primary btn-sm" type="button" :disabled="busy" @click="submitEmail(r)">
                <span v-if="busy" class="spinner" style="width:12px;height:12px;border-width:2px" />
                <span v-else>Yes, change it</span>
              </button>
              <button class="btn btn-ghost btn-sm" type="button" :disabled="busy" @click="act.step = 'form'">Back</button>
              <button class="btn btn-ghost btn-sm" type="button" :disabled="busy" @click="closeAction">Cancel</button>
            </div>
          </div>
        </div>

        <!-- Row actions (hidden while this row has an open form) -->
        <div v-if="act.id !== r.profile_id" class="acct-actions">
          <template v-if="r.isMe" />
          <template v-else-if="r.status === 'name_only' || r.status === 'invited'">
            <button class="btn btn-ghost btn-sm" type="button" @click="openAction(r, 'invite')">
              {{ r.status === 'invited' ? 'Resend / fix email' : 'Send invite' }}
            </button>
            <button class="btn btn-ghost btn-sm" type="button" @click="openAction(r, 'remove')">Remove</button>
          </template>
          <template v-else-if="r.status === 'active'">
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="resettingId === r.profile_id || cooldownLeft(r.profile_id) > 0"
              @click="sendReset(r)"
            >
              <span v-if="resettingId === r.profile_id" class="spinner" style="width:12px;height:12px;border-width:2px" />
              <span v-else-if="cooldownLeft(r.profile_id) > 0">Sent · {{ cooldownLeft(r.profile_id) }}s</span>
              <span v-else>Send password reset</span>
            </button>
            <button v-if="!r.isAdmin" class="btn btn-ghost btn-sm" type="button" @click="openAction(r, 'email')">Change email</button>
          </template>
          <template v-else-if="r.status === 'unconfirmed'">
            <button class="btn btn-ghost btn-sm" type="button" @click="openAction(r, 'email')">Change email</button>
          </template>
        </div>
      </div>

      <p v-if="!loading && !rows.length" class="muted" style="font-size:0.85rem">No players in this league yet.</p>
      <p v-else-if="!loading && loaded && !visibleRows.length" class="muted" style="font-size:0.85rem;margin-top:0.5rem">
        Everyone here has an active account.
      </p>

      <p v-if="error" class="flash flash-error" style="margin-top:0.75rem" role="alert">{{ error }}</p>
      <p v-if="notice" class="flash flash-success" style="margin-top:0.75rem" role="status">{{ notice }}</p>

      <div class="acct-log">
        <div class="acct-log-head">
          <button
            class="acct-log-toggle"
            type="button"
            :aria-expanded="logOpen"
            aria-controls="player-accounts-log"
            @click="logOpen = !logOpen"
          >
            <span class="field-label" style="margin-bottom:0">
              Recent changes<template v-if="visibleLog.length"> · {{ visibleLog.length }}</template>
            </span>
            <span class="accounts-chevron" aria-hidden="true">{{ logOpen ? '▾' : '▸' }}</span>
          </button>
          <span v-if="logOpen" class="acct-toolbar-btns">
            <button v-if="visibleLog.length && !showCleared" class="btn btn-ghost btn-sm" type="button" @click="clearLog">Clear</button>
            <button v-if="hiddenLogCount" class="btn btn-ghost btn-sm" type="button" @click="showCleared = !showCleared">
              {{ showCleared ? 'Hide cleared' : `Show cleared (${hiddenLogCount})` }}
            </button>
          </span>
        </div>

        <div v-if="logOpen" id="player-accounts-log" style="margin-top:0.5rem">
          <p v-if="logError" class="muted" style="font-size:0.78rem">{{ logError }}</p>
          <p v-else-if="!log.length" class="muted" style="font-size:0.8rem">Nothing yet. Resets and email changes show up here.</p>
          <p v-else-if="!shownLog.length" class="muted" style="font-size:0.8rem">Nothing new since you cleared this.</p>
          <ul v-else class="acct-log-list">
            <li v-for="e in shownLog" :key="e.id">
              <span>{{ logText(e) }}</span>
              <span class="muted acct-log-when">{{ timeAgo(e.created_at) }}</span>
            </li>
          </ul>
          <p v-if="log.length" class="muted" style="font-size:0.72rem;margin-top:0.6rem">
            Shows the latest 10 changes, however old. Clear only hides them in this browser; the full record stays in the database.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onBeforeUnmount, watch } from 'vue'
import { usePlayersStore } from '@/stores/players'
import { useLeagueStore } from '@/stores/leagues'
import { useAuth } from '@/composables/useAuth'
import type { AccountInfo, AccountLogEntry, AccountStatus } from '@/types'

const playersStore = usePlayersStore()
const leagueStore = useLeagueStore()
const { user } = useAuth()

const RESET_COOLDOWN_S = 60 // matches Supabase's per-address limit on recovery emails

const open = ref(false)
const showActive = ref(false) // active players are hidden by default; the list is for people who still need something
const logOpen = ref(false)
const showCleared = ref(false)
const LOG_CLEARED_KEY = 'rally.accountLogClearedAt'
const loaded = ref(false)
const loading = ref(false)
const loadError = ref('')
const accounts = ref<Record<string, AccountInfo>>({})
const log = ref<AccountLogEntry[]>([])
const logError = ref('')

const error = ref('')
const notice = ref('')
const busy = ref(false)
const resettingId = ref<string | null>(null)

// One open action at a time across the whole panel.
const act = reactive<{ id: string | null; mode: 'invite' | 'remove' | 'email' | null; step: 'form' | 'confirm' }>({
  id: null, mode: null, step: 'form',
})
const inviteEmail = ref('')
const newEmail = ref('')
const confirmEmail = ref('')

// Reset cooldown: profile id -> epoch ms when the reset was sent.
const sentAt = ref<Record<string, number>>({})
const now = ref(Date.now())
const ticker = setInterval(() => { now.value = Date.now() }, 1000)
onBeforeUnmount(() => clearInterval(ticker))

function cooldownLeft(id: string) {
  const t = sentAt.value[id]
  if (!t) return 0
  // `now` only ticks once a second, so right after a send it can lag behind
  // `t`; clamp so the countdown never reads above the cooldown itself.
  return Math.min(RESET_COOLDOWN_S, Math.max(0, RESET_COOLDOWN_S - Math.floor((now.value - t) / 1000)))
}

interface Row {
  profile_id: string
  name: string
  status: AccountStatus
  maskedEmail: string | null
  lastSignIn: string | null
  invitedAt: string | null
  isMe: boolean
  isAdmin: boolean
}

// Before the server answers, placeholders can already be classified from
// the profile data the store has; everyone else waits for the lookup.
const rows = computed<Row[]>(() => {
  const order: Record<AccountStatus, number> = { name_only: 0, invited: 1, unconfirmed: 2, unknown: 3, active: 4 }
  return playersStore.players
    .map((p): Row => {
      const info = accounts.value[p.profile_id]
      const prof: any = p.profile
      const guess: AccountStatus = prof?.is_placeholder
        ? (prof?.invited_email ? 'invited' : 'name_only')
        : 'unknown'
      return {
        profile_id: p.profile_id,
        name: prof?.display_name || prof?.username || 'Unknown',
        status: info?.status ?? guess,
        maskedEmail: info?.masked_email ?? null,
        lastSignIn: info?.last_sign_in_at ?? null,
        invitedAt: prof?.invited_at ?? null,
        isMe: p.profile_id === user.value?.id,
        isAdmin: info?.is_admin ?? !!prof?.is_admin,
      }
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
})

// Active players are the long, settled part of the list, so they start
// hidden. Until the first lookup finishes, non-placeholder players are
// still 'unknown'; keep them out of view rather than flash them as
// needing attention.
const visibleRows = computed(() => {
  if (showActive.value) return rows.value
  return rows.value.filter(r =>
    r.status !== 'active' && !(r.status === 'unknown' && loading.value && !loaded.value)
  )
})

const activeCount = computed(() => rows.value.filter(r => r.status === 'active').length)

function toggleActive() {
  showActive.value = !showActive.value
  closeAction() // an open form on a row that is about to disappear would be orphaned
}

// "Clear" hides log entries up to the newest one, in this browser only.
// It compares against the server's own timestamp (not the browser clock),
// and the rows themselves stay in the database: the audit log is
// deliberately not editable.
function readClearedAt(): string | null {
  try { return localStorage.getItem(LOG_CLEARED_KEY) } catch { return null }
}
const clearedAt = ref<string | null>(readClearedAt())

const isNewerThanClear = (e: AccountLogEntry) =>
  !clearedAt.value || new Date(e.created_at).getTime() > new Date(clearedAt.value).getTime()
const visibleLog = computed(() => log.value.filter(isNewerThanClear))
const hiddenLogCount = computed(() => log.value.length - visibleLog.value.length)
const shownLog = computed(() => (showCleared.value ? log.value : visibleLog.value))

function clearLog() {
  if (!log.value.length) return
  clearedAt.value = log.value[0].created_at // newest first
  showCleared.value = false
  try { localStorage.setItem(LOG_CLEARED_KEY, clearedAt.value) } catch { /* private mode: clears for this visit only */ }
}

const waitingCount = computed(() =>
  playersStore.players.filter(p => (p.profile as any)?.is_placeholder).length
)

const counts = computed(() => {
  if (!loaded.value) return ''
  const n = (s: AccountStatus) => rows.value.filter(r => r.status === s).length
  return [
    n('active') && `${n('active')} active`,
    n('invited') && `${n('invited')} invited`,
    n('unconfirmed') && `${n('unconfirmed')} unconfirmed`,
    n('name_only') && `${n('name_only')} name only`,
  ].filter(Boolean).join(' · ')
})

function statusLabel(s: AccountStatus) {
  return ({
    name_only: 'Name only',
    invited: 'Invited, waiting',
    unconfirmed: 'Email not confirmed',
    active: 'Active',
    unknown: '…',
  } as const)[s]
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 60) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function signInText(iso: string | null, never: string) {
  return iso ? `Last sign-in ${timeAgo(iso)}` : never
}

function logText(e: AccountLogEntry) {
  const who = e.actor_name || 'An admin'
  const target = e.target_name || 'a deleted player'
  if (e.action === 'send_reset') {
    return `${who} sent a password reset to ${target}${e.detail.email_masked ? ` (${e.detail.email_masked})` : ''}`
  }
  const from = e.detail.old_email_masked || 'no email'
  const to = e.detail.new_email_masked || 'a new address'
  return `${who} changed ${target}'s email from ${from} to ${to}`
    + (e.detail.reset_sent === false ? ' (reset email did not send)' : '')
}

// ── Loading ────────────────────────────────────────────────────────────
async function loadAccounts() {
  const leagueId = leagueStore.currentLeagueId
  loadError.value = ''
  if (!leagueId) { accounts.value = {}; return }
  loading.value = true
  try {
    const list = await playersStore.fetchAccountInfo(leagueId)
    accounts.value = Object.fromEntries(list.map(a => [a.profile_id, a]))
    loaded.value = true
  } catch (e: any) {
    loadError.value = `Couldn't load account details: ${e.message}`
  }
  loading.value = false
}

async function loadLog() {
  logError.value = ''
  try {
    log.value = await playersStore.fetchAccountLog(10)
  } catch (e: any) {
    // Most likely the v0.0.5.9 migration hasn't been run yet.
    logError.value = `Couldn't load the change log: ${e.message}`
  }
}

async function reload() {
  await Promise.all([loadAccounts(), loadLog()])
}

async function toggle() {
  open.value = !open.value
  if (open.value && !loaded.value) await reload()
}

// A different league means different players: drop everything cached.
watch(() => leagueStore.currentLeagueId, async () => {
  accounts.value = {}
  loaded.value = false
  closeAction()
  error.value = ''
  notice.value = ''
  if (open.value) await reload()
})

// ── Actions ────────────────────────────────────────────────────────────
function clearMessages() { error.value = ''; notice.value = '' }

function openAction(r: Row, mode: 'invite' | 'remove' | 'email') {
  clearMessages()
  act.id = r.profile_id
  act.mode = mode
  act.step = 'form'
  inviteEmail.value = ''
  newEmail.value = ''
  confirmEmail.value = ''
}

function closeAction() {
  act.id = null
  act.mode = null
  act.step = 'form'
  inviteEmail.value = ''
  newEmail.value = ''
  confirmEmail.value = ''
}

const newEmailClean = computed(() => newEmail.value.trim().toLowerCase())
const confirmEmailClean = computed(() => confirmEmail.value.trim().toLowerCase())
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

const emailFormValid = computed(() =>
  looksLikeEmail(newEmailClean.value) && newEmailClean.value === confirmEmailClean.value
)
const emailFormHint = computed(() => {
  if (!newEmail.value && !confirmEmail.value) return ''
  if (!looksLikeEmail(newEmailClean.value)) return 'Enter a full email address.'
  if (confirmEmail.value && newEmailClean.value !== confirmEmailClean.value) return "The two addresses don't match yet."
  if (!confirmEmail.value) return 'Type it a second time to confirm.'
  return ''
})

async function sendReset(r: Row) {
  clearMessages()
  resettingId.value = r.profile_id
  try {
    const res = await playersStore.sendPasswordReset(r.profile_id)
    sentAt.value = { ...sentAt.value, [r.profile_id]: Date.now() }
    notice.value = `Password reset sent to ${r.name}${res.masked_email ? ` (${res.masked_email})` : ''}.`
    await loadLog()
  } catch (e: any) {
    error.value = e.message
  }
  resettingId.value = null
}

async function submitInvite(r: Row) {
  const email = inviteEmail.value.trim()
  if (!email) return
  clearMessages()
  busy.value = true
  try {
    await playersStore.claimPlaceholderPlayer(r.profile_id, email)
    notice.value = `Invite sent to ${r.name}. They'll get a link to set a password.`
    closeAction()
    await loadAccounts()
  } catch (e: any) {
    error.value = e.message
  }
  busy.value = false
}

async function submitRemove(r: Row) {
  clearMessages()
  busy.value = true
  try {
    await playersStore.deletePlaceholderPlayer(r.profile_id)
    notice.value = `${r.name} was removed.`
    closeAction()
    await loadAccounts()
  } catch (e: any) {
    error.value = e.message
  }
  busy.value = false
}

async function submitEmail(r: Row) {
  if (!emailFormValid.value) return
  clearMessages()
  busy.value = true
  try {
    const res = await playersStore.changePlayerEmail(r.profile_id, newEmailClean.value, confirmEmailClean.value)
    if (res.reset_sent) {
      sentAt.value = { ...sentAt.value, [r.profile_id]: Date.now() }
      notice.value = `${r.name}'s email is now ${res.masked_email}. A reset link was sent there.`
    } else {
      notice.value = `${r.name}'s email is now ${res.masked_email}, but the reset email didn't send`
        + `${res.reset_error ? ` (${res.reset_error})` : ''}. Use Send password reset in a minute.`
    }
    closeAction()
    await Promise.all([loadAccounts(), loadLog()])
  } catch (e: any) {
    error.value = e.message
  }
  busy.value = false
}
</script>

<style scoped>
.accounts-head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  width: 100%; background: none; border: none; padding: 0; text-align: left;
  color: inherit; font: inherit; cursor: pointer;
}
.accounts-chevron { color: var(--txt-muted); font-size: 0.9rem; }
.accounts-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  flex-wrap: wrap; margin-bottom: 0.5rem; min-height: 1.9rem;
}
.acct-toolbar-btns { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-left: auto; }
.acct-log-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
.acct-log-toggle {
  display: flex; align-items: center; gap: 0.5rem; background: none; border: none; padding: 0;
  color: inherit; font: inherit; cursor: pointer; text-align: left;
}
.acct-row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;
  flex-wrap: wrap; padding: 0.6rem 0; border-top: 1px solid var(--line);
}
.acct-main { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 0.2rem; }
.acct-name-line { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.acct-name { font-size: 0.88rem; font-weight: 500; }
.acct-tag {
  font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--txt-muted); border: 1px solid var(--line); border-radius: 999px; padding: 0.05rem 0.4rem;
}
.acct-status { font-size: 0.7rem; border-radius: 999px; padding: 0.1rem 0.5rem; border: 1px solid var(--line); color: var(--txt-secondary); }
.acct-status-active { color: #6fcfab; border-color: rgba(76,175,138,0.35); }
.acct-status-invited { color: var(--sky); border-color: rgba(96,165,250,0.35); }
.acct-status-unconfirmed { color: #f0d260; border-color: rgba(240,210,96,0.35); }
.acct-status-name_only { color: var(--txt-muted); }
.acct-meta { font-size: 0.74rem; }
.acct-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
.acct-form { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.4rem; }
.acct-form .input { flex: 1; min-width: 160px; padding: 0.4rem 0.6rem; font-size: 0.85rem; }
.acct-form-col { flex-direction: column; align-items: stretch; }
.acct-form-col .input { flex: none; }
.acct-form-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.acct-confirm { font-size: 0.82rem; line-height: 1.45; margin: 0; word-break: break-word; }
.acct-log { margin-top: 1.1rem; padding-top: 0.9rem; border-top: 1px solid var(--line); }
.acct-log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.acct-log-list li { display: flex; justify-content: space-between; gap: 0.75rem; font-size: 0.78rem; flex-wrap: wrap; }
.acct-log-when { white-space: nowrap; }
</style>
