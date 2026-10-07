/**
 * The assistant's Paint Bucket and Magic Eraser: its input read (`flood-input.ts`), then the canvas's own clicks run
 * with it (`flood-actions.ts`) on the open photo.
 */
import type { PhotoProject } from "@shared/photo/types";
import type { ToolResult } from "@shared/tool-spec";
import { magicEraseAt, paintBucketAt } from "./flood-actions";
import { bucketInput, eraseInput, floodResult } from "./flood-input";

type Input = Record<string, unknown>;

export const floodTools = {
  async bucket_fill(input: Input, doc: PhotoProject, selected: string | null, colours: { foreground: string; background: string }): Promise<ToolResult> {
    const { at, layerId, target, options, colour } = bucketInput(doc, input, selected, colours);
    return floodResult(await paintBucketAt(at, { ...options, colour, layerId, target }), doc, "Filled", at);
  },
  async magic_erase(input: Input, doc: PhotoProject, selected: string | null): Promise<ToolResult> {
    const { at, layerId, target, options } = eraseInput(doc, input, selected);
    return floodResult(await magicEraseAt(at, { ...options, layerId, target }), doc, "Erased", at);
  },
};
