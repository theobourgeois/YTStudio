import { describe, expect, it } from "vitest";
import { iconSizeFor, isLink, onlineLayerName } from "./online.ts";

describe("online", () => {
  it("tells a link from words", () => {
    expect(isLink("https://example.com/a?b=1")).toBe(true);
    expect(isLink("  http://x.y  ")).toBe(true);
    expect(isLink("bell icon")).toBe(false);
    expect(isLink("example.com")).toBe(false);
    expect(isLink("https://two words")).toBe(false);
  });

  it("names a layer after its result", () => {
    expect(onlineLayerName({ source: "icons", id: "mdi:bell-outline", title: "" })).toBe("bell outline");
    expect(onlineLayerName({ source: "web", id: "https://a.example/x/red_car.png" })).toBe("red car");
    expect(onlineLayerName({ source: "web", id: "https://a.example/", title: "Bell icon.svg" })).toBe("Bell icon");
    expect(onlineLayerName({ source: "web", id: "x", title: "a".repeat(80) })).toHaveLength(58);
  });

  it("suggests icons a quarter of the canvas's shorter side", () => {
    expect(iconSizeFor({ width: 1080, height: 1920 })).toBe(270);
    expect(iconSizeFor({ width: 100, height: 100 })).toBe(64);
    expect(iconSizeFor({ width: 8000, height: 8000 })).toBe(1024);
  });
});
