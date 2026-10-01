<!--
  PasswordInput — v0.0.5.8. A password field with a Show / Hide toggle and the
  right `autocomplete` value, so password managers and phone keyboards know
  whether they're being asked to fill an existing password or suggest a new one.
    current-password → signing in / confirming the old password
    new-password     → creating or changing a password
-->
<template>
  <div class="pw">
    <input
      :id="id"
      :name="name"
      :type="shown ? 'text' : 'password'"
      class="input pw-input"
      :value="modelValue"
      :autocomplete="autocomplete"
      :placeholder="placeholder"
      :minlength="minlength"
      :required="required"
      autocapitalize="none"
      autocorrect="off"
      spellcheck="false"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button
      type="button"
      class="pw-toggle"
      :aria-label="shown ? 'Hide password' : 'Show password'"
      :aria-pressed="shown"
      @click="shown = !shown"
    >{{ shown ? 'Hide' : 'Show' }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{
  modelValue:    string
  autocomplete?: 'current-password' | 'new-password'
  placeholder?:  string
  id?:           string
  name?:         string
  minlength?:    number
  required?:     boolean
}>(), {
  autocomplete: 'current-password',
  placeholder:  '',
  required:     true,
})

defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const shown = ref(false)
</script>

<style scoped>
.pw { position: relative; }
.pw-input { padding-right: 4.25rem; }
.pw-toggle {
  position: absolute; top: 50%; right: 0.4rem; transform: translateY(-50%);
  background: none; border: none; cursor: pointer;
  color: var(--txt-muted); font-family: var(--font-body); font-size: 0.78rem; font-weight: 500;
  padding: 0.35rem 0.5rem; border-radius: var(--radius-sm);
}
.pw-toggle:hover { color: var(--txt-primary); }
</style>
