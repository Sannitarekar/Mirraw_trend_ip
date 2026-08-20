import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the local demo fixture images used by the mock Pinterest provider,
 * the Instagram CSV sample, and the scraper fixture HTML pages.
 *
 * 12 images with DISTINCT compositions (different silhouettes, band layouts,
 * stripes, diagonal panels, etc.) so the DCT-based pHash separates them. Real
 * fashion photos have distinct compositions; identical structures in different
 * colours legitimately hash close, so this keeps the demo's dedup meaningful.
 */

const imagesDir = fileURLToPath(new URL("../sample-data/images", import.meta.url));
mkdirSync(imagesDir, { recursive: true });

const W = 480;
const H = 640;

const designs: { name: string; svg: string }[] = [
  {
    name: "saree",
    svg: `
      <rect width="480" height="640" fill="#8B5A2B"/>
      <rect x="140" y="40" width="200" height="560" fill="#D4AF37"/>
      <rect x="200" y="40" width="40" height="560" fill="#F5DEB3"/>`,
  },
  {
    name: "lehenga",
    svg: `
      <rect width="480" height="640" fill="#7B2D8B"/>
      <polygon points="240,260 60,620 420,620" fill="#FFD700"/>
      <rect x="200" y="60" width="80" height="200" fill="#2E0854"/>`,
  },
  {
    name: "anarkali",
    svg: `
      <rect width="480" height="640" fill="#2E8B57"/>
      <polygon points="240,40 340,140 340,560 140,560 140,140" fill="#FFF8DC"/>
      <circle cx="240" cy="100" r="46" fill="#2E8B57"/>`,
  },
  {
    name: "kurta",
    svg: `
      <rect width="480" height="640" fill="#4169E1"/>
      <rect x="150" y="80" width="180" height="520" fill="#FFA07A"/>
      <rect x="150" y="180" width="180" height="12" fill="#4169E1"/>
      <rect x="150" y="320" width="180" height="12" fill="#4169E1"/>`,
  },
  {
    name: "sharara",
    svg: `
      <rect width="480" height="640" fill="#B22222"/>
      <rect x="140" y="80" width="80" height="520" fill="#F5F5DC"/>
      <rect x="260" y="80" width="80" height="520" fill="#F5F5DC"/>
      <rect x="196" y="60" width="88" height="120" fill="#8B0000"/>`,
  },
  {
    name: "coords",
    svg: `
      <rect width="480" height="640" fill="#4682B4"/>
      <rect x="0" y="0" width="480" height="300" fill="#FFE4B5"/>
      <rect x="0" y="300" width="480" height="340" fill="#2F4F4F"/>
      <line x1="0" y1="300" x2="480" y2="300" stroke="#FFFFFF" stroke-width="14"/>`,
  },
  {
    name: "saree-gold",
    svg: `
      <rect width="480" height="640" fill="#8B5A2B"/>
      <polygon points="60,640 320,40 480,40 200,640" fill="#FFD700"/>
      <polygon points="60,640 320,40 360,40 140,640" fill="#B8860B"/>`,
  },
  {
    name: "lehenga-ivory",
    svg: `
      <rect width="480" height="640" fill="#7B2D8B"/>
      <rect x="120" y="260" width="240" height="380" fill="#FFFFF0"/>
      <rect x="120" y="380" width="240" height="18" fill="#FFD700"/>
      <rect x="120" y="520" width="240" height="18" fill="#FFD700"/>`,
  },
  {
    name: "saree-mint",
    svg: `
      <rect width="480" height="640" fill="#98FB98"/>
      <rect x="150" y="0" width="26" height="640" fill="#2E8B57"/>
      <rect x="210" y="0" width="26" height="640" fill="#2E8B57"/>
      <rect x="270" y="0" width="26" height="640" fill="#2E8B57"/>
      <rect x="330" y="0" width="26" height="640" fill="#2E8B57"/>`,
  },
  {
    name: "anarkali-red",
    svg: `
      <rect width="480" height="640" fill="#8B0000"/>
      <polygon points="150,60 330,60 330,580 150,580" fill="#DAA520"/>
      <polygon points="210,60 270,60 270,220 210,220" fill="#8B0000"/>
      <polygon points="210,420 270,420 270,580 210,580" fill="#8B0000"/>`,
  },
  {
    name: "kurta-blue",
    svg: `
      <rect width="480" height="640" fill="#6495ED"/>
      <rect x="0" y="0" width="480" height="640" fill="#6495ED"/>
      <circle cx="240" cy="200" r="130" fill="#FFFFFF"/>
      <circle cx="240" cy="460" r="90" fill="#FFFFFF"/>
      <rect x="220" y="70" width="40" height="260" fill="#6495ED"/>`,
  },
  {
    name: "lehenga-wedding",
    svg: `
      <rect width="480" height="640" fill="#B22222"/>
      <rect x="0" y="500" width="480" height="140" fill="#FFD700"/>
      <circle cx="240" cy="330" r="70" fill="#FFD700"/>
      <circle cx="240" cy="330" r="40" fill="#B22222"/>
      <rect x="200" y="60" width="80" height="200" fill="#FFD700"/>`,
  },
];

for (const [i, design] of designs.entries()) {
  const id = String(i + 1).padStart(3, "0");
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${design.svg}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(path.join(imagesDir, `${id}-${design.name}.png`), png);
  console.log(`wrote ${id}-${design.name}.png (${png.length} bytes)`);
}
console.log("done");