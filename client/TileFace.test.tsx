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

  it("keeps nine dots separated and labels Character tiles with Arabic numerals", () => {
    const nineDot = renderToStaticMarkup(<TileFace id="dots-9-1" size="lg" />);
    const fiveCharacters = renderToStaticMarkup(<TileFace id="characters-5-1" size="lg" />);

    expect(nineDot.match(/scale\(0\.76\)/g)).toHaveLength(9);
    expect(nineDot).toContain("translate(15 17)");
    expect(nineDot).toContain("translate(45 73)");
    expect(fiveCharacters).toContain("tile-face-corner-number");
    expect(fiveCharacters).toContain(">5</text>");
  });

  it("renders bamboo with straight shafts and distinct indented segment nodes", () => {
    const oneBamboo = renderToStaticMarkup(<TileFace id="bamboo-1-1" size="lg" />);
    const twoBamboo = renderToStaticMarkup(<TileFace id="bamboo-2-1" size="lg" />);
    const eightBamboo = renderToStaticMarkup(<TileFace id="bamboo-8-1" size="lg" />);

    expect(oneBamboo).toContain("tile-face-one-bamboo-long");
    expect(oneBamboo).toContain("tile-face-bamboo-stick");
    expect(oneBamboo).toContain('scale(1.45 2.15)');
    expect(twoBamboo.match(/tile-face-bamboo-stick/g)).toHaveLength(2);
    expect(twoBamboo).toContain('width="7.3"');
    expect(eightBamboo).toContain("tile-face-eight-bamboo");
    expect(eightBamboo.match(/tile-face-bamboo-stick/g)).toHaveLength(8);
    expect(eightBamboo).toContain("translate(22 24) rotate(-48)");
    expect(eightBamboo).toContain("translate(38 66) rotate(-48)");
    expect(eightBamboo).not.toContain("<path d=\"M18");
    expect(oneBamboo).not.toContain("<ellipse");
  });

  it("gives every Flower and Season character the readable label treatment", () => {
    const season = renderToStaticMarkup(<TileFace id="flower-summer" size="lg" />);
    const flower = renderToStaticMarkup(<TileFace id="flower-orchid" size="lg" />);
    expect(season).toContain("tile-face-flower-label");
    expect(flower).toContain("tile-face-flower-label");
    expect(season).not.toContain("tile-face-season-label");
    expect(flower).not.toContain("tile-face-season-label");
  });

  it("labels each Wind tile with its English compass letter", () => {
    const expected = { north: "N", east: "E", west: "W", south: "S" };
    for (const [wind, letter] of Object.entries(expected)) {
      const markup = renderToStaticMarkup(<TileFace id={`wind-${wind}-1`} size="lg" />);
      expect(markup).toContain("tile-face-corner-number");
      expect(markup).toContain(`>${letter}</text>`);
    }
  });
});
