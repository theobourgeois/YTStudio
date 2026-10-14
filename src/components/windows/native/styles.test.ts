// @vitest-environment happy-dom
import { Window as HappyWindow } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mirrorRoot, mirrorStyles } from "./styles";

const other = () => new HappyWindow().document as unknown as Document;
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

describe("a panel's document wears the page's look", () => {
  beforeEach(() => {
    document.documentElement.className = "theme theme-studio dark";
    document.documentElement.removeAttribute("style");
    document.head.innerHTML = "";
  });
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("copies <html>'s classes and fonts, and follows them", async () => {
    const panel = other();
    document.documentElement.style.setProperty("--font-sans", "Inter");
    const stop = mirrorRoot(document, panel);
    expect(panel.documentElement.className).toBe("theme theme-studio dark");
    expect(panel.documentElement.style.getPropertyValue("--font-sans")).toBe("Inter");
    document.documentElement.classList.remove("dark");
    await tick();
    expect(panel.documentElement.className).toBe("theme theme-studio");
    stop();
    document.documentElement.classList.add("dark");
    await tick();
    expect(panel.documentElement.className).toBe("theme theme-studio");
  });

  it("copies the stylesheets, and copies them again when one changes, without keeping the old", async () => {
    const style = document.createElement("style");
    style.textContent = ".a { color: red }";
    document.head.append(style);
    const panel = other();
    const { ready, stop } = mirrorStyles(document, panel);
    await ready;
    expect([...panel.head.querySelectorAll("style")].map((s) => s.textContent)).toEqual([".a { color: red }"]);
    style.textContent = ".a { color: blue }";
    await tick(200);
    expect([...panel.head.querySelectorAll("style")].map((s) => s.textContent)).toEqual([".a { color: blue }"]);
    stop();
  });

  it("adds and removes a stylesheet the page adds or removes alone, in its place, the others left as they are", async () => {
    const a = document.createElement("style");
    a.textContent = ".a {}";
    const c = document.createElement("style");
    c.textContent = ".c {}";
    document.head.append(a, c);
    const panel = other();
    const { ready, stop } = mirrorStyles(document, panel);
    await ready;
    const first = panel.head.querySelector("style");
    // A menu opening: a library's scroll lock adds a <style>, and takes it away as it closes.
    const b = document.createElement("style");
    b.textContent = ".b {}";
    document.head.insertBefore(b, c);
    await tick(10);
    expect([...panel.head.querySelectorAll("style")].map((s) => s.textContent)).toEqual([".a {}", ".b {}", ".c {}"]);
    expect(panel.head.querySelector("style")).toBe(first);
    b.remove();
    await tick(10);
    expect([...panel.head.querySelectorAll("style")].map((s) => s.textContent)).toEqual([".a {}", ".c {}"]);
    expect(panel.head.querySelector("style")).toBe(first);
    stop();
  });
});
