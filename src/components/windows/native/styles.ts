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
 * failed, or taken too long), so the panel isn't shown unstyled. A stylesheet the page adds or removes (a
 * library's own, as Radix's scroll lock does each time a menu opens) is added or removed there alone; one
 * that changes (the dev server's hot update) has them all copied again, without a gap: the old ones go when
 * the new have loaded.
 */
export function mirrorStyles(from: Document, to: Document): { ready: Promise<void>; stop: () => void } {
  let current: Element[] = [];
  /** Each of the page's stylesheets, and its copy here. */
  let copies = new Map<Node, Element>();
  const cloneOf = (node: HTMLLinkElement | HTMLStyleElement) => {
    const clone = to.importNode(node, true) as HTMLLinkElement | HTMLStyleElement;
    // (`instanceof` would be the other window's HTMLLinkElement.)
    // Whole, not relative to the new document, which an about:blank has no address of its own for.
    if (clone.localName === "link") clone.setAttribute("href", (node as HTMLLinkElement).href);
    return clone;
  };
  const copy = (): Promise<void> => {
    const fresh: Element[] = [];
    const freshCopies = new Map<Node, Element>();
    const waits: Promise<void>[] = [];
    for (const node of [...from.head.children]) {
      if (!isStyle(node)) continue;
      const clone = cloneOf(node);
      fresh.push(clone);
      freshCopies.set(node, clone);
      to.head.append(clone);
      if (clone.localName === "link") {
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
    copies = freshCopies;
    const settled = Promise.race([Promise.all(waits).then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
    void settled.then(() => {
      for (const node of old) node.remove();
    });
    return settled;
  };
  const ready = copy();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver((records) => {
    // Stylesheets added to or taken from <head> itself: those alone, at once.
    if (records.every((r) => r.type === "childList" && r.target === from.head)) {
      for (const record of records) {
        for (const node of record.removedNodes) {
          const clone = copies.get(node);
          if (!clone) continue;
          clone.remove();
          copies.delete(node);
          current = current.filter((c) => c !== clone);
        }
        for (const node of record.addedNodes) {
          if (!isStyle(node) || copies.has(node)) continue;
          const clone = cloneOf(node);
          // In the same order as the page's (the cascade depends on it): before the copy of the next one.
          let next = node.nextSibling;
          while (next && !copies.has(next)) next = next.nextSibling;
          const before = next ? copies.get(next)! : null;
          if (before) to.head.insertBefore(clone, before);
          else to.head.append(clone);
          copies.set(node, clone);
          current.push(clone);
        }
      }
      return;
    }
    // A style the dev server changes is a <style> whose text changes, or a link's address.
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
