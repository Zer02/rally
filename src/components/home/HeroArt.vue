<!-- HeroArt — v0.0.8.6. The home page's scene, drawn in code (no photos): a city skyline at dusk behind a chain-link
     fence, a map pin, and either a tennis court with a big ball and a racket, or a ping pong table. Colours are warm
     amber at the horizon fading to the page navy. Used large in the hero and cropped small in the round robin card
     (`decorative`, which hides it from screen readers). -->
<template>
  <svg :class="decorative ? 'scene-art' : 'hero-art'" viewBox="0 0 800 460" :preserveAspectRatio="decorative ? 'xMidYMax slice' : 'xMaxYMid slice'"
       :role="decorative ? undefined : 'img'" :aria-hidden="decorative ? 'true' : undefined"
       :aria-label="decorative ? undefined : (variant === 'table' ? 'A ping pong table' : 'A tennis court')">
    <defs>
      <linearGradient id="ha-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#070d17" /><stop offset="0.45" stop-color="#0d1a30" />
        <stop offset="0.66" stop-color="#3b2a2a" /><stop offset="0.8" stop-color="#9a5a22" />
        <stop offset="1" stop-color="#e0902f" />
      </linearGradient>
      <radialGradient id="ha-sun" cx="0.56" cy="0.66" r="0.34">
        <stop offset="0" stop-color="#ffd27a" stop-opacity="0.95" /><stop offset="0.35" stop-color="#f2a33a" stop-opacity="0.5" />
        <stop offset="1" stop-color="#f2a33a" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="ha-ground" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1a1a1c" /><stop offset="0.35" stop-color="#0e121a" /><stop offset="1" stop-color="#05080f" />
      </linearGradient>
      <linearGradient id="ha-bld" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#101b2e" /><stop offset="1" stop-color="#2a2226" />
      </linearGradient>
      <radialGradient id="ha-ball" cx="0.36" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#e2ee63" /><stop offset="0.45" stop-color="#b6cb2e" />
        <stop offset="0.85" stop-color="#6e8416" /><stop offset="1" stop-color="#3f5009" />
      </radialGradient>
      <radialGradient id="ha-gold-ball" cx="0.36" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#fbe58a" /><stop offset="0.55" stop-color="#f2c94c" /><stop offset="1" stop-color="#b8901f" />
      </radialGradient>
      <filter id="ha-felt" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="4" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 -0.35" result="a" />
        <feComposite in="a" in2="SourceGraphic" operator="in" />
      </filter>
      <pattern id="ha-link" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 0H14M0 0V14" stroke="#06101d" stroke-opacity="0.85" stroke-width="1.1" fill="none" />
      </pattern>
      <pattern id="ha-mesh" width="7" height="7" patternUnits="userSpaceOnUse">
        <path d="M0 0H7M0 0V7" stroke="#dfe6f2" stroke-opacity="0.25" stroke-width="0.8" fill="none" />
      </pattern>
      <clipPath id="ha-ballclip"><circle cx="0" cy="0" r="74" /></clipPath>
    </defs>

    <rect width="800" height="460" fill="url(#ha-sky)" />
    <rect width="800" height="460" fill="url(#ha-sun)" />

    <!-- map lines and pin, top right -->
    <g fill="none" stroke="#24344e" stroke-width="1.3" opacity="0.85">
      <path d="M560 10 C 640 60, 700 40, 800 100" /><path d="M590 0 C 620 90, 700 130, 780 190" />
      <path d="M520 80 C 620 120, 660 170, 760 170" /><path d="M660 0 C 690 40, 760 30, 800 30" /><path d="M700 60 C 720 120, 760 140, 800 160" />
    </g>
    <g transform="translate(636 92)"><path d="M0 40 C-24 14 -24 -24 0 -24 C24 -24 24 14 0 40Z" fill="#f2c94c" /><circle cx="0" cy="-5" r="8.5" fill="#070d17" /></g>

    <!-- skyline against the sun -->
    <g fill="url(#ha-bld)">
      <rect x="300" y="190" width="40" height="160" /><rect x="344" y="120" width="46" height="230" /><rect x="394" y="215" width="34" height="135" />
      <rect x="432" y="160" width="50" height="190" /><rect x="486" y="235" width="40" height="115" /><rect x="530" y="140" width="44" height="210" />
      <rect x="578" y="205" width="52" height="145" /><rect x="634" y="170" width="38" height="180" /><rect x="676" y="225" width="48" height="125" />
      <rect x="228" y="230" width="46" height="120" /><rect x="170" y="200" width="52" height="150" /><rect x="110" y="250" width="54" height="100" />
    </g>
    <g fill="#ffd98a" opacity="0.7">
      <rect x="352" y="140" width="5" height="8" /><rect x="368" y="160" width="5" height="8" /><rect x="352" y="188" width="5" height="8" /><rect x="368" y="214" width="5" height="8" />
      <rect x="440" y="180" width="5" height="8" /><rect x="458" y="204" width="5" height="8" /><rect x="440" y="232" width="5" height="8" />
      <rect x="538" y="162" width="5" height="8" /><rect x="554" y="186" width="5" height="8" /><rect x="538" y="214" width="5" height="8" />
      <rect x="642" y="190" width="5" height="8" /><rect x="654" y="214" width="5" height="8" />
      <rect x="180" y="222" width="5" height="8" /><rect x="198" y="246" width="5" height="8" /><rect x="310" y="212" width="5" height="8" />
    </g>

    <!-- chain-link fence -->
    <rect x="0" y="236" width="800" height="104" fill="url(#ha-link)" />
    <g stroke="#050a14" stroke-width="5" stroke-linecap="round"><path d="M0 238 H800" /><path d="M80 238 V342 M280 238 V342 M480 238 V342 M680 238 V342" /></g>

    <!-- ground -->
    <rect x="0" y="336" width="800" height="124" fill="url(#ha-ground)" />

    <g v-if="variant === 'court'">
      <g stroke="#e8edf4" stroke-width="5" stroke-linecap="round" stroke-opacity="0.55" fill="none">
        <path d="M0 356 L800 346" /><path d="M-40 460 L250 352" /><path d="M340 460 L420 350" stroke-opacity="0.4" />
      </g>
      <!-- racket, behind the ball -->
      <g transform="translate(660 356) rotate(-16)" fill="none" stroke-linecap="round">
        <ellipse cx="0" cy="0" rx="170" ry="112" stroke="#0a1220" stroke-width="16" />
        <ellipse cx="0" cy="0" rx="170" ry="112" stroke="#2b3d5c" stroke-width="3" />
        <path d="M-120 -78 V78 M-80 -100 V100 M-40 -108 V108 M0 -110 V110 M40 -108 V108 M80 -100 V100 M120 -78 V78 M-160 -40 H160 M-168 0 H168 M-160 40 H160 M-130 76 H130" stroke="#9fb0c6" stroke-opacity="0.22" stroke-width="1.2" />
        <path d="M-170 0 H-260" stroke="#0a1220" stroke-width="22" />
      </g>
      <!-- ball -->
      <g transform="translate(470 326)">
        <ellipse cx="6" cy="76" rx="92" ry="12" fill="#000" opacity="0.55" />
        <circle r="74" fill="url(#ha-ball)" />
        <g clip-path="url(#ha-ballclip)">
          <rect x="-80" y="-80" width="160" height="160" fill="#2b3a08" filter="url(#ha-felt)" opacity="0.55" />
          <path d="M-62 -52 C -16 -26, -16 30, -60 54" stroke="#f3f5e6" stroke-opacity="0.85" stroke-width="4.5" fill="none" />
          <path d="M62 -52 C 16 -26, 16 30, 60 54" stroke="#f3f5e6" stroke-opacity="0.85" stroke-width="4.5" fill="none" />
        </g>
        <circle r="74" fill="none" stroke="#ffd98a" stroke-opacity="0.35" stroke-width="2" />
      </g>
    </g>

    <g v-else>
      <g stroke="#10192a" stroke-width="12" stroke-linecap="round"><path d="M150 460 V420 M650 460 V420 M268 368 V400 M532 368 V400" /></g>
      <polygon points="60,460 740,460 600,330 200,330" fill="#0d1a2f" stroke="#f2c94c" stroke-width="4" stroke-linejoin="round" />
      <path d="M400 460 V330" stroke="#f2c94c" stroke-width="2.5" />
      <polygon points="140,414 660,414 626,372 174,372" fill="url(#ha-mesh)" stroke="#dfe6f2" stroke-opacity="0.8" stroke-width="1.5" />
      <path d="M174 372 H626" stroke="#fff" stroke-width="4" stroke-linecap="round" />
      <g stroke="#dfe6f2" stroke-width="4" stroke-linecap="round"><path d="M174 372 V424 M626 372 V424" /></g>
      <g transform="translate(300 426) rotate(-14)"><ellipse rx="52" ry="34" fill="#f2c94c" /><ellipse rx="52" ry="34" fill="none" stroke="#b8901f" stroke-width="3" /><rect x="-10" y="28" width="20" height="34" rx="6" fill="#b8901f" /></g>
      <g transform="translate(470 420)"><ellipse cx="3" cy="22" rx="24" ry="6" fill="#000" opacity="0.5" /><circle r="21" fill="url(#ha-gold-ball)" /></g>
    </g>
  </svg>
</template>

<script setup lang="ts">
defineProps<{ variant: 'court' | 'table'; decorative?: boolean }>()
</script>

<style scoped>
.hero-art, .scene-art { display: block; width: 100%; height: 100%; }
</style>
