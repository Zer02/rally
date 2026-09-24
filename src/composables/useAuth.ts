// src/composables/useAuth.ts — v0.0.3
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/types'

const user    = ref<User | null>(null)
const profile = ref<Profile | null>(null)
const loading = ref(true)
// Set when Supabase lands the user back here from a password-recovery
// link (both the original "confirm your account" signup flow and the
// "set your password" flow claim-placeholder-player kicks off use the
// same PASSWORD_RECOVERY auth event — LoginView watches this to swap in
// the set-password form instead of the normal login form).
const isPasswordRecovery = ref(false)

async function loadProfile(userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  profile.value = data as Profile | null
}

supabase.auth.getSession().then(async ({ data }) => {
  user.value = data.session?.user ?? null
  if (user.value) await loadProfile(user.value.id)
  loading.value = false
})

supabase.auth.onAuthStateChange(async (event, session) => {
  user.value = session?.user ?? null
  if (user.value) await loadProfile(user.value.id)
  else profile.value = null
  if (event === 'PASSWORD_RECOVERY') isPasswordRecovery.value = true
})

export function useAuth() {
  const isAuthed  = computed(() => !!user.value)
  const isAdmin   = computed(() => !!(profile.value as any)?.is_admin)

  async function signUp(email: string, password: string, displayName: string, unit: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, unit } },
    })
    return error
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error
  }

  async function signOut() {
    await supabase.auth.signOut()
    profile.value = null
  }

  // Completes a password-recovery flow (used both by the original
  // signup confirmation link and by a claimed placeholder player's
  // "set your password" link) — sets the new password and clears the
  // recovery flag so the UI falls back to normal signed-in behavior.
  async function updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (!error) isPasswordRecovery.value = false
    return error
  }

  return {
    user, profile, loading, isAuthed, isAdmin, isPasswordRecovery,
    signUp, signIn, signOut, updatePassword,
  }
}
