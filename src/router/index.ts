// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const routes = [
  { path: "/", name: "home", component: () => import("@/views/HomeView.vue") },
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/LoginView.vue"),
  },
  {
    path: "/leaderboard",
    name: "leaderboard",
    component: () => import("@/views/LeaderboardView.vue"),
  },
  {
    path: "/matches",
    name: "matches",
    component: () => import("@/views/MatchesView.vue"),
  },
  {
    path: "/profile",
    name: "profile",
    component: () => import("@/views/ProfileView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/player/:id",
    name: "player",
    component: () => import("@/views/PlayerView.vue"),
  },
  {
    path: "/challenge",
    name: "challenge",
    component: () => import("@/views/ChallengeView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/referee",
    name: "referee",
    component: () => import("@/views/RefereeView.vue"),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/tournament",
    name: "tournament",
    component: () => import("@/views/TournamentView.vue"),
    meta: { requiresAuth: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  // v0.0.4.6: whatever Supabase's dashboard-configured Site URL points
  // a recovery link at, force the set-password screen. Without this, a
  // misconfigured (or just different) Site URL lands the person on
  // whatever page that is, fully authenticated, with the flag set but
  // nothing on that page reacting to it — LoginView is the only place
  // that knows to show the set-password form. Runs before the
  // requiresAuth check below so it applies to every route, /login
  // included (checked first to avoid a redirect loop there).
  const { isPasswordRecovery } = useAuth()
  if (isPasswordRecovery.value && to.name !== 'login') {
    return { name: 'login' }
  }

  if (!to.meta.requiresAuth) return true

  const { isAuthed, isAdmin, loading } = useAuth()

  // Wait for auth to resolve on first load
  if (loading.value) {
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (!loading.value) { clearInterval(interval); resolve() }
      }, 50)
    })
  }

  if (!isAuthed.value) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.requiresAdmin && !isAdmin.value) return { name: 'home' }
  return true
})

export default router
