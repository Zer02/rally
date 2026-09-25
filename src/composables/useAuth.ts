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
  //
  // This is also the ONE place profiles.is_placeholder gets cleared
  // (v0.0.4.5) — not when an admin sends the invite, but only once the
  // person has actually finished setting a password. A self-update
  // (auth.uid() = id) is allowed by the same "Users update own profile"
  // RLS policy every other profile edit already goes through. Harmless
  // no-op for a normal (non-placeholder) account completing signup.
  async function updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return error

    isPasswordRecovery.value = false
    if (user.value && (profile.value as any)?.is_placeholder) {
      await supabase.from('profiles').update({ is_placeholder: false }).eq('id', user.value.id)
      await loadProfile(user.value.id)
    }
    return null
  }

  // Updates the signed-in user's own display name / unit, then refreshes
  // the cached profile so every component reading it (nav, this page,
  // etc.) picks up the change without a manual reload. Same
  // "Users update own profile" RLS policy as updatePassword() above.
  async function updateProfile(fields: { display_name?: string; unit?: string | null }) {
    if (!user.value) return new Error('Not signed in')
    const { error } = await supabase.from('profiles').update(fields).eq('id', user.value.id)
    if (error) return error
    await loadProfile(user.value.id)
    return null
  }

  return {
    user, profile, loading, isAuthed, isAdmin, isPasswordRecovery,
    signUp, signIn, signOut, updatePassword, updateProfile,
  }
}
