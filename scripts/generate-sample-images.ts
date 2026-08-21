import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the local demo fixture images used by the mock Pinterest provider,
 * the Instagram CSV sample, and the scraper fixture HTML pages.
 *
 * Each image is a flat-lay / product-photo style GARMENT SILHOUETTE (bodice,
 * sleeves, skirt) on a neutral studio background, so the demo images actually
 * look like the dresses the "vision AI" claims to describe. Each design has a
 * DISTINCT composition (flare width, length, drape, hemlines, motifs) so the
 * DCT-based pHash separates them — verified: min pairwise distance > 10.
 */

const imagesDir = fileURLToPath(new URL("../sample-data/images", import.meta.url));
mkdirSync(imagesDir, { recursive: true });

const BG = "#F2EEE6"; // neutral studio backdrop

/** Reusable garment primitives, all centred around x=240. */
const G = {
  /** A-line skirt from waist y0 to hem y1, half-widths w0 (waist) and w1 (hem). */
  skirt: (y0: number, y1: number, w0: number, w1: number, fill: string) =>
    `<polygon points="${240 - w0},${y0} ${240 + w0},${y0} ${240 + w1},${y1} ${240 - w1},${y1}" fill="${fill}"/>`,
  /** Fitted bodice from shoulder line y0 to waist y1, shoulder half-width s, waist half-width w. */
  bodice: (y0: number, y1: number, s: number, w: number, fill: string) =>
    `<polygon points="${240 - s},${y0} ${240 + s},${y0} ${240 + w},${y1} ${240 - w},${y1}" fill="${fill}"/>`,
  /** Short sleeve hanging off a shoulder point. */
  sleeve: (side: 1 | -1, sy: number, fill: string, length = 52) =>
    `<polygon points="${240 + side * 150},${sy} ${240 + side * (150 + 46)},${sy + 14} ${240 + side * (150 + 30)},${sy + length} ${240 + side * 140},${sy + length - 8}" fill="${fill}"/>`,
  /** Long sleeve. */
  sleeveLong: (side: 1 | -1, sy: number, fill: string, length = 150) =>
    `<polygon points="${240 + side * 150},${sy} ${240 + side * (150 + 42)},${sy + 18} ${240 + side * (150 + 26)},${sy + length} ${240 + side * 132},${sy + length - 10}" fill="${fill}"/>`,
  band: (x: number, y: number, w: number, h: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`,
  dot: (cx: number, cy: number, r: number, fill: string) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`,
};

const designs: { name: string; svg: string }[] = [
  // 001 — brown saree: asymmetric drape with a gold border and a pallu on one side.
  {
    name: "saree",
    svg: `
      <polygon points="150,140 330,140 350,560 130,560" fill="#8B5A2B"/>
      <polygon points="130,480 350,480 350,560 130,560" fill="#D4AF37"/>
      <polygon points="150,140 210,140 330,440 290,470" fill="#A06A36"/>
      <polygon points="330,140 360,180 300,520 260,520" fill="#D4AF37"/>`,
  },
  // 002 — purple lehenga: fitted bodice, very wide flared gold-trimmed skirt.
  {
    name: "lehenga",
    svg: `
      ${G.bodice(120, 300, 80, 66, "#7B2D8B")}
      ${G.sleeve(1, 120, "#5E2269")}
      ${G.sleeve(-1, 120, "#5E2269")}
      ${G.skirt(300, 600, 70, 210, "#7B2D8B")}
      ${G.skirt(560, 600, 140, 210, "#FFD700")}`,
  },
  // 003 — green anarkali: long symmetric flared gown, floor-length hem, fitted top.
  {
    name: "anarkali",
    svg: `
      ${G.bodice(120, 330, 78, 70, "#2E8B57")}
      ${G.sleeveLong(1, 120, "#23704A")}
      ${G.sleeveLong(-1, 120, "#23704A")}
      ${G.skirt(330, 610, 72, 205, "#2E8B57")}
      ${G.band(240, 120, 120, 8, "#FFF8DC")}`,
  },
  // 004 — blue kurta: short straight cut above the knee with a round-neck band.
  {
    name: "kurta",
    svg: `
      ${G.bodice(110, 420, 84, 96, "#4169E1")}
      ${G.sleeveLong(1, 110, "#3457B3")}
      ${G.sleeveLong(-1, 110, "#3457B3")}
      ${G.band(195, 110, 90, 26, "#FFA07A")}
      ${G.skirt(420, 470, 96, 110, "#4169E1")}`,
  },
  // 005 — red sharara: short kurti on top, wide flared pants below.
  {
    name: "sharara",
    svg: `
      ${G.bodice(120, 330, 80, 64, "#B22222")}
      ${G.sleeve(1, 120, "#8E1A1A")}
      ${G.sleeve(-1, 120, "#8E1A1A")}
      <polygon points="150,330 205,330 165,610 110,610" fill="#F5F5DC"/>
      <polygon points="275,330 330,330 370,610 315,610" fill="#F5F5DC"/>
      ${G.skirt(330, 350, 64, 78, "#B22222")}`,
  },
  // 006 — two-piece coords: crop top + wide-leg trousers, strong horizontal band.
  {
    name: "coords",
    svg: `
      ${G.bodice(150, 290, 80, 70, "#2F4F4F")}
      ${G.sleeve(1, 150, "#223B3B")}
      ${G.sleeve(-1, 150, "#223B3B")}
      <polygon points="150,340 240,340 240,610 120,610" fill="#FFE4B5"/>
      <polygon points="240,340 330,340 360,610 240,610" fill="#FFE4B5"/>
      ${G.band(0, 330, 480, 12, "#FFFFFF")}`,
  },
  // 007 — gold saree: strong diagonal pallu band across the whole body.
  {
    name: "saree-gold",
    svg: `
      <polygon points="140,150 340,150 360,560 120,560" fill="#8B5A2B"/>
      <polygon points="140,150 340,150 260,560 60,560" fill="#FFD700"/>
      <polygon points="300,150 360,180 300,560 240,560" fill="#D4AF37"/>`,
  },
  // 008 — ivory lehenga: layered ruffled skirt with two gold band tiers.
  {
    name: "lehenga-ivory",
    svg: `
      ${G.bodice(120, 300, 80, 64, "#FFFFF0")}
      ${G.sleeve(1, 120, "#EFEAE0")}
      ${G.sleeve(-1, 120, "#EFEAE0")}
      ${G.skirt(300, 600, 68, 210, "#FFFFF0")}
      ${G.skirt(380, 415, 100, 150, "#FFD700")}
      ${G.skirt(520, 555, 160, 200, "#FFD700")}`,
  },
  // 009 — mint-green saree: narrow silhouette with vertical stripe accents.
  {
    name: "saree-mint",
    svg: `
      <polygon points="150,150 330,150 350,560 130,560" fill="#98FB98"/>
      <polygon points="150,150 330,150 350,560 130,560" fill="#2E8B57" opacity="0.35"/>
      <rect x="200" y="150" width="18" height="410" fill="#2E8B57"/>
      <rect x="262" y="150" width="18" height="410" fill="#2E8B57"/>
      <polygon points="150,150 190,150 150,240" fill="#2E8B57"/>`,
  },
  // 010 — red "saree-gown": straight fitted column PLUS a huge diagonal stole
  // (unlike 003's symmetric flare, this is asymmetrical and narrow-bodied).
  {
    name: "anarkali-red",
    svg: `
      ${G.bodice(120, 330, 78, 62, "#8B0000")}
      ${G.sleeveLong(1, 120, "#6E0000")}
      ${G.sleeveLong(-1, 120, "#6E0000")}
      ${G.skirt(330, 610, 66, 120, "#8B0000")}
      <polygon points="60,600 420,80 520,120 160,640" fill="#DAA520" opacity="0.9"/>
      <polygon points="60,600 420,80 440,120 90,640" fill="#FFD700" opacity="0.9"/>`,
  },
  // 011 — long churidar-kurti: floor-length straight kurti with a strong white
  // waist belt and high-low hem (unlike 004's short straight kurta).
  {
    name: "kurta-blue",
    svg: `
      ${G.bodice(110, 600, 84, 92, "#6495ED")}
      ${G.sleeveLong(1, 110, "#4F7FD1")}
      ${G.sleeveLong(-1, 110, "#4F7FD1")}
      ${G.band(152, 360, 176, 20, "#FFFFFF")}
      <polygon points="152,580 328,580 328,620 152,620" fill="#FFFFFF" opacity="0.0"/>
      <polygon points="160,560 320,560 348,640 132,640" fill="#4F7FD1"/>`,
  },
  // 012 — bridal red-and-gold lehenga: extra-wide circular skirt with a
  // scalloped (zigzag) gold hem and contrast blouse sleeves.
  {
    name: "lehenga-wedding",
    svg: `
      ${G.bodice(120, 300, 80, 64, "#B22222")}
      ${G.sleeve(1, 120, "#8E1A1A")}
      ${G.sleeve(-1, 120, "#8E1A1A")}
      ${G.skirt(300, 540, 70, 220, "#B22222")}
      <polygon points="20,540 80,560 140,540 200,560 260,540 320,560 380,540 440,560 460,540 460,620 20,620" fill="#FFD700"/>
      ${G.band(0, 600, 480, 20, "#FFD700")}`,
  },
];

for (const [i, design] of designs.entries()) {
  const id = String(i + 1).padStart(3, "0");
  const svg = `<svg width="480" height="640" xmlns="http://www.w3.org/2000/svg">
    <rect width="480" height="640" fill="${BG}"/>
    ${design.svg}
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(path.join(imagesDir, `${id}-${design.name}.png`), png);
  console.log(`wrote ${id}-${design.name}.png (${png.length} bytes)`);
}
console.log("done");