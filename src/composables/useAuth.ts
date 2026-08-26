// src/composables/useAuth.ts — v0.0.3
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/types'

const user    = ref<User | null>(null)
const profile = ref<Profile | null>(null)
const loading = ref(true)

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

supabase.auth.onAuthStateChange(async (_event, session) => {
  user.value = session?.user ?? null
  if (user.value) await loadProfile(user.value.id)
  else profile.value = null
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

  return { user, profile, loading, isAuthed, isAdmin, signUp, signIn, signOut }
}
