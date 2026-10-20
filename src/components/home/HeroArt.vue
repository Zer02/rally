<!-- HeroArt — v0.0.8.6. The home page's illustration, drawn in code: a city skyline at dusk, a map
     pin, and either a tennis court (court sports) or a ping pong table (table sports), with a ball.
     Colours come from the theme variables, so it follows the palette. Decorative only. -->
<template>
  <svg class="hero-art" viewBox="0 0 640 400" role="img" :aria-label="variant === 'table' ? 'A ping pong table' : 'A tennis court'" preserveAspectRatio="xMidYMid meet">
    <defs>
      <radialGradient id="ha-glow" cx="50%" cy="78%" r="60%">
        <stop offset="0" stop-color="#f2c94c" stop-opacity="0.12" />
        <stop offset="1" stop-color="#f2c94c" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="ha-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0c1524" stop-opacity="0" />
        <stop offset="1" stop-color="#16243b" stop-opacity="0.9" />
      </linearGradient>
      <linearGradient id="ha-surface" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0f1b2e" />
        <stop offset="1" stop-color="#0a1322" />
      </linearGradient>
      <radialGradient id="ha-ball" cx="35%" cy="32%" r="75%">
        <stop offset="0" stop-color="#fbe58a" />
        <stop offset="0.55" stop-color="#f2c94c" />
        <stop offset="1" stop-color="#b8901f" />
      </radialGradient>
      <pattern id="ha-mesh" width="7" height="7" patternUnits="userSpaceOnUse">
        <path d="M0 0H7M0 0V7" stroke="#dfe6f2" stroke-opacity="0.22" stroke-width="0.8" fill="none" />
      </pattern>
    </defs>

    <rect width="640" height="400" fill="url(#ha-glow)" />

    <!-- map lines and pin -->
    <g fill="none" stroke="#1d2a3f" stroke-width="1.2" opacity="0.9">
      <path d="M380 20 C 460 60, 520 40, 640 90" />
      <path d="M400 0 C 430 80, 520 120, 600 170" />
      <path d="M330 70 C 420 110, 470 150, 560 150" />
      <path d="M470 0 C 500 40, 580 30, 640 30" />
    </g>
    <g transform="translate(500 62)">
      <path d="M0 34 C-20 12 -20 -20 0 -20 C20 -20 20 12 0 34Z" fill="#f2c94c" />
      <circle cx="0" cy="-4" r="7" fill="#070d17" />
    </g>

    <!-- skyline -->
    <g fill="#0e1828">
      <rect x="40"  y="150" width="46" height="140" /><rect x="92"  y="110" width="38" height="180" />
      <rect x="136" y="170" width="50" height="120" /><rect x="192" y="90"  width="44" height="200" />
      <rect x="242" y="140" width="40" height="150" /><rect x="288" y="120" width="52" height="170" />
      <rect x="346" y="160" width="40" height="130" /><rect x="392" y="130" width="46" height="160" />
    </g>
    <g fill="#f2c94c" opacity="0.55">
      <rect x="100" y="132" width="5" height="7" /><rect x="112" y="150" width="5" height="7" /><rect x="100" y="172" width="5" height="7" />
      <rect x="200" y="112" width="5" height="7" /><rect x="214" y="134" width="5" height="7" /><rect x="200" y="160" width="5" height="7" /><rect x="214" y="190" width="5" height="7" />
      <rect x="296" y="142" width="5" height="7" /><rect x="312" y="166" width="5" height="7" />
      <rect x="400" y="152" width="5" height="7" /><rect x="416" y="176" width="5" height="7" />
      <rect x="50" y="176" width="5" height="7" /><rect x="64" y="200" width="5" height="7" />
    </g>
    <rect x="0" y="130" width="640" height="170" fill="url(#ha-sky)" />

    <!-- court (tennis) -->
    <g v-if="variant === 'court'">
      <polygon points="60,340 580,340 470,190 170,190" fill="url(#ha-surface)" stroke="#f2c94c" stroke-width="3" stroke-linejoin="round" />
      <g stroke="#f2c94c" stroke-width="2" fill="none" stroke-linejoin="round">
        <path d="M117,340 L187,190 M523,340 L453,190" />
        <path d="M123,250 H517" />
        <path d="M320,250 V214" />
      </g>
      <polygon points="131,240 509,240 490,216 150,216" fill="url(#ha-mesh)" stroke="#dfe6f2" stroke-opacity="0.8" stroke-width="1.4" />
      <path d="M150 216 H490" stroke="#ffffff" stroke-width="3" stroke-linecap="round" />
      <g stroke="#dfe6f2" stroke-width="2.4" stroke-linecap="round"><path d="M150 216 V246 M490 216 V246" /></g>
      <!-- racket -->
      <g transform="translate(560 270) rotate(28)" fill="none" stroke-linecap="round">
        <ellipse cx="0" cy="-40" rx="46" ry="62" stroke="#2a3a52" stroke-width="7" />
        <ellipse cx="0" cy="-40" rx="46" ry="62" stroke="#f2c94c" stroke-opacity="0.35" stroke-width="1.5" />
        <path d="M-30 -80 V0 M-15 -98 V18 M0 -102 V22 M15 -98 V18 M30 -80 V0 M-44 -55 H44 M-47 -35 H47 M-44 -15 H44 M-34 5 H34" stroke="#9fb0c6" stroke-opacity="0.28" stroke-width="1" />
        <path d="M0 22 V92" stroke="#2a3a52" stroke-width="9" />
      </g>
    </g>

    <!-- table (ping pong) -->
    <g v-else>
      <g stroke="#16243b" stroke-width="9" stroke-linecap="round"><path d="M110 334 V382 M530 334 V382 M196 262 V300 M444 262 V300" /></g>
      <polygon points="70,334 570,334 450,210 190,210" fill="url(#ha-surface)" stroke="#f2c94c" stroke-width="3.5" stroke-linejoin="round" />
      <g stroke="#f2c94c" stroke-width="2" fill="none"><path d="M320,334 L320,210" /><path d="M70,334 L190,210 M570,334 L450,210" opacity="0" /></g>
      <polygon points="130,272 510,272 488,236 152,236" fill="url(#ha-mesh)" stroke="#dfe6f2" stroke-opacity="0.8" stroke-width="1.4" />
      <path d="M152 236 H488" stroke="#ffffff" stroke-width="3" stroke-linecap="round" />
      <g stroke="#dfe6f2" stroke-width="3" stroke-linecap="round"><path d="M152 236 V280 M488 236 V280" /></g>
      <!-- paddle -->
      <g transform="translate(250 318) rotate(-12)"><ellipse cx="0" cy="0" rx="34" ry="22" fill="#f2c94c" /><ellipse cx="0" cy="0" rx="34" ry="22" fill="none" stroke="#b8901f" stroke-width="2" /><rect x="-7" y="18" width="14" height="22" rx="4" fill="#b8901f" /></g>
    </g>

    <!-- ball -->
    <g :transform="variant === 'table' ? 'translate(372 322)' : 'translate(405 296)'">
      <ellipse cx="2" :cy="variant === 'table' ? 16 : 26" :rx="variant === 'table' ? 15 : 24" :ry="variant === 'table' ? 4 : 6" fill="#000" opacity="0.35" />
      <circle cx="0" cy="0" :r="variant === 'table' ? 13 : 22" fill="url(#ha-ball)" />
      <path v-if="variant === 'court'" d="M-19 -9 C -6 -2, -6 8, -19 14 M19 -9 C 6 -2, 6 8, 19 14" stroke="#fff" stroke-opacity="0.75" stroke-width="2" fill="none" />
    </g>
  </svg>
</template>

<script setup lang="ts">
defineProps<{ variant: 'court' | 'table' }>()
</script>

<style scoped>
.hero-art {
  display: block; width: 100%; height: auto;
  /* fade the picture into the page on every side, so it has no visible box edge */
  -webkit-mask-image: radial-gradient(ellipse 72% 78% at 50% 52%, #000 52%, transparent 100%);
          mask-image: radial-gradient(ellipse 72% 78% at 50% 52%, #000 52%, transparent 100%);
}
</style>
