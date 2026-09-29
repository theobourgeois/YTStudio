import type { Response } from "express";

/** A query parameter as a string ("" when missing or repeated). */
export const queryString = (value: unknown) => (typeof value === "string" ? value : "");

/** An AbortSignal that fires when the client goes away (e.g. the user kept typing). */
export function abortOnClose(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  return controller.signal;
}
