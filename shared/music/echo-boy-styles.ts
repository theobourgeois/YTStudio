/**
 * EchoBoy's 31 Echo Styles, in its menu's order (`docs/soundtoys/echoboy-manual.md`). EchoBoy's styles are
 * settings of its Style Editor ("these control parameters were used to create the included style
 * presets"), so each one here is an `EchoStyle`. Soundtoys never published them: they're voiced from what
 * each style models and how it's described (`docs/soundtoys/echoboy-dsp.md`, a table per style).
 *
 * How to read one: each EQ band's `gain` (dB) is how the first repeat sounds; its `decay` is the Decay
 * knob (-40..18), what every further repeat loses or gains (`decayDb`: -40 is -6 dB a repeat, -16 about
 * -1 dB, -9 about -0.3 dB). The saturation drives are dB into the curve: 0 is a level's knee at full scale.
 *
 * Only types are imported, so `project.ts` can use this to normalise a song.
 */
import type { EchoStyle, EchoWobble, EchoSaturation } from "./types.ts";

/** What each further repeat gains (dB) for a Decay knob's value (-40..18): ±6 dB at its ends, fine near 0. */
export const decayDb = (knob: number) => (knob < 0 ? -6 * (knob / 40) ** 2 : 6 * (knob / 18) ** 2);

interface StyleSpec {
  low?: [number, number, number?];
  mid?: [number, number, number, number?];
  high?: [number, number, number?];
  diffusion?: [number, number, boolean];
  wobble?: [number, number, EchoWobble, number?, boolean?, boolean?];
  saturation: [number, number, EchoSaturation];
}

/**
 * A style from its numbers: `low` / `high` [freq, gain, decay], `mid` [freq, res, gain, decay], `diffusion`
 * [amount, size, loop], `wobble` [depth (cents), rate (Hz), shape, sync, on the repeats, on the output],
 * `saturation` [decay sat, out sat, type]. What's left out is flat, off.
 */
function style({ low = [20, 0, 0], mid = [1000, 0, 0, 0], high = [12_000, 0, 0], diffusion = [0, 10, true], wobble = [0, 0.5, "randomWalk"], saturation }: StyleSpec): EchoStyle {
  return {
    low: { freq: low[0], gain: low[1], decay: low[2] ?? 0 },
    mid: { freq: mid[0], res: mid[1], gain: mid[2], decay: mid[3] ?? 0 },
    high: { freq: high[0], gain: high[1], decay: high[2] ?? 0 },
    diffusion: { amount: diffusion[0], size: diffusion[1], loop: diffusion[2] },
    wobble: { depth: wobble[0], rate: wobble[1], shape: wobble[2], sync: wobble[3] ?? 0, feedback: wobble[4] ?? true, out: wobble[5] ?? false },
    saturation: { decay: saturation[0], out: saturation[1], type: saturation[2] },
  };
}

/** A style: its name, what it models (said in its menu and to the assistant), and its settings. */
export interface NamedStyle {
  name: string;
  about: string;
  settings: EchoStyle;
}

