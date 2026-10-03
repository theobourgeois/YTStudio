/**
 * A panel's document starts empty. It wears what the page wears: the theme and fonts on <html>, and the
 * stylesheets, which are copied (and kept in step, for the dev server's hot reload).
 */

/** Copy <html>'s attributes (the theme's classes, the fonts' variables) from one document to another, and keep them so. */
export function mirrorRoot(from: Document, to: Document): () => void {
  const copy = () => {
    const source = from.documentElement;
    const target = to.documentElement;
    for (const { name } of [...target.attributes]) if (!source.hasAttribute(name)) target.removeAttribute(name);
    for (const { name, value } of [...source.attributes]) if (target.getAttribute(name) !== value) target.setAttribute(name, value);
  };
  copy();
  const observer = new MutationObserver(copy);
  observer.observe(from.documentElement, { attributes: true });
  return () => observer.disconnect();
}

const isStyle = (node: Node): node is HTMLLinkElement | HTMLStyleElement =>
  node instanceof HTMLStyleElement || (node instanceof HTMLLinkElement && node.rel === "stylesheet");

/**
 * Put the page's stylesheets in the other document. `ready` settles once the linked ones have loaded (or
 * failed, or taken too long), so the panel isn't shown unstyled. They're copied again when the page's change
 * (a hot update), without a gap: the old ones go when the new have loaded.
 */
export function mirrorStyles(from: Document, to: Document): { ready: Promise<void>; stop: () => void } {
  let current: Element[] = [];
  const copy = (): Promise<void> => {
    const fresh: Element[] = [];
    const waits: Promise<void>[] = [];
    for (const node of [...from.head.children]) {
      if (!isStyle(node)) continue;
      const clone = to.importNode(node, true) as HTMLLinkElement | HTMLStyleElement;
      // (`instanceof` would be the other window's HTMLLinkElement.)
      const isLink = clone.localName === "link";
      // Whole, not relative to the new document, which an about:blank has no address of its own for.
      if (isLink) clone.setAttribute("href", (node as HTMLLinkElement).href);
      fresh.push(clone);
      to.head.append(clone);
      if (isLink) {
        waits.push(
          new Promise((resolve) => {
            clone.addEventListener("load", () => resolve(), { once: true });
            clone.addEventListener("error", () => resolve(), { once: true });
          }),
        );
      }
    }
    const old = current;
    current = fresh;
    const settled = Promise.race([Promise.all(waits).then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
    void settled.then(() => {
      for (const node of old) node.remove();
    });
    return settled;
  };
  const ready = copy();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A style the dev server changes is a <style> whose text changes, or one replaced.
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void copy(), 40);
  });
  observer.observe(from.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href", "rel"] });
  return {
    ready,
    stop() {
      clearTimeout(timer);
      observer.disconnect();
    },
  };
}
