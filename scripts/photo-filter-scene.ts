/**
 * The Filter Gallery's sample scene (`scripts/photo-sheet.ts --thumbnails`): a city at dusk drawn as SVG, with the
 * things filters show themselves on: a sun and lit windows bright enough to glow, neon signs, smooth gradients for
 * colour looks, hard edges for halftone and glitches, water for ripples, and fine texture for grain. Deterministic:
 * the same picture every time.
 */
const W = 800;
const H = 600;

/** A small seeded random (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sceneSvg(): string {
  const r = random(7);
  const horizon = 390;
  const parts: string[] = [];
  // Far mountains.
  const ridge = (base: number, amp: number, colour: string, seed: number) => {
    const rr = random(seed);
    let d = `M0 ${horizon}`;
    for (let x = 0; x <= W; x += 40) d += ` L${x} ${base - rr() * amp}`;
    return `<path d="${d} L${W} ${horizon} Z" fill="${colour}"/>`;
  };
  parts.push(ridge(350, 60, "#5a2a5e", 3), ridge(372, 30, "#3a1c46", 5));
  // The skyline, to the right, with lit windows; a few low ones to the left.
  const building = (x: number, w: number, h: number) => {
    const top = horizon - h;
    parts.push(`<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${r() > 0.5 ? "#160e26" : "#1d1333"}"/>`);
    for (let wy = top + 10; wy < horizon - 12; wy += 14)
      for (let wx = x + 6; wx < x + w - 8; wx += 11) if (r() < 0.4) parts.push(`<rect x="${wx}" y="${wy}" width="6" height="8" fill="${r() < 0.75 ? "#ffd27a" : "#9fe8ff"}"/>`);
  };
  for (let x = 500; x < W; ) {
    const w = 36 + Math.floor(r() * 44);
    building(x, w, 110 + Math.floor(r() * 150));
    x += w + 3;
  }
  for (let x = 0; x < 120; ) {
    const w = 30 + Math.floor(r() * 30);
    building(x, w, 50 + Math.floor(r() * 60));
    x += w + 3;
  }
  // Neon signs.
  parts.push(
    `<rect x="${545}" y="250" width="70" height="14" rx="7" fill="none" stroke="#ff3fd2" stroke-width="5"/>`,
    `<rect x="${660}" y="205" width="16" height="70" rx="8" fill="none" stroke="#3ff2ff" stroke-width="5"/>`,
    `<rect x="${715}" y="300" width="60" height="12" rx="6" fill="none" stroke="#ffe23f" stroke-width="4"/>`,
  );
  // Reflections: the sun's column broken by ripples, and the city's lights.
  const water: string[] = [];
  for (let y = horizon + 4; y < 560; y += 5) {
    const spread = 30 + (y - horizon) * 0.45;
    const w = spread * (0.5 + r() * 0.8);
    water.push(`<rect x="${300 - w / 2 + (r() - 0.5) * 30}" y="${y}" width="${w}" height="2.5" fill="${y < horizon + 60 ? "#ffe9a8" : "#ff9a4a"}" opacity="${Math.max(0.15, 0.9 - (y - horizon) / 200)}"/>`);
  }
  for (let i = 0; i < 50; i++) {
    const colour = ["#ffd27a", "#ff3fd2", "#3ff2ff"][Math.floor(r() * 3)];
    water.push(`<rect x="${500 + r() * 300}" y="${horizon + 6 + r() * 150}" width="${8 + r() * 30}" height="2" fill="${colour}" opacity="${0.3 + r() * 0.5}"/>`);
  }
  // A palm to the left and a figure on the shore to the right, against the light.
  const fronds = [-150, -110, -60, -20, 20, 60, 110]
    .map((a) => {
      const t = (a * Math.PI) / 180;
      const ex = 150 + Math.cos(t) * 120;
      const ey = 185 + Math.sin(t) * 60 + 40;
      return `<path d="M150 185 Q${150 + Math.cos(t) * 70} ${170 + Math.sin(t) * 40 - 30} ${ex} ${ey}" stroke="#07050c" stroke-width="9" fill="none" stroke-linecap="round"/>`;
    })
    .join("");
  const palm = `<path d="M118 600 Q130 420 150 185" stroke="#07050c" stroke-width="14" fill="none"/>${fronds}`;
  const figure = `<g fill="#07050c"><circle cx="640" cy="418" r="15"/><path d="M622 436 Q640 428 658 436 L664 500 L656 500 L654 560 L644 560 L640 505 L636 560 L626 560 L624 500 L616 500 Z"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0b0a2e"/><stop offset="0.4" stop-color="#4a1d6b"/><stop offset="0.75" stop-color="#d0457a"/><stop offset="1" stop-color="#ffb05c"/>
  </linearGradient>
  <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#ffeeb0"/><stop offset="1" stop-color="#ffa050"/>
  </radialGradient>
  <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#ffd08a" stop-opacity="0.8"/><stop offset="1" stop-color="#ff7a5c" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#6a2a5a"/><stop offset="1" stop-color="#0a0714"/>
  </linearGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.10 0"/>
  </filter>
  <filter id="soft"><feGaussianBlur stdDeviation="1"/></filter>
</defs>
<rect width="${W}" height="${horizon}" fill="url(#sky)"/>
<circle cx="300" cy="290" r="210" fill="url(#halo)"/>
<circle cx="300" cy="290" r="78" fill="url(#sun)"/>
${parts.join("\n")}
<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#water)"/>
<g filter="url(#soft)">${water.join("")}</g>
<path d="M0 548 Q200 530 420 556 T800 548 L800 600 L0 600 Z" fill="#07050c"/>
${palm}
${figure}
<rect width="${W}" height="${H}" filter="url(#grain)"/>
</svg>`;
}
