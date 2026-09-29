/** 3D: the pictures turn, fold and flip in perspective. */
import type { ChoiceSpec, ParamSpec } from "../effects.ts";
import type { TransitionDefinition } from "../transitions.ts";

const direction = (value: string, options = ["left", "right", "up", "down"]): ChoiceSpec => ({
  kind: "choice",
  key: "direction",
  label: "Direction",
  default: value,
  options: options.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
});

/**
 * Shared by the shaders below. Scenes are built in frame units: the frame is
 * 1 high and `ratio` wide, centred on the origin in the plane z = 0, and the
 * eye looks down -z from (0, 0, LENS + back). With back = 0 the plane z = 0
 * exactly fills the frame, so a picture lying there at rest is drawn 1:1.
 */
const CAMERA = `
const float LENS = 1.8;
vec3 viewRay(vec2 p) { return vec3(p, -LENS); }
// Smooth in and out, gentler than ease() through the middle, for big turns.
float glide(float t) { t = clamp(t, 0.0, 1.0); return mix(ease(t), t * t * (3.0 - 2.0 * t), 0.5); }
// Ray against a rectangle (centre c, half-size vectors u and v, at right angles): the ray's t (-1 on a miss) and where it hit in -1..1.
float hitRect(vec3 ro, vec3 rd, vec3 c, vec3 u, vec3 v, out vec2 st) {
  vec3 n = cross(u, v);
  float dn = dot(rd, n);
  st = vec2(2.0);
  if (abs(dn) < 1e-9) return -1.0;
  float t = dot(c - ro, n) / dn;
  vec3 q = ro + rd * t - c;
  st = vec2(dot(q, u) / dot(u, u), dot(q, v) / dot(v, v));
  return t > 0.0 && abs(st.x) <= 1.0 && abs(st.y) <= 1.0 ? t : -1.0;
}
// Light on a face by how squarely it faces the viewer (1 when flat on).
float faceLight(float facing) { return 0.3 + 0.7 * clamp(facing, 0.0, 1.0); }
vec4 lit(vec4 c, float k) { return vec4(c.rgb * k, c.a); }
// A point of the frame (frame units) to uv.
vec2 frameUv(vec2 q) { return q / vec2(ratio, 1.0) + 0.5; }
`;

/**
 * Four samples a pixel (rotated grid) for smooth edges, calling the
 * transition's \`scene(p)\`. The samples close up at the very ends so the
 * first and last frames are exactly the pictures.
 */
const SUPERSAMPLE = `
vec4 transition(vec2 uv) {
  vec2 p = aspect(uv);
  float k = clamp(min(progress, 1.0 - progress) * 40.0, 0.0, 1.0) / resolution.y;
  vec2 a = vec2(0.125, 0.375) * k;
  vec2 b = vec2(0.375, -0.125) * k;
  return 0.25 * (scene(p + a) + scene(p - a) + scene(p + b) + scene(p - b));
}`;

/**
 * A faint reflection in a floor under the pictures (y = -0.5), faded in and
 * out with the move. Needs \`vec4 trace(vec3 ro, vec3 rd, out float hitY)\`.
 */
const FLOOR = `
vec4 withFloor(vec3 ro, vec3 rd) {
  float hitY;
  vec4 c = trace(ro, rd, hitY);
  float strength = 0.2 * smoothstep(0.0, 0.2, progress) * smoothstep(0.0, 0.2, 1.0 - progress);
  if (c.a < 1.0 && rd.y < 0.0 && strength > 0.0) {
    vec3 f = ro + rd * ((-0.5 - ro.y) / rd.y);
    vec4 r = trace(f, vec3(rd.x, -rd.y, rd.z), hitY);
    c += (1.0 - c.a) * r * strength * (1.0 - smoothstep(0.0, 0.45, hitY + 0.5));
  }
  return c;
}`;

