/**
 * MilkDrop's looks (docs/now-playing.md, step 8): presets of Butterchurn's (MilkDrop 2 in WebGL 2), each a look whose
 * picture is Butterchurn's canvas drawn live (`MILKDROP_ASSET`: the view's `MilkDrop` draws the preset of the MilkDrop
 * look on screen, and the engine takes the canvas as it is each frame). The editor's energy, effects, frame and
 * transitions go over it as over any look. Which presets, and what each suits, were picked from sheets of them on
 * music (`scripts/milkdrop-sheet.ts`). Pure.
 */
import { defaultEffects } from "./effects.ts";
import { withIds } from "./live-kit.ts";
import type { LiveLook, LookSuits } from "./live-looks.ts";
import type { MediaAsset } from "./types.ts";

/** The picture MilkDrop's looks show: Butterchurn's canvas (`PreviewSource.livePicture`). */
export const MILKDROP_ASSET = "milkdrop";
/** The size it's drawn at: 16:9, as the frame (more is slower, and MilkDrop was made for less). */
export const MILKDROP_SIZE = { width: 1280, height: 720 };

/** Butterchurn's packs the presets come from (`butterchurn-presets/lib/<pack>.min.js`), loaded when one's first wanted. */
export const MILKDROP_PACKS = ["butterchurnPresets", "butterchurnPresetsExtra", "butterchurnPresetsExtra2", "butterchurnPresetsMD1"] as const;
export type MilkdropPack = (typeof MILKDROP_PACKS)[number];

/** A preset picked: its name in its pack, what it's called here, what it suits. */
export interface MilkdropPreset {
  /** Its look's id (`md-` and this). */
  id: string;
  name: string;
  pack: MilkdropPack;
  /** What it's called in its menu. */
  title: string;
  suits: LookSuits;
}

/**
 * The presets picked (`scripts/milkdrop-sheet.ts`, 2026-10-14): 115 of the packs' 395 that look good on music (most
 * shapes and light in a black void, kaleidoscopes, feedback, calm scenes that flow), none mostly black, blown out,
 * still or slow to draw (1.2 ms a frame on average at 1280 × 720, 3.6 at most). The intensities each suits are from
 * how fast it moves (measured); the kinds of song, and whether it flows (for slow songs) or is minimal, by eye.
 */
