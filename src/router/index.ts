// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const routes = [
  { path: '/',           name: 'home',        component: () => import('@/views/HomeView.vue') },
  { path: '/login',      name: 'login',       component: () => import('@/views/LoginView.vue') },
  { path: '/leaderboard',name: 'leaderboard', component: () => import('@/views/LeaderboardView.vue') },
  { path: '/matches',    name: 'matches',     component: () => import('@/views/MatchesView.vue') },
  { path: '/profile',    name: 'profile',     component: () => import('@/views/ProfileView.vue'),   meta: { requiresAuth: true } },
  { path: '/player/:id', name: 'player',      component: () => import('@/views/PlayerView.vue') },
  { path: '/challenge',  name: 'challenge',   component: () => import('@/views/ChallengeView.vue'), meta: { requiresAuth: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true

  const { isAuthed, loading } = useAuth()

  // Wait for auth to resolve on first load
  if (loading.value) {
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (!loading.value) { clearInterval(interval); resolve() }
      }, 50)
    })
  }

  if (!isAuthed.value) return { name: 'login', query: { redirect: to.fullPath } }
  return true
})

export default router
