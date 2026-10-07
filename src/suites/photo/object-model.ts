/**
 * The Object Selection tool's model in the tab (docs/photo/selections.md, `shared/photo/sam.ts`): SAM 2.1, run as
 * every photo model is (`models.ts`). Its encoder reads the photo once and what it makes is kept while the photo
 * doesn't change (a press of the brush starts it, so it's often done when the stroke ends); each stroke then costs
 * the decoder's milliseconds, and a second look at a thing much smaller than the photo one more encoder run on it
 * alone, then the edge refined (`sam-refine.ts`). The tests' server answers with a stand-in instead (`standIn`): what's unlike the border
 * of the part around the strokes, the things they touched kept (`object-select.ts`).
 */
import { create } from "zustand";
import { objectBox, objectProbabilities, paintedGrid } from "@shared/photo/object-select";
import { type PixelSample, sampleScale } from "@shared/photo/pixel-sample";
import { SAM_DECODER, SAM_ENCODER, SAM_MASK_SIDE, SAM_SIDE, chooseMask, samInput, samPoints } from "@shared/photo/sam";
import { type DocBox, type EdgeOptions, boxIn, chooseRefined, cropSelection, edgeOptions, maskBox, priorGrid, zoomBox } from "@shared/photo/sam-refine";
import { SUBJECT_SIDE, cropSample, standInProbabilities, subjectSelection } from "@shared/photo/subject";
import type { MaskSelection, PhotoProject, SelectionMode } from "@shared/photo/types";
import type { EdgeReply, EdgeRequest } from "./edge-worker";
import { type ModelOutput, modelApi, readyModel, runGraph } from "./models";
import { applySelection, photoSample, sampledLayer, useSelectOptions } from "./selecting";
import { currentDoc, usePhoto } from "./store";

type Point = { x: number; y: number };

/** Object Selection is looking for a thing. */
export const useObjectModel = create<{ running: boolean }>(() => ({ running: false }));

/** The sample level whose pixels show `box` (document pixels) at most `side` a side. */
function levelFor(doc: PhotoProject, box: { width: number; height: number }, side: number): number {
  return Math.max(0, Math.ceil(Math.log2((Math.max(box.width, box.height) * sampleScale(doc.canvas)) / side)));
}

/** The photo as the encoder reads it: at most twice its 1024 a side, which is plenty. */
const encoderSample = (doc: PhotoProject, layerId: string | null) => photoSample(doc, layerId, levelFor(doc, doc.canvas, 2 * SAM_SIDE));

/** The encoder's answer for the last sample it read (samples are kept per photo and layer, so this is per photo). */
let encoded: { sample: PixelSample; embeddings: Promise<Record<string, ModelOutput>> } | null = null;

function embeddingsOf(sample: PixelSample): Promise<Record<string, ModelOutput>> {
  if (encoded?.sample !== sample) {
    const embeddings = encode(sample);
    const mine = { sample, embeddings };
    encoded = mine;
    embeddings.catch(() => {
      if (encoded === mine) encoded = null;
    });
  }
  return encoded!.embeddings;
}

// Another photo opened: what the encoder made of the last one (about 17 MB) goes.
usePhoto.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) encoded = null;
});

/** A press of the brush: the encoder starts on the photo now, if the model is here (it asks nothing). */
export function warmObjectModel(sampleAll = useSelectOptions.getState().sampleAll) {
  const doc = currentDoc();
  if (!doc) return;
  void (async () => {
    const status = await modelApi.status("object");
    if (status.status !== "ready" || status.standIn) return;
    await embeddingsOf(await encoderSample(doc, sampledLayer(doc, sampleAll)));
  })().catch(() => {});
}

const encode = (picture: PixelSample) => runGraph("object", { [SAM_ENCODER.input]: { data: samInput(picture), dims: [1, 3, SAM_SIDE, SAM_SIDE] } }, SAM_ENCODER.outputs, SAM_ENCODER);

