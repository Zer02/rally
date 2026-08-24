<template>
  <span class="tier" :class="`tier-${tier.key}`">{{ tier.label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getTier } from '@/lib/rating'

const props = defineProps<{ rating: number }>()
const tier  = computed(() => getTier(props.rating))
</script>
