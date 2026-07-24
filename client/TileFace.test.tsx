import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TileFace } from "./TileFace";

const CANONICAL_TILE_IDS = [
  ...["characters", "bamboo", "dots"].flatMap((suit) => Array.from({ length: 9 }, (_, index) => `${suit}-${index + 1}-1`)),
  "wind-east-1", "wind-south-1", "wind-west-1", "wind-north-1",
  "dragon-red-1", "dragon-green-1", "dragon-white-1",
  "flower-spring", "flower-summer", "flower-autumn", "flower-winter",
  "flower-plum", "flower-orchid", "flower-chrysanthemum", "flower-bamboo",
];

describe("TileFace", () => {
  it("renders original vector art for every canonical tile type", () => {
    for (const id of CANONICAL_TILE_IDS) {
      const markup = renderToStaticMarkup(<TileFace id={id} size="lg" />);
      expect(markup).toContain("<svg");
      expect(markup).not.toContain(">?</text>");
    }
  });

  it("renders White Dragon as a double blue frame, not the 白 character", () => {
    const markup = renderToStaticMarkup(<TileFace id="dragon-white-1" size="lg" />);
    expect(markup).toContain("tile-face-white-dragon");
    expect(markup.match(/<rect/g)).toHaveLength(2);
    expect(markup).not.toContain("白");
  });

  it("uses the enlarged ornamental one-dot and traditional diagonal seven-dot layouts", () => {
    const oneDot = renderToStaticMarkup(<TileFace id="dots-1-1" size="lg" />);
    const sevenDot = renderToStaticMarkup(<TileFace id="dots-7-1" size="lg" />);

    expect(oneDot).toContain("tile-face-one-dot");
    expect(oneDot).toContain('r="21"');
    expect(sevenDot.match(/<g transform="translate/g)).toHaveLength(7);
    expect(sevenDot).toContain("translate(15 15)");
    expect(sevenDot).toContain("translate(41 39)");
  });
});
