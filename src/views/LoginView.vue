<!-- src/views/LoginView.vue — v0.0.5.8 -->
<template>
  <main class="page">
    <div class="container">
      <div class="auth-wrap">
        <RouterLink to="/" class="nav-logo" style="display:block;margin-bottom:2rem;font-family:var(--font-display);color:var(--ball);font-size:1.3rem">RALLY {{ sport.emoji }}</RouterLink>

        <div class="card auth-card">
          <div v-if="!showSetPassword && (mode === 'login' || mode === 'signup')" class="auth-tabs">
            <button class="auth-tab" :class="{ active: mode === 'login' }"  @click="switchMode('login')">Sign in</button>
            <button class="auth-tab" :class="{ active: mode === 'signup' }" @click="switchMode('signup')">Join the league</button>
          </div>

          <div class="auth-body">
            <div v-if="flash" class="flash" :class="`flash-${flashType}`" role="status">{{ flash }}</div>

            <!-- ── Set / reset password: landed here from an emailed link ── -->
            <template v-if="showSetPassword">
              <div v-if="passwordSaved" class="auth-done">
                <p class="auth-done-title">Password saved</p>
                <p class="muted" style="font-size:0.85rem;margin-bottom:1.25rem">
                  You're signed in. Next time, use your email and this password.
                </p>
                <button type="button" class="btn btn-primary" style="width:100%;justify-content:center" @click="router.push('/leaderboard')">
                  Continue to the league
                </button>
              </div>

              <form v-else @submit.prevent="handleSetPassword">
                <h3 class="auth-title">{{ isInvited ? 'Welcome! Set your password' : 'Choose a new password' }}</h3>
                <p class="muted" style="font-size:0.85rem;margin-bottom:1rem">
                  {{ isInvited
                    ? "This finishes setting up your account. You'll use it to sign in from now on."
                    : "You'll be signed in as soon as it's saved." }}
                </p>

                <NewPasswordFields v-model:password="newPassword" v-model:confirm="confirmPassword" />

                <button type="submit" class="btn btn-primary" style="width:100%;margin-top:1.25rem;justify-content:center" :disabled="busy || !canSubmitNew">
                  <span v-if="busy" class="spinner" />
                  <span v-else>Save password</span>
                </button>
                <p class="auth-alt">
                  <button type="button" class="auth-link" @click="handleAbandonRecovery">Not you? Sign out</button>
                </p>
              </form>
            </template>

            <!-- ── Forgot password ── -->
            <form v-else-if="mode === 'forgot'" @submit.prevent="handleForgot">
              <h3 class="auth-title">Reset your password</h3>
              <p class="muted" style="font-size:0.85rem;margin-bottom:1rem">
                Enter the email you signed up with and we'll send you a link to choose a new password.
              </p>

              <label class="field-label" for="forgot-email">Email</label>
              <input id="forgot-email" ref="forgotEmailEl" v-model="email" name="email" type="email" class="input" placeholder="you@email.com" autocomplete="email" required />

              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:1.25rem;justify-content:center" :disabled="busy || cooldown > 0">
                <span v-if="busy" class="spinner" />
                <span v-else-if="cooldown > 0">Send again in {{ cooldown }}s</span>
                <span v-else>{{ resetSent ? 'Send the link again' : 'Send reset link' }}</span>
              </button>
              <p class="auth-alt">
                <button type="button" class="auth-link" @click="switchMode('login')">← Back to sign in</button>
              </p>
            </form>

            <!-- ── Sign in ── -->
            <form v-else-if="mode === 'login'" @submit.prevent="handleLogin">
              <label class="field-label" for="login-email">Email</label>
              <input id="login-email" v-model="email" name="email" type="email" class="input" placeholder="you@email.com" autocomplete="email" required />

              <div class="auth-label-row">
                <label class="field-label" for="login-password" style="margin:0">Password</label>
                <button type="button" class="auth-link" @click="switchMode('forgot')">Forgot password?</button>
              </div>
              <PasswordInput id="login-password" v-model="password" name="password" autocomplete="current-password" placeholder="Your password" />

              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:1.25rem;justify-content:center" :disabled="busy">
                <span v-if="busy" class="spinner" />
                <span v-else>Sign in</span>
              </button>

              <p v-if="loginFailed" class="auth-alt">
                <button type="button" class="auth-link" @click="switchMode('forgot')">Reset your password</button>
              </p>
              <p v-if="needsConfirm" class="auth-alt">
                <button type="button" class="auth-link" :disabled="busy" @click="handleResendConfirm">Resend the confirmation email</button>
              </p>
            </form>

            <!-- ── Join ── -->
            <form v-else @submit.prevent="handleSignup">
              <label class="field-label" for="signup-name">Name</label>
              <input id="signup-name" v-model="displayName" name="name" type="text" class="input" placeholder="Alex K." autocomplete="name" required />

              <label class="field-label" style="margin-top:0.875rem" for="signup-email">Email</label>
              <input id="signup-email" v-model="email" name="email" type="email" class="input" placeholder="you@email.com" autocomplete="email" required />

              <label class="field-label" style="margin-top:0.875rem" for="signup-password">Password</label>
              <PasswordInput id="signup-password" v-model="password" name="password" autocomplete="new-password" :placeholder="`At least ${PASSWORD_MIN} characters`" :minlength="PASSWORD_MIN" />

              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:1.25rem;justify-content:center" :disabled="busy">
                <span v-if="busy" class="spinner" />
                <span v-else>Create account</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useSport } from '@/composables/useSport'