export const MILKDROP_PRESETS: MilkdropPreset[] = [
  { id: "firestorm", name: "11", pack: "butterchurnPresetsExtra2", title: "Firestorm", suits: { characters: ["hype", "heavy"], energy: [0.3, 0.85] } },
  { id: "neon-moth", name: "444", pack: "butterchurnPresetsExtra2", title: "Neon Moth", suits: { characters: ["groove", "hype"], energy: [0.3, 0.85] } },
  { id: "neon-eye", name: "$$$ Royal - Mashup (197)", pack: "butterchurnPresets", title: "Neon Eye", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "petal-mirror", name: "$$$ Royal - Mashup (220)", pack: "butterchurnPresets", title: "Petal Mirror", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85] } },
  { id: "neon-coils", name: "_Mig_085", pack: "butterchurnPresets", title: "Neon Coils", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "airhandler", name: "Aderrasi + Geiss - Airhandler (Kali Mix) - Canvas Mix", pack: "butterchurnPresets", title: "Airhandler", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "storm-eye", name: "Aderrasi - Storm of the Eye (Thunder) - mash0000 - quasi pseudo meta concentrics", pack: "butterchurnPresets", title: "Storm Eye", suits: { characters: ["hype", "heavy"], energy: [0.5, 1] } },
  { id: "red-tide", name: "Cope - The Neverending Explosion of Red Liquid Fire", pack: "butterchurnPresets", title: "Red Tide", suits: { characters: ["chill", "heavy"], energy: [0.1, 0.85], flows: true } },
  { id: "cubetrace", name: "Eo.S. + Phat - cubetrace - v2", pack: "butterchurnPresets", title: "Cubetrace", suits: { characters: ["chill"], energy: [0, 0.7], minimal: true, flows: true } },
  { id: "pogo", name: "flexi + geiss - pogo cubes vs. tokamak vs. game of life [stahls jelly 4.5 finish]", pack: "butterchurnPresets", title: "Pogo", suits: { characters: ["chill", "groove"], energy: [0, 0.7], minimal: true, flows: true } },
  { id: "astral-projection", name: "Flexi + Martin - astral projection", pack: "butterchurnPresets", title: "Astral Projection", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "area-51", name: "Flexi - area 51", pack: "butterchurnPresets", title: "Area 51", suits: { characters: ["groove", "hype"], energy: [0.3, 1] } },
  { id: "mindblob", name: "Flexi - mindblob [shiny mix]", pack: "butterchurnPresets", title: "Mindblob", suits: { characters: ["chill", "heavy"], energy: [0, 0.7], minimal: true, flows: true } },
  { id: "sky-petals", name: "flexi - mom, why the sky looks different today", pack: "butterchurnPresets", title: "Sky Petals", suits: { characters: ["groove"], energy: [0.3, 1] } },
  { id: "predator-prey", name: "Flexi - predator-prey-spirals", pack: "butterchurnPresets", title: "Predator Prey", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "spiral-swing", name: "flexi - swing out on the spiral", pack: "butterchurnPresets", title: "Spiral Swing", suits: { characters: ["groove", "hype"], energy: [0.3, 0.85] } },
  { id: "maxawow", name: "Flexi, martin + geiss - dedicated to the sherwin maxawow", pack: "butterchurnPresets", title: "Maxawow", suits: { characters: ["groove", "hype"], energy: [0.3, 1] } },
  { id: "disconnected", name: "Geiss + Flexi + Martin - disconnected", pack: "butterchurnPresets", title: "Disconnected", suits: { characters: ["hype", "heavy"], energy: [0.5, 1] } },
  { id: "star-of-annon", name: "Idiot - Star Of Annon", pack: "butterchurnPresets", title: "Star of Annon", suits: { characters: ["chill"], energy: [0, 0.7], flows: true } },
  { id: "spiral-movement", name: "Krash + Illusion - Spiral Movement", pack: "butterchurnPresets", title: "Spiral Movement", suits: { characters: ["groove", "hype"], energy: [0.3, 1] } },
  { id: "acid-wiring", name: "Martin - acid wiring", pack: "butterchurnPresets", title: "Acid Wiring", suits: { characters: ["groove", "heavy"], energy: [0.3, 1] } },
  { id: "another-groove", name: "martin - another kind of groove", pack: "butterchurnPresets", title: "Another Groove", suits: { characters: ["groove"], energy: [0.3, 1] } },
  { id: "bombyx", name: "martin - bombyx mori", pack: "butterchurnPresets", title: "Bombyx", suits: { characters: ["groove", "hype"], energy: [0.3, 0.85] } },
  { id: "chain-breaker", name: "martin - chain breaker", pack: "butterchurnPresets", title: "Chain Breaker", suits: { characters: ["groove"], energy: [0.1, 0.85] } },
  { id: "charisma", name: "Martin - charisma", pack: "butterchurnPresets", title: "Charisma", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "disco-tunnel", name: "martin - disco mix 4", pack: "butterchurnPresets", title: "Disco Tunnel", suits: { characters: ["hype"], energy: [0.3, 1] } },
  { id: "liquid-arrows", name: "Martin - liquid arrows", pack: "butterchurnPresets", title: "Liquid Arrows", suits: { characters: ["groove", "heavy"], energy: [0.1, 0.85], flows: true } },
  { id: "mercury", name: "martin - mucus cervix", pack: "butterchurnPresets", title: "Mercury", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85] } },
  { id: "black-tiles", name: "martin - reflections on black tiles", pack: "butterchurnPresets", title: "Black Tiles", suits: { characters: ["chill"], energy: [0, 0.7], minimal: true, flows: true } },
  { id: "fata-morgana", name: "martin [shadow harlequins shape code] - fata morgana", pack: "butterchurnPresets", title: "Fata Morgana", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "enterstate", name: "martin, flexi, fishbrain + sto - enterstate [random mashup]", pack: "butterchurnPresets", title: "Enterstate", suits: { characters: ["groove", "hype"], energy: [0.3, 0.85] } },
  { id: "waaa", name: "ORB - Waaa", pack: "butterchurnPresets", title: "Waaa", suits: { characters: ["hype", "heavy"], energy: [0.5, 1] } },
  { id: "mandala-chasers", name: "Phat+fiShbRaiN+Eo.S_Mandala_Chasers_remix", pack: "butterchurnPresets", title: "Mandala Chasers", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "dark-tides", name: "shifter - dark tides bdrv mix 2", pack: "butterchurnPresets", title: "Dark Tides", suits: { characters: ["chill", "heavy"], energy: [0, 0.7], flows: true } },
  { id: "rewop", name: "Unchained - Rewop", pack: "butterchurnPresets", title: "Rewop", suits: { characters: ["groove"], energy: [0.1, 0.85] } },
  { id: "singularity", name: "yin - 191 - Temporal singularities", pack: "butterchurnPresets", title: "Singularity", suits: { characters: ["hype", "heavy"], energy: [0.5, 1] } },
  { id: "star-ornament", name: "Zylot - Star Ornament", pack: "butterchurnPresets", title: "Star Ornament", suits: { characters: ["chill"], energy: [0, 0.7], minimal: true, flows: true } },
  { id: "royal-swirl", name: "$$$ Royal - Mashup (177)", pack: "butterchurnPresetsExtra", title: "Royal Swirl", suits: { characters: ["hype"], energy: [0.3, 1] } },
  { id: "neon-mandala", name: "$$$ Royal - Mashup (326)", pack: "butterchurnPresetsExtra", title: "Neon Mandala", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "glowstick", name: "_Eo.S. - glowsticks v2 02 - Geiss HPF", pack: "butterchurnPresetsExtra", title: "Glowstick", suits: { characters: ["chill"], energy: [0, 0.7], flows: true } },
  { id: "kaleido-burst", name: "_Mig_004_version2", pack: "butterchurnPresetsExtra", title: "Kaleido Burst", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "scribble-storm", name: "_Mig_028", pack: "butterchurnPresetsExtra", title: "Scribble Storm", suits: { characters: ["hype", "heavy"], energy: [0.5, 1] } },
  { id: "tendrils", name: "Aderrasi + Geiss - Airhandler (Kali Mix) - Painterly Tendrils Colorfast", pack: "butterchurnPresetsExtra", title: "Tendrils", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "passage", name: "Cope - Passage (mandala mix)", pack: "butterchurnPresetsExtra", title: "Passage", suits: { characters: ["groove", "hype"], energy: [0.3, 1] } },
  { id: "glowsticks", name: "Eo.S. - glowsticks v2 03 music", pack: "butterchurnPresetsExtra", title: "Glowsticks", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "witchcraft", name: "fiShbRaiN + geiss - witchcraft (Grow Mix 3)", pack: "butterchurnPresetsExtra", title: "Witchcraft", suits: { characters: ["groove"], energy: [0.1, 0.85] } },
  { id: "alien-fader", name: "Flexi - alien fader", pack: "butterchurnPresetsExtra", title: "Alien Fader", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "web-bouncer", name: "Flexi - alien web bouncer [26]", pack: "butterchurnPresetsExtra", title: "Web Bouncer", suits: { characters: ["hype", "heavy"], energy: [0.5, 1] } },
  { id: "jellyfish-mandala", name: "flexi - jelly fish mandala", pack: "butterchurnPresetsExtra", title: "Jellyfish Mandala", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "piercing", name: "Flexi - piercing", pack: "butterchurnPresetsExtra", title: "Piercing", suits: { characters: ["heavy"], energy: [0.3, 1] } },
  { id: "psychenapping", name: "Flexi - psychenapping", pack: "butterchurnPresetsExtra", title: "Psychenapping", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "tunnel-burst", name: "Geiss - 3 layers (Tunnel Mix)", pack: "butterchurnPresetsExtra", title: "Tunnel Burst", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "bipolar", name: "Geiss - Bipolar 2 Enhanced", pack: "butterchurnPresetsExtra", title: "Bipolar", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "ember-lines", name: "martin + stahlregen - martin in da mash 12", pack: "butterchurnPresetsExtra", title: "Ember Lines", suits: { characters: ["groove", "heavy"], energy: [0.1, 0.85] } },
  { id: "spirograph", name: "martin + stahlregen - martin in da mash 12a", pack: "butterchurnPresetsExtra", title: "Spirograph", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "solar-kaleido", name: "martin + stahlregen - martin in da mash 14", pack: "butterchurnPresetsExtra", title: "Solar Kaleido", suits: { characters: ["hype", "heavy"], energy: [0.5, 1] } },
  { id: "bombyx-night", name: "martin - bombyx mori [flexi′s logarithmic edit]", pack: "butterchurnPresetsExtra", title: "Bombyx Night", suits: { characters: ["chill"], energy: [0.1, 0.7], flows: true } },
  { id: "big-guns", name: "martin - bring up the big guns", pack: "butterchurnPresetsExtra", title: "Big Guns", suits: { characters: ["hype"], energy: [0.3, 1] } },
  { id: "laser-dome", name: "martin - cope - laser dome", pack: "butterchurnPresetsExtra", title: "Laser Dome", suits: { characters: ["groove"], energy: [0.1, 0.85] } },
  { id: "disco-six", name: "Martin - disco mix 6", pack: "butterchurnPresetsExtra", title: "Disco Six", suits: { characters: ["hype"], energy: [0.3, 1] } },
  { id: "glassball", name: "martin - glassball dance", pack: "butterchurnPresetsExtra", title: "Glassball", suits: { characters: ["groove", "hype"], energy: [0.5, 1] } },
  { id: "ice-flames", name: "martin - ice flames", pack: "butterchurnPresetsExtra", title: "Ice Flames", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "space-journey", name: "Martin - journey into space", pack: "butterchurnPresetsExtra", title: "Space Journey", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "ludicrous-speed", name: "martin - ludicrous speed", pack: "butterchurnPresetsExtra", title: "Ludicrous Speed", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "steel-spring", name: "martin - resonant twister - steel spring", pack: "butterchurnPresetsExtra", title: "Steel Spring", suits: { characters: ["chill"], energy: [0.1, 0.7], flows: true } },
  { id: "magma-pool", name: "ORB - Magma Pool", pack: "butterchurnPresetsExtra", title: "Magma Pool", suits: { characters: ["heavy"], energy: [0.3, 1] } },
  { id: "answer-42", name: "Rocke - Answer.42 (New Mix 1) - mash0000 - slash and char p. jungle", pack: "butterchurnPresetsExtra", title: "Answer 42", suits: { characters: ["hype", "heavy"], energy: [0.5, 1] } },
  { id: "hurricane", name: "Rovastar + Geiss - Hurricane Nightmare", pack: "butterchurnPresetsExtra", title: "Hurricane", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "hyperkaleidoscope", name: "Rovastar + Geiss - Hyperkaleidoscope Glow 2 motion blur (Jelly)", pack: "butterchurnPresetsExtra", title: "Hyperkaleidoscope", suits: { characters: ["groove", "hype"], energy: [0.3, 1] } },
  { id: "snapshot-of-space", name: "Rovastar + Geiss - Snapshot Of Space (LSB mix)", pack: "butterchurnPresetsExtra", title: "Snapshot of Space", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "altars-of-madness", name: "Rovastar + Telek - Altars of Madness (Rolling Oceans Mix)", pack: "butterchurnPresetsExtra", title: "Altars of Madness", suits: { characters: ["groove"], energy: [0.3, 1] } },
  { id: "angel-wings", name: "shifter - feathers (angel wings)_phat_remix relief 2", pack: "butterchurnPresetsExtra", title: "Angel Wings", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "metal-flower", name: "Stahlregen + martin + others - Psychedelic Metal Flower", pack: "butterchurnPresetsExtra", title: "Metal Flower", suits: { characters: ["groove", "hype"], energy: [0.3, 1] } },
  { id: "artificial-poles", name: "yin - 250 - Artificial poles of the continuum_Phat′s_Orbit_mix", pack: "butterchurnPresetsExtra", title: "Artificial Poles", suits: { characters: ["chill"], energy: [0, 0.7], flows: true } },
  { id: "pole-star", name: "yin - 253 - Artificial poles of the continuum (remix #3)", pack: "butterchurnPresetsExtra", title: "Pole Star", suits: { characters: ["groove"], energy: [0.1, 0.85] } },
  { id: "kaleido-royal", name: "$$$ Royal - Mashup (160)", pack: "butterchurnPresetsExtra2", title: "Kaleido Royal", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "white-scribble", name: "_Mig_009", pack: "butterchurnPresetsExtra2", title: "White Scribble", suits: { characters: ["groove", "heavy"], energy: [0.3, 1] } },
  { id: "shards", name: "_Mig_014_version2", pack: "butterchurnPresetsExtra2", title: "Shards", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "tribute", name: "A Tribute to Martin - bombyx mori - Ft Flexi - AdamFX - StahlRegen - Krash - Rovastar -  Hd in Milk T", pack: "butterchurnPresetsExtra2", title: "Tribute", suits: { characters: ["chill", "groove"], energy: [0, 0.7], flows: true } },
  { id: "yellow-smoke", name: "adam eatit fx 2 martin - disco mix, lodus, geiss, ludicrous speed,flexi, aderrasi n hexcollie", pack: "butterchurnPresetsExtra2", title: "Yellow Smoke", suits: { characters: ["chill"], energy: [0, 0.7], flows: true } },
  { id: "disco-sparkle", name: "Adam Eatit Mashup FX 2 martin - disco mix + Lodus + Geiss + Ludicrous speed + Aderrasi 2_1", pack: "butterchurnPresetsExtra2", title: "Disco Sparkle", suits: { characters: ["hype"], energy: [0.5, 1] } },
  { id: "particle-twist", name: "Adam Eatit Mashup FX 2 martin - disco mix + Lodus + Geiss + Ludicrous speed + Baked Ft another AdamFX Mashup 7_1", pack: "butterchurnPresetsExtra2", title: "Particle Twist", suits: { characters: ["groove"], energy: [0.1, 0.85] } },
  { id: "green-nebula", name: "Adam Eatit Mashup FX 2 martin - disco mix + Lodus + Geiss + Ludicrous speed + Eos Ft Flexi n Hexocollie + Baked + Santa Fucking Claus", pack: "butterchurnPresetsExtra2", title: "Green Nebula", suits: { characters: ["chill"], energy: [0.3, 0.7], flows: true } },
  { id: "nautilus", name: "AdamFx 2 Aderrasi - Airhandler (Last Breath - Calm)Ilusional Discontent2", pack: "butterchurnPresetsExtra2", title: "Nautilus", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "soar", name: "cope - soar (v2.0)", pack: "butterchurnPresetsExtra2", title: "Soar", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "cybercity", name: "Eo.S. + Phat cubetrace (cybercity madness remix) - mash0000 - evaporating crystal pharma", pack: "butterchurnPresetsExtra2", title: "Cybercity", suits: { characters: ["hype", "heavy"], energy: [0.3, 1] } },
  { id: "supraschismatika", name: "Flexi + Martin - tunnel of supraschismatika", pack: "butterchurnPresetsExtra2", title: "Supraschismatika", suits: { characters: ["groove", "hype"], energy: [0.3, 1] } },
  { id: "beat-explorer", name: "flexi + nitorami - beat explorer (cn bc jelly 4)", pack: "butterchurnPresetsExtra2", title: "Beat Explorer", suits: { characters: ["hype", "heavy"], energy: [0.3, 1] } },
  { id: "color-strike", name: "flexi - color strike", pack: "butterchurnPresetsExtra2", title: "Color Strike", suits: { characters: ["chill"], energy: [0, 0.7], flows: true } },
  { id: "reality-tunnel", name: "Flexi - reality tunnel", pack: "butterchurnPresetsExtra2", title: "Reality Tunnel", suits: { characters: ["chill"], energy: [0, 0.7], minimal: true, flows: true } },
  { id: "feedback", name: "Geiss - Feedback 2", pack: "butterchurnPresetsExtra2", title: "Feedback", suits: { characters: ["chill"], energy: [0, 0.7], minimal: true, flows: true } },
  { id: "neon-wires", name: "LuxXx - Fuck Your Code ii", pack: "butterchurnPresetsExtra2", title: "Neon Wires", suits: { characters: ["groove", "hype"], energy: [0.3, 1] } },
  { id: "hip-hop-flake", name: "LuxXx - Subtle HipHopFlake", pack: "butterchurnPresetsExtra2", title: "Hip Hop Flake", suits: { characters: ["groove", "hype"], energy: [0.5, 1] } },
  { id: "the-beast", name: "martin - attack of the beast", pack: "butterchurnPresetsExtra2", title: "The Beast", suits: { characters: ["heavy"], energy: [0.1, 0.85] } },
  { id: "cool-morning", name: "Martin - cool morning", pack: "butterchurnPresetsExtra2", title: "Cool Morning", suits: { characters: ["chill"], energy: [0, 0.7], flows: true } },
  { id: "crystal-alley", name: "martin - crystal alley", pack: "butterchurnPresetsExtra2", title: "Crystal Alley", suits: { characters: ["groove"], energy: [0.1, 0.85] } },
  { id: "dark-galaxy", name: "martin - dark galaxy", pack: "butterchurnPresetsExtra2", title: "Dark Galaxy", suits: { characters: ["groove", "heavy"], energy: [0.1, 0.85], flows: true } },
  { id: "robotopia", name: "martin - shifter - armorial bearings of robotopia", pack: "butterchurnPresetsExtra2", title: "Robotopia", suits: { characters: ["groove"], energy: [0.1, 0.85] } },
  { id: "soma", name: "martin - soma in pink", pack: "butterchurnPresetsExtra2", title: "Soma", suits: { characters: ["chill"], energy: [0.1, 0.7], flows: true } },
  { id: "sparky-kaleidoscope", name: "martin - sparky caleidoscope", pack: "butterchurnPresetsExtra2", title: "Sparky Kaleidoscope", suits: { characters: ["groove", "hype"], energy: [0.3, 0.85] } },
  { id: "starfield-sectors", name: "martin - starfield sectors", pack: "butterchurnPresetsExtra2", title: "Starfield Sectors", suits: { characters: ["hype"], energy: [0.3, 1] } },
  { id: "sunset-river", name: "martin - sunset over the river", pack: "butterchurnPresetsExtra2", title: "Sunset River", suits: { characters: ["chill"], energy: [0.1, 0.7], flows: true } },
  { id: "forge", name: "martin - the forge of Isengard", pack: "butterchurnPresetsExtra2", title: "Forge", suits: { characters: ["heavy"], energy: [0.3, 1] } },
  { id: "blue-emotion", name: "ORB - Blue Emotion", pack: "butterchurnPresetsExtra2", title: "Blue Emotion", suits: { characters: ["chill"], energy: [0, 0.7], flows: true } },
  { id: "depth-charge", name: "ORB - Depth Charge 2", pack: "butterchurnPresetsExtra2", title: "Depth Charge", suits: { characters: ["groove"], energy: [0, 0.7] } },
  { id: "laser-lines", name: "Phat + Zylot + Eo.S. - work with lines", pack: "butterchurnPresetsExtra2", title: "Laser Lines", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "gold-chrome", name: "Rovastar + Geiss - Hurricane Nightmare (Gold Chrome Mix)", pack: "butterchurnPresetsExtra2", title: "Gold Chrome", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "hyperspace-kaleido", name: "Rovastar + Geiss - Hyperspace - kaleidoscope", pack: "butterchurnPresetsExtra2", title: "Hyperspace Kaleido", suits: { characters: ["groove", "hype"], energy: [0.3, 1] } },
  { id: "helix", name: "Telek - City Helix Lattice", pack: "butterchurnPresetsExtra2", title: "Helix", suits: { characters: ["hype"], energy: [0.3, 1] } },
  { id: "true-visionary", name: "Zylot - True Visionary", pack: "butterchurnPresetsExtra2", title: "True Visionary", suits: { characters: ["groove"], energy: [0.3, 1] } },
  { id: "multisphere", name: "Eo.S. - multisphere 01 B_Phat_Ra_mix", pack: "butterchurnPresetsMD1", title: "Multisphere", suits: { characters: ["groove", "heavy"], energy: [0.1, 0.85] } },
  { id: "quiet-glow", name: "fiShbRaiN - a quiet death", pack: "butterchurnPresetsMD1", title: "Quiet Glow", suits: { characters: ["chill"], energy: [0, 0.7], minimal: true, flows: true } },
  { id: "star-cluster", name: "phat + Eo.S. - Bass_responce_Red_Movements_Disorienting nebula3", pack: "butterchurnPresetsMD1", title: "Star Cluster", suits: { characters: ["chill", "groove"], energy: [0.1, 0.85], flows: true } },
  { id: "warp-stars", name: "Rovastar - Hyperspace", pack: "butterchurnPresetsMD1", title: "Warp Stars", suits: { characters: ["groove", "hype"], energy: [0.3, 0.85] } },
  { id: "fractal-grinder", name: "shifter - fractal grinder", pack: "butterchurnPresetsMD1", title: "Fractal Grinder", suits: { characters: ["heavy"], energy: [0.1, 0.85] } },
];