/**
 * The decoder on what the encoder made: `points` (the square's pixels) and a `box` ([x0, y0, x1, y1] there) or none.
 * Its three masks' logits, its ratings of them, and whether it sees a thing at all.
 */
async function decode(embeddings: Record<string, ModelOutput>, points: Point[], box: number[] | null) {
  // No point at all (a box alone): one that isn't one, as SAM pads.
  const prompts = points.length ? points.map((p) => ({ ...p, label: 1n })) : [{ x: 0, y: 0, label: -10n }];
  const inputs = Object.fromEntries(SAM_ENCODER.outputs.map((name) => [name, { data: embeddings[name].data, dims: [...embeddings[name].dims] }]));
  const out = await runGraph(
    "object",
    {
      ...inputs,
      [SAM_DECODER.points]: { data: Float32Array.from(prompts.flatMap((p) => [p.x, p.y])), dims: [1, 1, prompts.length, 2] },
      [SAM_DECODER.labels]: { data: BigInt64Array.from(prompts, (p) => p.label), dims: [1, 1, prompts.length] },
      [SAM_DECODER.boxes]: box ? { data: Float32Array.from(box), dims: [1, 1, 4] } : { data: new Float32Array(0), dims: [1, 0, 4] },
    },
    [SAM_DECODER.masks, SAM_DECODER.scores, SAM_DECODER.object],
    SAM_DECODER,
  );
  return { masks: out[SAM_DECODER.masks].data, scores: out[SAM_DECODER.scores].data, found: out[SAM_DECODER.object].data[0] >= 0 };
}

const CELLS = SAM_MASK_SIDE * SAM_MASK_SIDE;

/** The edge worker (`edge-worker.ts`), made on first use, asked by request id. */
let edgeWorker: { worker: Worker; next: number; waiting: Map<number, (reply: EdgeReply) => void> } | null = null;

/** SAM's mask on `picture`'s pixels, its edge decided by their colours (`refineEdge`), in the edge worker. */
function refineInWorker(logits: Float32Array, picture: PixelSample, options: EdgeOptions): Promise<Uint8Array> {
  if (!edgeWorker) {
    const worker = new Worker(new URL("./edge-worker.ts", import.meta.url), { type: "module" });
    const made = { worker, next: 1, waiting: new Map<number, (reply: EdgeReply) => void>() };
    worker.onmessage = (event: MessageEvent<EdgeReply>) => {
      made.waiting.get(event.data.id)?.(event.data);
      made.waiting.delete(event.data.id);
    };
    edgeWorker = made;
  }
  const { worker, waiting } = edgeWorker;
  const id = edgeWorker.next++;
  // Copies: the picture's pixels may be the kept sample's, which must stay whole here.
  const data = picture.data.slice();
  const mask = logits.slice();
  return new Promise((resolve, reject) => {
    waiting.set(id, (reply) => (reply.coverage ? resolve(reply.coverage) : reject(new Error(reply.error ?? "The edge couldn't be refined."))));
    worker.postMessage({ id, logits: mask, data, width: picture.width, height: picture.height, options } satisfies EdgeRequest, [data.buffer, mask.buffer]);
  });
}

/**
 * SAM's answer: the thing the strokes prompt for, as a selection, or null when it sees nothing there. It looks at the
 * whole photo first (`sam.ts`), then again at the thing alone when that's a good deal smaller (`sam-refine.ts`), and
 * the edge is decided by the photo's own colours (`refineEdge`).
 */