export const ECHO_STYLES: readonly NamedStyle[] = [
  {
    name: "Master Tape",
    about: "Ampex ATR-102 at 30 ips: hi-fi, subtle tape compression, saturates smoothly",
    settings: style({ low: [30, -2, -9], mid: [90, 0, 1], high: [12_000, -1, -7], wobble: [1, 0.4, "randomWalk", 0.3], saturation: [2, 0, "tape"] }),
  },
  {
    name: "Studio Tape",
    about: "ATR-102 at 15 ips: tracking to studio tape, high frequencies compressed (de-esses loud vocals)",
    settings: style({ low: [45, -2, -11], mid: [55, 0, 1.5], high: [8000, -1.5, -11], wobble: [1.5, 0.5, "randomWalk", 0.3], saturation: [4, 1, "tape"] }),
  },
  {
    name: "EchoPlex",
    about: "Maestro Echoplex EP-3: repeats lose their lows and gain a shiny, gritty top",
    settings: style({ low: [150, -6, -16], mid: [3000, 3, 2, 4], high: [7000, -9, -15], wobble: [5, 3.5, "randomWalk", 0.4], saturation: [7, 3, "warm"] }),
  },
  {
    name: "Space Echo",
    about: "Roland RE-201: warm and gritty, dub and reggae, self-oscillates with Feedback up",
    settings: style({ low: [110, -6, -14], mid: [1500, -6, 1], high: [4500, -10, -16], wobble: [5, 0.9, "randomWalk", 0.5], saturation: [9, 3, "tape"] }),
  },
  {
    name: "Tube Tape",
    about: "A modern tube tape echo: lots of high mids and distortion",
    settings: style({ low: [140, -7, -10], mid: [2000, 3, 3.5, 4.6], high: [7000, -8, -14], wobble: [2, 0.6, "randomWalk", 0.3], saturation: [8, 4, "warm"] }),
  },
  {
    name: "Cheap Tape",
    about: "Vintage consumer tape stock: bright and very compressed",
    settings: style({ low: [180, -8, -11], mid: [1200, 0, 3, 5.2], high: [5000, 2, -16], wobble: [3.5, 0.8, "randomWalk", 0.4], saturation: [10, 8, "softLimit"] }),
  },
  {
    name: "Memory Man",
    about: "Electro-Harmonix Memory Man (bucket brigade): a warm, low-bandwidth chorus echo",
    settings: style({ low: [80, -4, -11], mid: [2600, 6, 1], high: [2800, -24, -18], wobble: [10, 0.8, "triangle", 0.6], saturation: [4, 2, "softLimit"] }),
  },
  {
    name: "DM-2",
    about: "Boss DM-2 (bucket brigade): THE guitar echo, warm, resonant, punchy but clean",
    settings: style({ low: [90, -5, -11], mid: [2900, 12, 3, 4.6], high: [3300, -22, -18], wobble: [0.5, 0.3, "sine", 0.2], saturation: [2, 0, "clean"] }),
  },
  {
    name: "TelRay",
    about: "Tel-Ray oil can: the ultra-dark, liquid, warbling echo",
    settings: style({ low: [200, -10, -13], mid: [900, 0, 2], high: [1800, -20, -23], diffusion: [0.3, 2, true], wobble: [15, 4, "randomWalk", -0.5], saturation: [5, 2, "warm"] }),
  },
  {
    name: "Binsonette",
    about: "Binson Echorec units: a warbly, compressed echo, for guitar and keys",
    settings: style({ low: [110, -6, -11], mid: [1000, 0, 1.5], high: [4500, -14, -18], diffusion: [0.15, 3, true], wobble: [8, 3, "sine", 0.3], saturation: [6, 3, "warmLimit"] }),
  },
  {
    name: "Telephone",
    about: "The narrowband telephone voice (300 Hz to 3.4 kHz)",
    settings: style({ low: [300, -40], mid: [1500, 0, 4], high: [3400, -40], saturation: [4, 6, "dirt"] }),
  },
  {
    name: "AM Radio",
    about: "The compressed medium bandwidth of AM radio",
    settings: style({ low: [150, -30], mid: [1800, -3, 3], high: [4500, -30], saturation: [8, 10, "hardLimit"] }),
  },
  {
    name: "FM Radio",
    about: "Ultra-compressed and loud, like a morning show DJ",
    settings: style({ low: [35, -12], mid: [3000, -6, 2], high: [12_000, -12], saturation: [12, 14, "brightLimit"] }),
  },
  {
    name: "Shortwave",
    about: "An exaggerated long-distance radio: very narrow and staccato",
    settings: style({ low: [350, -40], mid: [1300, 6, 4], high: [2600, -40], wobble: [6, 0.3, "randomWalk", -0.3], saturation: [10, 10, "pump"] }),
  },
  {
    name: "Transmitter",
    about: "CB radio: very distorted and resonant in the mids, echo grit for synths",
    settings: style({ low: [400, -30], mid: [1300, 18, 8, 4.6], high: [2500, -30], saturation: [14, 12, "dirt"] }),
  },
  {
    name: "Digital Delay",
    about: "Just clean and clear digital delay",
    settings: style({ saturation: [0, 0, "clean"] }),
  },
  {
    name: "Analog Delay",
    about: "1970s and 80s rack analogue delays: warm and lightly distorted",
    settings: style({ low: [60, -3, -9], mid: [3000, 0, 0.5], high: [6000, -10, -15], wobble: [1, 0.5, "randomWalk", 0.3], saturation: [4, 2, "warm"] }),
  },
  {
    name: "DigitalChorus",
    about: "An 1980s digital chorus: present and clear, compromised in just the right way",
    settings: style({ high: [10_000, -3], wobble: [12, 1.2, "sine", 1], saturation: [0, 0, "clean"] }),
  },
  {
    name: "Analog Chorus",
    about: "A great all-round warm chorus",
    settings: style({ low: [80, -2], high: [8000, -8, -11], wobble: [15, 0.8, "triangle", 1], saturation: [2, 1, "warm"] }),
  },
  {
    name: "CE-1 Chorus",
    about: "Boss CE-1 Chorus Ensemble: beautiful on guitars",
    settings: style({ low: [100, -3], mid: [1000, 0, 1], high: [9000, -9, -11], wobble: [12, 2, "sine", 1], saturation: [3, 1, "warm"] }),
  },
  {
    name: "Vibrato",
    about: "True pitch vibrato, for keys and guitars",
    settings: style({ wobble: [30, 5, "sine", 0, false, true], saturation: [0, 0, "clean"] }),
  },
  {
    name: "Saturated",
    about: "Exaggerated tape distortion, for vocals and drums",
    settings: style({ low: [45, -2, -11], mid: [55, 0, 1.5], high: [8000, -2, -13], wobble: [1.5, 0.5, "randomWalk", 0.3], saturation: [14, 10, "tape"] }),
  },
  {
    name: "Fat",
    about: "Super-warm distorted echoes: a thick bed of echo",
    settings: style({ low: [150, 3], mid: [400, -6, 2], high: [5000, -6, -11], wobble: [1, 0.4, "randomWalk"], saturation: [12, 8, "warm"] }),
  },
  {
    name: "Distressed",
    about: "Highly compressed and distorted echoes",
    settings: style({ low: [120, -4, -9], mid: [1500, 0, 3], high: [5000, -6, -13], wobble: [2, 0.7, "randomWalk", 0.3], saturation: [14, 12, "pump"] }),
  },
  {
    name: "Limited",
    about: "A limiter on the echoes, great with high Feedback: Saturation becomes its threshold, and it pumps",
    settings: style({ low: [40, -1, -6], high: [10_000, -1.5, -9], saturation: [6, 6, "hardLimit"] }),
  },
  {
    name: "Distorted",
    about: "Distortion, and lots of it",
    settings: style({ low: [100, -3, -9], mid: [1800, 3, 4], high: [6000, -8, -11], saturation: [20, 18, "dirt"] }),
  },
  {
    name: "Queeked",
    about: "An odd but very cool squeezed, resonant echo, very effect-laden",
    settings: style({ low: [250, -6, -9], mid: [1200, 18, 6, -9], high: [3000, 4, -16], wobble: [2, 1.5, "randomWalk", -0.4], saturation: [16, 14, "pump"] }),
  },
  {
    name: "Ambient",
    about: "Distortion and diffusion together: for long feedback and solo instruments",
    settings: style({ low: [60, -2, -6], high: [6000, -4, -13], diffusion: [0.6, 20, true], wobble: [3, 0.4, "randomWalk", 0.5], saturation: [6, 3, "warm"] }),
  },
  {
    name: "Diffused",
    about: "Ambient, reverb-like echoes",
    settings: style({ low: [40, -1, -6], high: [8000, -3, -9], diffusion: [0.75, 35, true], wobble: [1, 0.3, "randomWalk", 0.5], saturation: [2, 0, "clean"] }),
  },
  {
    name: "Splattered",
    about: "A highly reflective, verby reflection on each echo",
    settings: style({ low: [60, -2, -6], high: [7000, -4, -11], diffusion: [0.85, 8, false], saturation: [3, 2, "tape"] }),
  },
  {
    name: "Verbed",
    about: "Echo with a cheap verb chaser after it, responsive to Feedback and Saturation",
    settings: style({ low: [80, -3, -9], high: [5000, -5, -11], diffusion: [1, 50, false], wobble: [1, 0.3, "randomWalk", 0.5], saturation: [6, 6, "warm"] }),
  },
];

export const DEFAULT_STYLE = "Studio Tape";

/** A style's settings, by name (the default's for a name that isn't one). */
export function styleNamed(name: string): EchoStyle {
  return (ECHO_STYLES.find((s) => s.name === name) ?? ECHO_STYLES.find((s) => s.name === DEFAULT_STYLE)!).settings;
}
