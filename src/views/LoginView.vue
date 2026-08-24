<template>
  <main class="page">
    <div class="container">
      <div class="auth-wrap">
        <RouterLink to="/" class="nav-logo" style="display:block;margin-bottom:2rem;font-family:var(--font-display);color:var(--ball);font-size:1.3rem">RALLY 🏓</RouterLink>

        <div class="card auth-card">
          <div class="auth-tabs">
            <button class="auth-tab" :class="{ active: tab === 'login' }"  @click="tab = 'login'">Sign in</button>
            <button class="auth-tab" :class="{ active: tab === 'signup' }" @click="tab = 'signup'">Join the league</button>
          </div>

          <div class="auth-body">
            <div v-if="flash" class="flash" :class="`flash-${flashType}`">{{ flash }}</div>

            <!-- Login -->
            <form v-if="tab === 'login'" @submit.prevent="handleLogin">
              <label class="field-label">Email</label>
              <input v-model="email" type="email" class="input" placeholder="you@email.com" required />

              <label class="field-label" style="margin-top:1rem">Password</label>
              <input v-model="password" type="password" class="input" placeholder="••••••••" required />

              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:1.25rem;justify-content:center" :disabled="loading">
                <span v-if="loading" class="spinner" />
                <span v-else>Sign in</span>
              </button>
            </form>

            <!-- Signup -->
            <form v-else @submit.prevent="handleSignup">
              <label class="field-label">Name</label>
              <input v-model="displayName" type="text" class="input" placeholder="Alex K." required />

              <label class="field-label" style="margin-top:0.875rem">Unit / apartment</label>
              <input v-model="unit" type="text" class="input" placeholder="4B" />

              <label class="field-label" style="margin-top:0.875rem">Email</label>
              <input v-model="email" type="email" class="input" placeholder="you@email.com" required />

              <label class="field-label" style="margin-top:0.875rem">Password</label>
              <input v-model="password" type="password" class="input" placeholder="At least 8 characters" minlength="8" required />

              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:1.25rem;justify-content:center" :disabled="loading">
                <span v-if="loading" class="spinner" />
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
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const { signIn, signUp } = useAuth()
const router = useRouter()
const route  = useRoute()

const tab         = ref<'login'|'signup'>('login')
const email       = ref('')
const password    = ref('')
const displayName = ref('')
const unit        = ref('')
const loading     = ref(false)
const flash       = ref('')
const flashType   = ref<'error'|'success'>('error')

function setFlash(msg: string, type: 'error'|'success' = 'error') {
  flash.value = msg; flashType.value = type
}

async function handleLogin() {
  loading.value = true; flash.value = ''
  const err = await signIn(email.value, password.value)
  loading.value = false
  if (err) { setFlash(err.message); return }
  const redirect = route.query.redirect as string || '/leaderboard'
  router.push(redirect)
}

async function handleSignup() {
  loading.value = true; flash.value = ''
  const err = await signUp(email.value, password.value, displayName.value, unit.value)
  loading.value = false
  if (err) { setFlash(err.message); return }
  setFlash('Account created! Check your email to confirm, then sign in.', 'success')
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
</style>