async function samObject(doc: PhotoProject, layerId: string | null, strokes: Point[][], size: number): Promise<MaskSelection | null> {
  const whole = { x: 0, y: 0, ...doc.canvas };
  const points = samPoints(strokes, size, whole);
  if (!points.length) return null;
  const sample = await encoderSample(doc, layerId);
  const first = await decode(await embeddingsOf(sample), points, null);
  if (!first.found) return null;
  const painted = paintedGrid(strokes, size, sample.scale, { x: 0, y: 0, width: sample.width, height: sample.height }, SAM_MASK_SIDE);
  const chosen = chooseMask(first.masks, first.scores, painted);
  if (chosen < 0) return null;
  const logits = first.masks.slice(chosen * CELLS, (chosen + 1) * CELLS);
  const box = maskBox(logits, whole);
  if (!box) return null;
  // The second look, at the thing alone, when it's a good deal smaller than the photo: its answer replaces the first.
  let frame: DocBox = whole;
  let answer = logits;
  const zoom = zoomBox(box, doc.canvas);
  if (zoom) {
    const part = cropSample(await photoSample(doc, layerId, levelFor(doc, zoom, 2 * SAM_SIDE)), zoom);
    if (part) {
      const second = await decode(await encode(part.crop), samPoints(strokes, size, zoom), boxIn(box, zoom, SAM_SIDE));
      const again = second.found ? chooseRefined(second.masks, second.scores, priorGrid(logits, whole, zoom)) : -1;
      if (again >= 0) {
        frame = zoom;
        answer = second.masks.slice(again * CELLS, (again + 1) * CELLS);
      }
    }
  }
  // The edge is decided on the photo's own pixels at their finest (up to the samples' 4096 a side): the encoder read
  // at most 2048, and a coarser edge would be stretched soft.
  const fine = await photoSample(doc, layerId, levelFor(doc, frame, 4 * SAM_SIDE));
  const part = frame === whole ? { crop: fine, at: { x: 0, y: 0, width: fine.width, height: fine.height } } : cropSample(fine, frame);
  if (!part) return null;
  const picture = part.crop;
  const cell = Math.max(picture.width, picture.height) / SAM_MASK_SIDE;
  const coverage = await refineInWorker(answer, picture, edgeOptions(cell));
  return cropSelection(coverage, part.at, fine, doc.canvas);
}

/** The tests' stand-in: what's unlike the border of the part around the strokes, the things they touched kept. */
async function standInObject(doc: PhotoProject, layerId: string | null, strokes: Point[][], size: number): Promise<MaskSelection | null> {
  const box = objectBox(strokes, size, doc.canvas);
  if (!box) return null;
  const side = Math.max(box.width, box.height) * sampleScale(doc.canvas);
  const sample = await photoSample(doc, layerId, Math.max(0, Math.ceil(Math.log2(side / 2048))));
  const part = cropSample(sample, box);
  if (!part) return null;
  const kept = objectProbabilities(standInProbabilities(part.crop), SUBJECT_SIDE, paintedGrid(strokes, size, sample.scale, part.at, SUBJECT_SIDE));
  return kept && subjectSelection(kept, SUBJECT_SIDE, sample, doc.canvas, part.at);
}

/**
 * The Object Selection tool: `strokes` (document points) painted `size` pixels across over a thing, which the model
 * selects; the thing meets the selection by `mode`. What was found, or null when nothing was (the selection is left
 * alone then, and when the photo changed meanwhile). Throws `ModelMissing` while the model isn't here.
 */
export async function selectObject(strokes: Point[][], size: number, mode: SelectionMode, sampleAll = useSelectOptions.getState().sampleAll): Promise<MaskSelection | null> {
  const doc = currentDoc();
  if (!doc || !strokes.some((s) => s.length)) return null;
  const status = await readyModel("object");
  useObjectModel.setState({ running: true });
  try {
    const layerId = sampledLayer(doc, sampleAll);
    const shape = status.standIn ? await standInObject(doc, layerId, strokes, size) : await samObject(doc, layerId, strokes, size);
    if (currentDoc() !== doc) return null;
    if (shape) applySelection(shape, mode);
    return shape;
  } finally {
    useObjectModel.setState({ running: false });
  }
}