import PasswordInput from '@/components/auth/PasswordInput.vue'
import NewPasswordFields from '@/components/auth/NewPasswordFields.vue'
import { PASSWORD_MIN, friendlyAuthError, passwordIsValid } from '@/lib/authMessages'

const {
  signIn, signUp, signOut, updatePassword, requestPasswordReset, resendConfirmation,
  isPasswordRecovery, linkError, profile,
} = useAuth()
const { sport } = useSport()
const router = useRouter()
const route  = useRoute()

type Mode = 'login' | 'signup' | 'forgot'
const mode        = ref<Mode>('login')
const email       = ref('')
const password    = ref('')
const displayName = ref('')
const newPassword     = ref('')
const confirmPassword = ref('')
const busy        = ref(false)
const flash       = ref('')
const flashType   = ref<'error' | 'success'>('error')
const loginFailed  = ref(false)   // wrong email/password → offer the reset link
const needsConfirm = ref(false)   // signed up but never clicked the confirmation email
const resetSent    = ref(false)
const passwordSaved = ref(false)
const forgotEmailEl = ref<HTMLInputElement | null>(null)

// An invited player (added by name, then given an email by an admin) is still
// flagged as a placeholder until they finish this form.
const isInvited = computed(() => !!(profile.value as any)?.is_placeholder)
// Stays true after saving: updatePassword() clears the recovery flag, and the
// "Password saved" screen must not vanish into the sign-in form when it does.
const showSetPassword = computed(() => isPasswordRecovery.value || passwordSaved.value)
const canSubmitNew = computed(() => passwordIsValid(newPassword.value, confirmPassword.value))

function setFlash(msg: string, type: 'error' | 'success' = 'error') {
  flash.value = msg; flashType.value = type
}
function clearMessages() {
  flash.value = ''; loginFailed.value = false; needsConfirm.value = false
}

async function switchMode(next: Mode) {
  clearMessages()
  resetSent.value = false
  mode.value = next        // the email typed on one form carries over to the next
  if (next === 'forgot') { await nextTick(); forgotEmailEl.value?.focus() }
}

// Resend cooldown, so a nervous double-tap doesn't burn through Supabase's
// per-hour email limit.
const cooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null
function startCooldown(seconds = 60) {
  cooldown.value = seconds
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0 && cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null }
  }, 1000)
}
onBeforeUnmount(() => { if (cooldownTimer) clearInterval(cooldownTimer) })

