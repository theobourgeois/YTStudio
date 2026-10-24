/**
 * How many times the page has opened or raised one of its windows, a plugin's included: a menu closing then leaves
 * the keyboard where it went (`popups.ts`). On its own, with no imports, so stores outside the page's windows (the
 * music suite's transport, which opens plugin windows) can say so without loading them.
 */
let raised = 0;

/**
 * The page opened or brought forward one of its windows: a menu closing then leaves the keyboard where it went.
 * (Given back to the menu's window, a window opened by one of its items, Transpose say, came up behind it.)
 */
export function noteWindowRaised() {
  raised++;
}

/** The count `noteWindowRaised` keeps: a menu compares it from when it opened to when it closed. */
export function windowsRaised(): number {
  return raised;
}