const threeD = (glsl: string, { floor = false } = {}) =>
  floor
    ? `${CAMERA}\nvec4 trace(vec3 ro, vec3 rd, out float hitY);\nvec4 withFloor(vec3 ro, vec3 rd);\n${glsl}${FLOOR}${SUPERSAMPLE}`
    : `${CAMERA}${glsl}${SUPERSAMPLE}`;

const noParams: ParamSpec[] = [];

export const THREE_D: TransitionDefinition[] = [
  {
    type: "cube",
    label: "Cube",
    tags: ["3d"],
    duration: 0.8,
    params: [direction("left")],
    glsl: threeD(
      `
// The pictures are two sides of a box (square in section) that turns a
// quarter turn about its centre, the outgoing one moving towards "direction";
// the camera backs off mid-turn so the near edge stays in frame.
vec2 dv;
vec2 dn;
float hs;   // half the box's depth (= half the picture along the turn)
float hp;   // half the picture across the turn
float cs;
float sn;
// World (relative to the box's centre) into the box's own frame.
vec3 toBox(vec3 w) {
  float x1 = dot(w.xy, dv);
  vec2 rest = w.xy - x1 * dv;
  return vec3(rest + (x1 * cs - w.z * sn) * dv, x1 * sn + w.z * cs);
}
vec4 trace(vec3 ro, vec3 rd, out float hitY) {
  vec3 o = toBox(ro - vec3(0.0, 0.0, -hs));
  vec3 d = toBox(rd);
  hitY = 0.0;
  // Outgoing side: the box's front (z = hs).
  if (d.z < 0.0) {
    float t = (hs - o.z) / d.z;
    vec3 h = o + d * t;
    if (t > 0.0 && abs(dot(h.xy, dv)) <= hs && abs(dot(h.xy, dn)) <= hp) {
      hitY = (ro + rd * t).y;
      return lit(getFromColor(frameUv(h.xy)), faceLight(cs));
    }
  }
  // Incoming side: the one facing away from "direction".
  float da = dot(d.xy, dv);
  if (da > 0.0) {
    float t = (-hs - dot(o.xy, dv)) / da;
    vec3 h = o + d * t;
    float across = dot(h.xy, dn);
    if (t > 0.0 && abs(h.z) <= hs && abs(across) <= hp) {
      hitY = (ro + rd * t).y;
      return lit(getToColor(frameUv(across * dn + h.z * dv)), faceLight(sn));
    }
  }
  return vec4(0.0);
}
vec4 scene(vec2 p) {
  float e = glide(progress);
  float a = e * PI * 0.5;
  cs = cos(a);
  sn = sin(a);
  dv = dirVec(direction);
  dn = vec2(-dv.y, dv.x);
  bool across = direction < 2;
  hs = across ? ratio * 0.5 : 0.5;
  hp = across ? 0.5 : ratio * 0.5;
  float back = sin(PI * e) * (0.15 + 0.45 * hs);
  vec3 ro = vec3(0.0, 0.0, LENS + back);
  vec3 rd = viewRay(p);
  if (across) return withFloor(ro, rd);
  float hitY;
  return trace(ro, rd, hitY);
}`,
      { floor: true },
    ),
  },
  {
    type: "flip",
    label: "Flip",
    tags: ["3d"],
    duration: 0.8,
    params: [
      {
        kind: "choice",
        key: "axis",
        label: "Axis",
        default: "horizontal",
        options: [
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ],
      },
    ],
    glsl: threeD(`
// A card with the outgoing picture on its front and the incoming one on its
// back, turned half over about its centre line (sideways for Horizontal,
// head over heels for Vertical); the camera backs off mid-flip.
vec4 scene(vec2 p) {
  float e = glide(progress);
  float a = e * PI;
  float c = cos(a);
  float s = sin(a);
  bool sideways = axis == 0;
  float hx = ratio * 0.5;
  vec3 u = sideways ? vec3(hx * c, 0.0, -hx * s) : vec3(hx, 0.0, 0.0);
  vec3 v = sideways ? vec3(0.0, 0.5, 0.0) : vec3(0.0, 0.5 * c, 0.5 * s);
  float reach = sideways ? hx : 0.5;
  float back = sin(PI * e) * (0.2 + 0.6 * reach);
  vec3 ro = vec3(0.0, 0.0, LENS + back);
  vec3 rd = viewRay(p);
  vec2 st;
  if (hitRect(ro, rd, vec3(0.0), u, v, st) < 0.0) return vec4(0.0);
  float k = faceLight(abs(c));
  if (dot(rd, cross(u, v)) < 0.0) return lit(getFromColor(st * 0.5 + 0.5), k);
  // The back, turned the right way round once the card is over.
  return lit(getToColor((sideways ? vec2(-st.x, st.y) : vec2(st.x, -st.y)) * 0.5 + 0.5), k);
}`),
  },
  {
    type: "page-curl",
    label: "Page Curl",
    tags: ["3d"],
    duration: 1,
    params: [
      {
        kind: "choice",
        key: "corner",
        label: "Corner",
        default: "bottom-right",
        options: [
          { value: "bottom-right", label: "Bottom Right" },
          { value: "bottom-left", label: "Bottom Left" },
          { value: "top-right", label: "Top Right" },
          { value: "top-left", label: "Top Left" },
        ],
      },
    ],
    glsl: `${CAMERA}
// The outgoing picture is a page peeled from a corner: past the fold line it
// wraps round a cylinder lying on it and comes back over the top face down
// (showing its back: mirrored, pale), while the fold sweeps to the far corner.
// Worked in frame units along the fold's travel: x towards the corner, y along the fold.
vec2 dir;
vec2 fold;
vec2 hsz;
float L;
float R;
float sdBox(vec2 q, vec2 b) {
  vec2 d = abs(q) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
// The page's point x along, y across (frame units).
vec2 pagePoint(float x, float y) { return x * dir + y * fold; }
float offPage(float x, float y) { return sdBox(pagePoint(x, y), hsz); }
// Distance to what's lifted off the page (the curl and the part laid back over), for its shadow.
float liftedDistance(float x, float y) {
  float laid = max(x - L, offPage(2.0 * L + PI * R - x, y));
  float curl = max(max(x - L - R, L - x), offPage(x, y));
  return min(laid, curl);
}
// The back of the page: the picture showing through pale paper.
vec4 backOf(vec4 c) {
  vec3 g = mix(vec3(luma(c)), c.rgb, 0.5);
  return vec4(mix(g, vec3(c.a), 0.42), c.a);
}
// Light on the paper by its normal (n.x along the travel, n.y up): soft,
// with a little sheen near the top of the curl.
float paperLight(vec2 n, float lo) {
  float spec = pow(max(dot(n, normalize(vec2(-0.2, 1.0))), 0.0), 40.0);
  return mix(lo, 1.0, n.y) + 0.08 * spec;
}
vec4 transition(vec2 uv) {
  vec2 p = aspect(uv);
  float px = 1.0 / resolution.y;
  vec2 sg = corner == 0 ? vec2(1.0, -1.0) : corner == 1 ? vec2(-1.0, -1.0) : corner == 2 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
  hsz = vec2(ratio * 0.5, 0.5);
  dir = normalize(sg * vec2(1.0, 0.55));
  fold = vec2(-dir.y, dir.x);
  float xmax = dot(hsz * sg, dir);
  float t = progress;
  t = mix(t, t * t * (3.0 - 2.0 * t), 0.7);
  R = mix(0.06, 0.14, t);
  float reach = 0.1;
  float Lend = -xmax - 0.14 - reach;
  L = mix(xmax, Lend, t);
  float x = dot(p, dir);
  float y = dot(p, fold);

  // What lies on the table: the rest of the page, else the incoming picture, shadowed by what's lifted.
  float shadowK = 0.6 * clamp((xmax - L) / 0.15, 0.0, 1.0) * clamp((L - Lend) / 0.15, 0.0, 1.0);
  float sd = liftedDistance(x - 0.012, y + 0.006);
  float shade = 1.0 - shadowK * pow(1.0 - smoothstep(0.0, reach, sd), 2.0);
  vec4 col;
  if (x < L) {
    col = lit(getFromColor(uv), shade);
  } else {
    col = lit(getToColor(uv), shade);
    // The underside of the curl, seen face up past the top of the cylinder.
    float u = clamp((x - L) / R, 0.0, 1.0);
    float xo = L + R * asin(u);
    float cover = clamp(0.5 - max(offPage(xo, y), x - L - R) / px, 0.0, 1.0);
    vec4 face = lit(getFromColor(frameUv(pagePoint(xo, y))), paperLight(vec2(-u, sqrt(1.0 - u * u)), 0.45));
    col = mix(col, face, cover);
  }

  // On top: the curl's upper half and the part laid back, both showing the page's back.
  float xo;
  vec2 n;
  float edge;
  if (x < L) {
    xo = 2.0 * L + PI * R - x;
    n = vec2(0.0, 1.0);
    edge = offPage(xo, y);
  } else {
    float u = clamp((x - L) / R, 0.0, 1.0);
    xo = L + R * (PI - asin(u));
    n = vec2(u, sqrt(1.0 - u * u));
    edge = max(offPage(xo, y), x - L - R);
  }
  float cover = clamp(0.5 - edge / px, 0.0, 1.0);
  if (cover > 0.0) {
    vec4 back = lit(backOf(getFromColor(frameUv(pagePoint(xo, y)))), paperLight(n, 0.6));
    col = mix(col, back, cover);
  }
  return col;
}`,
  },
  {
    type: "doorway",
    label: "Doorway",
    tags: ["3d"],
    duration: 1,
    params: noParams,
    glsl: threeD(`
// The outgoing picture splits down the middle into two doors, hinged at the
// frame's sides, that swing open towards the viewer; the incoming picture
// comes forward out of the dark behind them.
vec4 scene(vec2 p) {
  vec3 ro = vec3(0.0, 0.0, LENS);
  vec3 rd = viewRay(p);
  float hx = ratio * 0.5;
  float a = glide(progress / 0.9) * PI * 0.56;
  float c = cos(a);
  float s = sin(a);
  vec3 v = vec3(0.0, 0.5, 0.0);
  float k = faceLight(c);
  vec2 st;
  vec3 ul = 0.5 * hx * vec3(c, 0.0, s);
  if (hitRect(ro, rd, vec3(-hx, 0.0, 0.0) + ul, ul, v, st) > 0.0) {
    return lit(getFromColor(vec2((st.x + 1.0) * 0.25, st.y * 0.5 + 0.5)), k);
  }
  vec3 ur = 0.5 * hx * vec3(-c, 0.0, s);
  if (hitRect(ro, rd, vec3(hx, 0.0, 0.0) + ur, ur, v, st) > 0.0) {
    return lit(getFromColor(vec2(1.0 - (st.x + 1.0) * 0.25, st.y * 0.5 + 0.5)), k);
  }
  float e = mix(ease(progress), easeOut(progress), 0.5);
  float z = LENS * (1.0 - 1.0 / mix(0.6, 1.0, e));
  if (hitRect(ro, rd, vec3(0.0, 0.0, z), vec3(hx, 0.0, 0.0), v, st) > 0.0) {
    return lit(getToColor(st * 0.5 + 0.5), mix(0.2, 1.0, smoothstep(0.0, 1.0, e)));
  }
  return vec4(0.0);
}`),
  },
  {
    type: "fold",
    label: "Fold",
    tags: ["3d"],
    duration: 0.7,
    params: [direction("left")],
    glsl: threeD(`
// The outgoing picture swings away into the screen on a hinge along the
// "direction" edge, uncovering the incoming one (which it stays in front of).
vec4 scene(vec2 p) {
  vec3 ro = vec3(0.0, 0.0, LENS);
  vec3 rd = viewRay(p);
  vec2 dv = dirVec(direction);
  vec2 dn = vec2(-dv.y, dv.x);
  bool across = direction < 2;
  float ha = across ? ratio * 0.5 : 0.5;
  float hp = across ? 0.5 : ratio * 0.5;
  float e = ease(progress);
  // Past a quarter turn it's still in view (as a wall going into the screen)
  // until its plane lines up with the eye.
  float a = e * (PI * 0.5 + atan(ha / LENS) + 0.02);
  // From the hinge to the picture's centre, turned into the screen.
  vec3 w = vec3(-dv * ha * cos(a), -ha * sin(a));
  vec3 hinge = vec3(dv * ha, 0.0);
  vec2 st;
  vec4 under = lit(getToColor(p / vec2(ratio, 1.0) + 0.5), mix(0.5, 1.0, e));
  if (hitRect(ro, rd, hinge + w, -w, vec3(dn * hp, 0.0), st) > 0.0) {
    vec4 top = lit(getFromColor(frameUv(st.x * dv * ha + st.y * dn * hp)), faceLight(cos(a)));
    return top + (1.0 - top.a) * under;
  }
  return under;
}`),
  },
  {
    type: "swing",
    label: "Swing",
    tags: ["3d"],
    duration: 0.8,
    params: [direction("right")],
    glsl: threeD(`
// The incoming picture swings in over the outgoing one on a hinge along the
// edge it comes from, like a door closing towards the viewer, and settles
// with a little overshoot; the outgoing picture dims underneath.
vec4 scene(vec2 p) {
  vec3 ro = vec3(0.0, 0.0, LENS);
  vec3 rd = viewRay(p);
  vec2 dv = dirVec(direction);
  vec2 dn = vec2(-dv.y, dv.x);
  bool across = direction < 2;
  float ha = across ? ratio * 0.5 : 0.5;
  float hp = across ? 0.5 : ratio * 0.5;
  // In and out with a little overshoot each end (ease-in-out "back"): it
  // starts past edge-on to the eye (out of view, see Fold) and settles flat.
  float x = clamp(progress, 0.0, 1.0);
  float c = 1.1;
  float e = x < 0.5
    ? 2.0 * x * x * ((c + 1.0) * 2.0 * x - c)
    : 1.0 + 2.0 * (x - 1.0) * (x - 1.0) * ((c + 1.0) * (2.0 * x - 2.0) + c);
  float a = (1.0 - e) * (PI * 0.5 + atan(ha / LENS) + 0.02);
  vec3 w = vec3(dv * ha * cos(a), -ha * sin(a));
  vec3 hinge = vec3(-dv * ha, 0.0);
  vec2 st;
  vec4 under = lit(getFromColor(p / vec2(ratio, 1.0) + 0.5), mix(1.0, 0.5, smoothstep(0.0, 1.0, progress)));
  if (hitRect(ro, rd, hinge + w, -w, vec3(dn * hp, 0.0), st) > 0.0) {
    vec4 top = lit(getToColor(frameUv(-st.x * dv * ha + st.y * dn * hp)), faceLight(cos(a)));
    return top + (1.0 - top.a) * under;
  }
  return under;
}`),
  },
  {
    type: "tile-flip",
    label: "Tile Flip",
    tags: ["3d", "wipe"],
    duration: 1.2,
    params: [
      { kind: "number", key: "columns", label: "Columns", default: 5, min: 2, max: 20, step: 1, decimals: 0, slider: true },
    ],
    glsl: threeD(`
// A grid of tiles, each a little card (outgoing picture on the front,
// incoming on the back) flipping over about its own centre line, in a
// diagonal wave from the top left. A tile's corner can poke into its
// neighbours' cells in perspective, so each pixel tries its cell's neighbours too.
vec4 scene(vec2 p) {
  vec3 ro = vec3(0.0, 0.0, LENS);
  vec3 rd = viewRay(p);
  float cols = max(1.0, floor(columns + 0.5));
  float rows = max(1.0, floor(cols / ratio + 0.5));
  vec2 cell = vec2(ratio / cols, 1.0 / rows);
  vec2 frame = vec2(ratio, 1.0);
  vec2 home = floor((p + frame * 0.5) / cell);
  float best = 1e9;
  vec4 col = vec4(0.0);
  float spread = 0.55;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = home + vec2(float(i), float(j));
      if (id.x < 0.0 || id.y < 0.0 || id.x >= cols || id.y >= rows) continue;
      float order = (id.x + rows - 1.0 - id.y) / max(1.0, cols + rows - 2.0);
      float a = ease((progress - order * spread) / (1.0 - spread)) * PI;
      float c = cos(a);
      float s = sin(a);
      vec2 centre = (id + 0.5) * cell - frame * 0.5;
      vec2 hs = cell * 0.5;
      float shrink = 1.0 - 0.1 * s * s;
      vec3 u = vec3(hs.x * c, 0.0, -hs.x * s) * shrink;
      vec3 v = vec3(0.0, hs.y, 0.0) * shrink;
      vec2 st;
      float t = hitRect(ro, rd, vec3(centre, 0.0), u, v, st);
      if (t > 0.0 && t < best) {
        best = t;
        bool front = dot(rd, cross(u, v)) < 0.0;
        vec2 q = centre + (front ? st : vec2(-st.x, st.y)) * hs;
        col = lit(front ? getFromColor(frameUv(q)) : getToColor(frameUv(q)), faceLight(abs(c)));
      }
    }
  }
  return col;
}`),
  },
  {
    type: "carousel",
    label: "Carousel",
    tags: ["3d"],
    duration: 0.9,
    params: [direction("left", ["left", "right"])],
    glsl: threeD(
      `
// Cover flow: the pictures are cards in a row whose side cards stand back
// and turn to face the middle. The row moves one card towards "direction":
// A slides off to that side, back and round, as B comes round into the
// middle from the other; the camera backs off to take both in.
float side;
void card(vec3 ro, vec3 rd, float slot, bool incoming, inout float best, inout vec4 col) {
  float hx = ratio * 0.5;
  float k = min(abs(slot), 1.0);
  float theta = -sign(slot) * 1.2 * k;
  vec3 centre = vec3(slot * (1.7 * hx + 0.08), 0.0, -(0.35 + 0.6 * hx) * sin(k * PI * 0.5));
  vec3 facing = vec3(sin(theta), 0.0, cos(theta));
  vec3 u = hx * vec3(cos(theta), 0.0, -sin(theta));
  vec2 st;
  float t = hitRect(ro, rd, centre, u, vec3(0.0, 0.5, 0.0), st);
  if (t < 0.0 || t > best) return;
  best = t;
  vec2 q = st * 0.5 + 0.5;
  // A card's back, never quite in view.
  if (dot(rd, facing) > 0.0) col = vec4(0.0, 0.0, 0.0, 0.85);
  else col = lit(incoming ? getToColor(q) : getFromColor(q), faceLight(facing.z));
}
float slide;
vec4 trace(vec3 ro, vec3 rd, out float hitY) {
  float best = 1e9;
  vec4 col = vec4(0.0);
  card(ro, rd, -side * slide, false, best, col);
  card(ro, rd, side * (1.0 - slide), true, best, col);
  hitY = best < 1e9 ? (ro + rd * best).y : 0.0;
  return col;
}
vec4 scene(vec2 p) {
  slide = glide(progress);
  side = direction == 0 ? 1.0 : -1.0;
  float back = sin(PI * slide) * (0.35 + 0.5 * ratio);
  return withFloor(vec3(0.0, 0.0, LENS + back), viewRay(p));
}`,
      { floor: true },
    ),
  },
];