onMounted(async () => {
  // Arrived from an expired or already-used link: say so, and go straight to
  // the form that fixes it.
  if (linkError.value) {
    const msg = linkError.value
    linkError.value = null
    await switchMode('forgot')
    setFlash(msg)
  }
})

async function handleLogin() {
  busy.value = true; clearMessages()
  const err = await signIn(email.value.trim(), password.value)
  busy.value = false
  if (err) {
    setFlash(friendlyAuthError(err.message))
    loginFailed.value  = err.message.toLowerCase().includes('invalid login credentials')
    needsConfirm.value = err.message.toLowerCase().includes('email not confirmed')
    return
  }
  const redirect = route.query.redirect as string || '/leaderboard'
  router.push(redirect)
}

async function handleSignup() {
  busy.value = true; clearMessages()
  const err = await signUp(email.value.trim(), password.value, displayName.value)
  busy.value = false
  if (err) { setFlash(friendlyAuthError(err.message)); return }
  setFlash('Account created! Check your email to confirm, then sign in.', 'success')
}

async function handleForgot() {
  busy.value = true; clearMessages()
  const err = await requestPasswordReset(email.value)
  busy.value = false
  if (err) {
    setFlash(friendlyAuthError(err.message))
    if (/rate limit|too many/i.test(err.message)) startCooldown()
    return
  }
  resetSent.value = true
  startCooldown()
  // Same wording whether or not the address has an account.
  setFlash("If there's an account for that email, a reset link is on its way. Check your inbox (and spam).", 'success')
}

async function handleResendConfirm() {
  busy.value = true
  const err = await resendConfirmation(email.value)
  busy.value = false
  needsConfirm.value = false
  if (err) setFlash(friendlyAuthError(err.message))
  else setFlash('Confirmation email sent. Check your inbox.', 'success')
}

async function handleSetPassword() {
  if (!canSubmitNew.value) return
  busy.value = true; clearMessages()
  const err = await updatePassword(newPassword.value)
  busy.value = false
  if (err) { setFlash(friendlyAuthError(err.message)); return }
  newPassword.value = ''; confirmPassword.value = ''
  passwordSaved.value = true
}

// Someone opened a reset link on a shared device, or the wrong account: let
// them leave without setting anything.
async function handleAbandonRecovery() {
  await signOut()
  clearMessages()
  mode.value = 'login'
}
</script>

<style scoped>
.auth-wrap  { max-width: 400px; margin: 5rem auto; }
.auth-card  { overflow: hidden; }
.auth-tabs  { display: flex; border-bottom: 1px solid var(--line); }
.auth-tab   { flex: 1; padding: 0.9rem; background: none; border: none; color: var(--txt-muted); font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: all 0.15s; }
.auth-tab:hover  { color: var(--txt-secondary); }
.auth-tab.active { color: var(--txt-primary); box-shadow: 0 -2px 0 var(--ball) inset; }
.auth-body  { padding: 1.5rem; }
.auth-title { font-family: var(--font-display); font-size: 1.35rem; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--txt-primary); line-height: 1.25; margin-bottom: 0.5rem; }
.auth-label-row { display: flex; align-items: baseline; justify-content: space-between; margin: 1rem 0 0.35rem; }
.auth-link  { background: none; border: none; padding: 0; cursor: pointer; font-family: var(--font-body); font-size: 0.8rem; color: var(--ball); }
.auth-link:hover:not(:disabled) { text-decoration: underline; }
.auth-link:disabled { opacity: 0.5; cursor: default; }
.auth-alt   { text-align: center; margin-top: 1rem; }
.auth-done  { text-align: center; padding: 0.5rem 0; }
.auth-done-title { font-family: var(--font-display); font-size: 1.3rem; margin-bottom: 0.4rem; color: var(--net); }
@media (max-width: 600px) { .auth-wrap { margin: 2.5rem auto; } }
</style>
