import { describe, expect, it } from "vitest";
import { linkIn } from "./use-web-search";

describe("linkIn", () => {
  it("recognises pasted links, with or without the scheme", () => {
    expect(linkIn(" https://www.tiktok.com/@a/video/1 ")).toBe("https://www.tiktok.com/@a/video/1");
    expect(linkIn("http://example.com")).toBe("http://example.com");
    expect(linkIn("youtu.be/dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(linkIn("x.com/someone/status/123")).toBe("https://x.com/someone/status/123");
  });

  it("treats everything else as a search", () => {
    for (const q of ["bladee", "AC/DC thunderstruck", "ac/dc", "mr. brightside", "https://a.com/x y"]) {
      expect(linkIn(q)).toBeNull();
    }
  });
});