/** The picture of a MilkDrop look: Butterchurn's canvas, filling the frame. */
export function milkdropAsset(): MediaAsset {
  return {
    id: MILKDROP_ASSET,
    projectId: null,
    name: "MilkDrop",
    kind: "image",
    duration: Number.MAX_SAFE_INTEGER,
    width: MILKDROP_SIZE.width,
    height: MILKDROP_SIZE.height,
    fps: null,
    hasVideo: true,
    hasAudio: false,
    size: 0,
    createdAt: 0,
    status: "ready",
    // (Nothing to load: the engine takes the canvas.)
    src: "",
    poster: null,
    filmstrip: null,
    waveform: null,
  };
}

const byLook = new Map(MILKDROP_PRESETS.map((p) => [`md-${p.id}`, p]));

/** The preset a look draws, if it's a MilkDrop look. */
export const milkdropPreset = (lookId: string): MilkdropPreset | null => byLook.get(lookId) ?? null;

/** MilkDrop's looks: each its preset drawn live, filling the frame. */
export const MILKDROP_LOOKS: LiveLook[] = MILKDROP_PRESETS.map((p) => ({
  id: `md-${p.id}`,
  name: p.title,
  kind: "milkdrop",
  suits: p.suits,
  layers: () => [{ assetId: MILKDROP_ASSET, effects: withIds(defaultEffects()) }],
}));
