/** The kits of the newer tools, by tool (`kit.ts`). */
import type { PhotoTool } from "../tool-groups";
import type { ToolKit } from "./kit";
import { backgroundEraserKit } from "./background-eraser";
import { cropKit } from "./crop";
import { eyedropperKit } from "./eyedropper";
import { gradientKit } from "./gradient";
import { magicEraserKit } from "./magic-eraser";
import { objectSelectKit } from "./object-select";
import { paintBucketKit } from "./paint-bucket";
import { arrowShapeKit, ellipseShapeKit, lineShapeKit, rectangleShapeKit } from "./shapes";
import { burnKit, dodgeKit, spongeKit } from "./toning";
import { typeKit } from "./type-tool";

export type { DocPointOf, ToolKit } from "./kit";

export const TOOLBOX: Partial<Record<PhotoTool, ToolKit>> = {
  objectSelect: objectSelectKit,
  crop: cropKit,
  eyedropper: eyedropperKit,
  backgroundEraser: backgroundEraserKit,
  magicEraser: magicEraserKit,
  gradient: gradientKit,
  paintBucket: paintBucketKit,
  dodge: dodgeKit,
  burn: burnKit,
  sponge: spongeKit,
  type: typeKit,
  rectangleShape: rectangleShapeKit,
  ellipseShape: ellipseShapeKit,
  lineShape: lineShapeKit,
  arrowShape: arrowShapeKit,
};
