/**
 * The visualizer's 3D model search (docs/now-playing.md, "Your media"): the sites it looks in, what a result's origin
 * is, and the starter pack, a set of free models it offers before anything's searched.
 */
import type { ModelResult, ModelSource } from "./types.ts";

export interface ModelSite {
  name: string;
  home: string;
  /** Where its API key is made, for the panel's link. */
  keyPage: string;
  /** What the panel calls the key. */
  keyName: string;
}

export const MODEL_SITES: Record<ModelSource, ModelSite> = {
  "poly-pizza": {
    name: "Poly Pizza",
    home: "https://poly.pizza",
    keyPage: "https://poly.pizza/settings/api",
    keyName: "API key",
  },
  sketchfab: {
    name: "Sketchfab",
    home: "https://sketchfab.com",
    keyPage: "https://sketchfab.com/settings/password",
    keyName: "API token",
  },
};

export const MODEL_SOURCES = Object.keys(MODEL_SITES) as ModelSource[];

export const isModelSource = (value: unknown): value is ModelSource =>
  typeof value === "string" && Object.hasOwn(MODEL_SITES, value);

/** A downloaded model's `MediaAsset.origin`: the Library downloads each only once. */
export const modelOrigin = (source: ModelSource, id: string) => `model:${source}:${id}`;

/** A model site's page of one of its models. */
export function modelPage(source: ModelSource, id: string): string {
  return source === "poly-pizza" ? `https://poly.pizza/m/${id}` : `https://sketchfab.com/3d-models/${id}`;
}

interface StarterModel {
  id: string;
  title: string;
  author: string;
  licence: string;
  /** Its files' name on Poly Pizza's file server (`<file>.glb`, `<file>.webp`). */
  file: string;
  animated?: true;
  triangles: number;
  size: number;
}

/** Poly Pizza's file server: its models' files need no key. */
const POLY_FILES = "https://static.poly.pizza";

/**
 * The starter pack: characters and animals that move (Quaternius's, mostly CC0, each with idle, dance or flying
 * animations) and things that sit and spin (food, music gear, space). All Poly Pizza's, under 2 MB each, about 20 MB
 * in all; downloaded the first time the visualizer's media are opened.
 */
