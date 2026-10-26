<!-- DuskBanner — v0.0.8.9. The closing band of the visitor home page: a dusk horizon with a fence and trees, and a line
     of type over it. It takes whatever height the page has left, so the page ends on it with no empty space below.
     The sky above the scene is the page's own navy, so a taller band just looks like more sky. -->
<template>
  <div class="dusk" data-test="dusk">
    <svg class="dusk-art" viewBox="0 0 1200 140" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <pattern id="du-link" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0H12M0 0V12" stroke="#05080f" stroke-opacity="0.8" stroke-width="1" fill="none" />
        </pattern>
      </defs>
      <g fill="#05080f">
        <circle cx="60" cy="118" r="34" /><circle cx="110" cy="124" r="28" /><circle cx="170" cy="120" r="38" /><circle cx="900" cy="122" r="36" />
        <circle cx="960" cy="118" r="30" /><circle cx="1030" cy="122" r="40" /><circle cx="1110" cy="120" r="32" /><circle cx="1170" cy="124" r="30" />
        <rect x="0" y="126" width="1200" height="14" />
      </g>
      <rect x="220" y="60" width="640" height="66" fill="url(#du-link)" />
      <g stroke="#05080f" stroke-width="4"><path d="M220 60 H860" /><path d="M220 60 V128 M380 60 V128 M540 60 V128 M700 60 V128 M860 60 V128" /></g>
    </svg>
    <p class="dusk-line"><span /><em>More play. Less work.</em><span /></p>
  </div>
</template>

<style scoped>
.dusk {
  --band: 9rem;                                   /* the dusk scene itself; anything taller is sky */
  position: relative; flex: 1 0 auto; display: flex; flex-direction: column; justify-content: flex-end;
  min-height: var(--band); margin: 2.25rem calc(50% - 50vw) 0; padding: 0 calc(50vw - 50%); overflow: hidden;
  background: linear-gradient(to bottom, #070d17 0, #070d17 calc(100% - var(--band)), #2a1d22 calc(100% - 5rem), #b3622a 100%);
}
.dusk-art { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; height: var(--band); display: block; }
.dusk-line { position: relative; display: flex; align-items: center; justify-content: center; gap: 1rem; height: var(--band); margin: 0; }
.dusk-line span { flex: 1 1 0; max-width: 9rem; height: 1px; background: var(--ball); opacity: 0.8; }
.dusk-line em { font-family: var(--font-display); font-size: clamp(1.5rem, 3.2vw, 2rem); color: var(--ball); text-align: center; text-shadow: 0 2px 12px rgba(0,0,0,0.6); }
</style>
