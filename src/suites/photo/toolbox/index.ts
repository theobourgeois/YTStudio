/** The kits of the newer tools, by tool (`kit.ts`). */
import type { PhotoTool } from "../tool-groups";
import type { ToolKit } from "./kit";
import { backgroundEraserKit } from "./background-eraser";
import { cropKit } from "./crop";
import { gradientKit } from "./gradient";
import { magicEraserKit } from "./magic-eraser";
import { paintBucketKit } from "./paint-bucket";
import { burnKit, dodgeKit, spongeKit } from "./toning";
import { typeKit } from "./type-tool";

export type { DocPointOf, ToolKit } from "./kit";

export const TOOLBOX: Partial<Record<PhotoTool, ToolKit>> = {
  crop: cropKit,
  backgroundEraser: backgroundEraserKit,
  magicEraser: magicEraserKit,
  gradient: gradientKit,
  paintBucket: paintBucketKit,
  dodge: dodgeKit,
  burn: burnKit,
  sponge: spongeKit,
  type: typeKit,
};