const STARTER: StarterModel[] = [
  { id: "QCm7qe9uNJ", title: "Animated Robot", author: "Quaternius", licence: "CC0 1.0", file: "7d95dbce-8c73-489b-8298-f430b1f0dbdf", animated: true, triangles: 1425, size: 401024 },
  { id: "DgOCW9ZCRJ", title: "Character Animated", author: "Quaternius", licence: "CC0 1.0", file: "1a8a9d55-9aa9-43c4-a031-d926e251d80a", animated: true, triangles: 1246, size: 660208 },
  { id: "5EGWBMpuXq", title: "Adventurer", author: "Quaternius", licence: "CC0 1.0", file: "bbe369ee-a686-42c7-adad-14356f5f2f15", animated: true, triangles: 3388, size: 1944116 },
  { id: "3hC2i0CTuO", title: "Astronaut", author: "Quaternius", licence: "CC0 1.0", file: "0076345b-bbea-42d5-931c-4a5ad2050b18", animated: true, triangles: 5324, size: 1944976 },
  { id: "HYUUkdugoP", title: "Alien", author: "Quaternius", licence: "CC0 1.0", file: "678f2de4-d13d-497e-b993-8debb95424a5", animated: true, triangles: 3774, size: 751172 },
  { id: "y4wdQpg767", title: "Shiba Inu", author: "Quaternius", licence: "CC0 1.0", file: "ba6d0ee3-bcc0-4ef0-9d3c-a3e245b41c77", animated: true, triangles: 1812, size: 851196 },
  { id: "Bc97C66HKi", title: "Fox", author: "Quaternius", licence: "CC0 1.0", file: "e18e86df-1692-48d8-ac6e-1e25ab4ad574", animated: true, triangles: 1826, size: 960228 },
  { id: "9Z2V8fpazF", title: "Frog", author: "Quaternius", licence: "CC0 1.0", file: "08416495-b056-4ed7-b23b-5a10e82277a0", animated: true, triangles: 4920, size: 587360 },
  { id: "irZjWFARyl", title: "Bunny", author: "Quaternius", licence: "CC0 1.0", file: "084b5ebe-c3eb-4e64-9b17-06e2d1e3da5d", animated: true, triangles: 5948, size: 538360 },
  { id: "q1uJ28Hs8T", title: "Panda", author: "Quaternius", licence: "CC0 1.0", file: "fb175c69-6c26-452a-87fe-16a1a9aa99a7", animated: true, triangles: 2280, size: 625748 },
  { id: "ineV9pU5VL", title: "Chicken", author: "Quaternius", licence: "CC0 1.0", file: "a0001762-9352-48c3-9abd-be91e42db114", animated: true, triangles: 2648, size: 140112 },
  { id: "26zM1outCr", title: "Cow", author: "Quaternius", licence: "CC0 1.0", file: "382b3d4a-a7c9-4c03-9858-3df630d90047", animated: true, triangles: 2130, size: 1028584 },
  { id: "tQdzbZ1Cmw", title: "Stag", author: "Quaternius", licence: "CC0 1.0", file: "a9c69fbc-bf7c-4585-9a49-a82e0be1ac6b", animated: true, triangles: 1933, size: 1044172 },
  { id: "qvTrSG9pZF", title: "Horse", author: "Quaternius", licence: "CC0 1.0", file: "d37dbc87-ca61-4b2c-a2da-d2f0c4240bef", animated: true, triangles: 1874, size: 1108124 },
  { id: "YYsK3gRCBZ", title: "Shark", author: "Quaternius", licence: "CC0 1.0", file: "840dac4f-e6b5-4015-88d7-ceb940a4b90e", animated: true, triangles: 3556, size: 527836 },
  { id: "VBvzjFIYws", title: "Dragon", author: "Quaternius", licence: "CC0 1.0", file: "9714f533-5d2d-4cfd-b8f1-c8dfff64a672", animated: true, triangles: 1088, size: 268896 },
  { id: "wuerCFCWNR", title: "Dino", author: "Quaternius", licence: "CC0 1.0", file: "1c1ae302-b948-4de4-961a-44f762b722cf", animated: true, triangles: 4318, size: 404176 },
  { id: "hNO9XvjlKa", title: "Bat", author: "Quaternius", licence: "CC0 1.0", file: "4ae13ae9-c257-41ed-86b5-1b4760924ebc", animated: true, triangles: 772, size: 231476 },
  { id: "6HsU6GQt3a", title: "Bee Enemy", author: "Quaternius", licence: "CC0 1.0", file: "19203489-125b-41f5-b9c9-801a522cb775", animated: true, triangles: 2560, size: 193200 },
  { id: "Iip30bDHmu", title: "Ghost", author: "Quaternius", licence: "CC0 1.0", file: "810f60a2-6e45-4c4e-a0d5-da91cd7288bd", animated: true, triangles: 2056, size: 203360 },
  { id: "wODZYCgX5Z", title: "Skeleton", author: "Quaternius", licence: "CC0 1.0", file: "b1ea7fcc-7d7f-4e93-aac5-507358399a7b", animated: true, triangles: 1810, size: 178460 },
  { id: "VlXjG0N8Eg", title: "Zombie", author: "Quaternius", licence: "CC0 1.0", file: "c4002f69-6979-42e8-ad6e-2f4e14fc3a9d", animated: true, triangles: 7570, size: 981672 },
  { id: "o3Ps8z8ByP", title: "Mech", author: "Quaternius", licence: "CC0 1.0", file: "a242e73b-6a40-4bd9-bfa9-ed1d8e49ea21", animated: true, triangles: 5846, size: 672456 },
  { id: "x9x0viZs8V", title: "Snake", author: "Quaternius", licence: "CC0 1.0", file: "0f3a551e-743e-48f5-936f-804c6c3b88bd", animated: true, triangles: 1618, size: 216696 },
  { id: "DJ9rpAhrh3", title: "Cat", author: "J-Toastie", licence: "CC-BY 3.0", file: "8b3fc8b2-7eae-4b19-8084-d2fbd725bc58", animated: true, triangles: 1856, size: 280840 },
  { id: "UQRRrsP3wj", title: "Donut", author: "Quaternius", licence: "CC0 1.0", file: "ff15312e-72cf-4e1f-ba4d-910fccd9dc22", triangles: 984, size: 59172 },
  { id: "fIuM_PW5prV", title: "Coffee cup", author: "Poly by Google", licence: "CC-BY 3.0", file: "8d1c0b91-5010-48e2-86f1-4d23a61d419e", triangles: 216, size: 14264 },
  { id: "CA4HtaaMJn", title: "Pizza Slice", author: "Quaternius", licence: "CC0 1.0", file: "b76298f9-9ff1-48ba-a000-c966ced03e90", triangles: 392, size: 23420 },
  { id: "Jb6JuSjNYy", title: "Burger", author: "Quaternius", licence: "CC0 1.0", file: "4b1c0f01-344b-4f4b-a401-e0cbbd3a6022", triangles: 847, size: 57116 },
  { id: "oH3dEdlDpB", title: "Rubber Duck", author: "CreativeTrio", licence: "CC0 1.0", file: "170c4be8-2462-4aa5-902f-5697b56a2fcd", triangles: 710, size: 56764 },
  { id: "4hZk7Fg8KiP", title: "Boombox", author: "Poly by Google", licence: "CC-BY 3.0", file: "64426ac5-a50b-404b-b4dd-724e60b3b2f0", triangles: 1168, size: 1759956 },
  { id: "PSsWSIAYIL", title: "Headphones", author: "CreativeTrio", licence: "CC0 1.0", file: "b72a848f-b4c6-40fb-ada7-69c4c524bd27", triangles: 472, size: 42780 },
  { id: "eoSib2-NN9Y", title: "Electric guitar", author: "Poly by Google", licence: "CC-BY 3.0", file: "9e2f770a-9e38-4763-ab8b-fc6a6ec4e166", triangles: 560, size: 804384 },
  { id: "a_NspNjwTYv", title: "Vinyl record", author: "Poly by Google", licence: "CC-BY 3.0", file: "c48d8aa2-2681-439f-a835-c8de4d15e284", triangles: 1664, size: 89420 },
  { id: "aR5ot8Z7_-v", title: "Cassette tape", author: "Poly by Google", licence: "CC-BY 3.0", file: "e75d715d-830e-4193-b72a-e6cb3fc081d0", triangles: 2046, size: 117420 },
  { id: "ExZmhOIjka", title: "Skull", author: "Quaternius", licence: "CC0 1.0", file: "a5303f4e-817b-4bc1-86f9-a5a9b6e62af7", triangles: 1664, size: 91552 },
  { id: "ah8WSBbizA6", title: "Rocketship", author: "jeremy", licence: "CC-BY 3.0", file: "61b5e7bf-f85d-415e-9d0c-beed1dbfa345", triangles: 800, size: 42912 },
  { id: "NgURFR5T9m", title: "Ufo", author: "hat_my_guy", licence: "CC0 1.0", file: "8e0d157d-58e1-415e-b48c-f194e653c274", triangles: 1004, size: 74120 },
  { id: "18Uxrb2dIc", title: "Planet", author: "Quaternius", licence: "CC0 1.0", file: "14f2d768-c6d0-4174-b9ed-0adba110ab89", triangles: 2178, size: 86312 },
  { id: "HsEJgRLQWX", title: "Cactus", author: "Quaternius", licence: "CC0 1.0", file: "c9bfa77b-fc43-402a-aee4-f34b2581b0f6", triangles: 416, size: 24160 },
];

/** The starter pack as model search results. */
export const STARTER_MODELS: ModelResult[] = STARTER.map((m) => ({
  source: "poly-pizza",
  id: m.id,
  title: m.title,
  author: m.author,
  licence: m.licence,
  thumbnail: `${POLY_FILES}/${m.file}.webp`,
  animated: m.animated === true,
  triangles: m.triangles,
  size: m.size,
  url: modelPage("poly-pizza", m.id),
}));

/** A starter model's file, by its id: downloaded without a key. */
export function starterFile(id: string): string | null {
  const model = STARTER.find((m) => m.id === id);
  return model ? `${POLY_FILES}/${model.file}.glb` : null;
}

/** What the starter pack's set is called. */
export const STARTER_SET = "Starter pack";
