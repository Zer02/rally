// src/composables/useAuth.ts — v0.0.5.8
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/types'
import { readAuthLinkError } from '@/lib/authMessages'

const user    = ref<User | null>(null)
const profile = ref<Profile | null>(null)
const loading = ref(true)
// Set when Supabase lands the user back here from a password-recovery
// link (both the original "confirm your account" signup flow and the
// "set your password" flow claim-placeholder-player kicks off use the
// same PASSWORD_RECOVERY auth event — LoginView watches this to swap in
// the set-password form instead of the normal login form).
//
// v0.0.5.8: remembered per browser tab. A recovery link signs the person in
// before they've chosen a password; if the page is reloaded (or the phone
// reloads the tab) mid-flow, the auth event never fires again and they'd
// land in the app signed in with no password set and no way back to the form.
const RECOVERY_KEY = 'rally.passwordRecovery'
const isPasswordRecovery = ref(sessionStorage.getItem(RECOVERY_KEY) === '1')
function setRecovery(on: boolean) {
  isPasswordRecovery.value = on
  if (on) sessionStorage.setItem(RECOVERY_KEY, '1')
  else sessionStorage.removeItem(RECOVERY_KEY)
}

// v0.0.5.8: set when the person arrives from an emailed link that's expired or
// already used. Read once here, at startup, from wherever they landed; the
// router sends them to /login and LoginView shows it, then clears it.
const linkError = ref<string | null>(readAuthLinkError())

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
  else setRecovery(false)   // a remembered recovery flag is meaningless without a session
  loading.value = false
})

supabase.auth.onAuthStateChange(async (event, session) => {
  user.value = session?.user ?? null
  if (user.value) await loadProfile(user.value.id)
  else profile.value = null
  if (event === 'PASSWORD_RECOVERY') setRecovery(true)
  if (event === 'SIGNED_OUT') setRecovery(false)
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
    setRecovery(false)
  }

  // Emails a password-reset link. Supabase answers the same way whether or
  // not the address has an account (so the form can't be used to find out who
  // has one); the caller shows the same "if there's an account" message either
  // way. `redirectTo` must be allow-listed in the Supabase dashboard, the
  // same requirement as the invite email.
  async function requestPasswordReset(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login`,
    })
    return error
  }

  // Sends the signup confirmation email again (for "Email not confirmed").
  async function resendConfirmation(email: string) {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/login` },
    })
    return error
  }

  // Changes the password of the signed-in user. With `current` set, it's
  // checked first by signing in with it, so a phone left unlocked can't be
  // used to quietly change the password. Pass null when there is no current
  // password to check (an invited player who hasn't set one yet).
  async function changePassword(current: string | null, next: string) {
    if (current !== null) {
      const email = user.value?.email
      if (!email) return new Error('Not signed in')
      const { error } = await supabase.auth.signInWithPassword({ email, password: current })
      if (error) return new Error('Your current password is incorrect.')
    }
    return updatePassword(next)
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

    setRecovery(false)
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
    user, profile, loading, isAuthed, isAdmin, isPasswordRecovery, linkError,
    signUp, signIn, signOut, updatePassword, updateProfile,
    requestPasswordReset, resendConfirmation, changePassword,
  }
}
