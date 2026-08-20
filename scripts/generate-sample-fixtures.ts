import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates local fixture HTML pages that mirror the structure of each real
 * site (Vogue, Filmfare, FDCI/Lakme, Nykaa/Myntra). Scrapers run in
 * SCRAPER_MODE=fixture against these pages so the full Playwright scraping
 * path (load -> wait-for-selector -> extract -> raw-HTML snapshot) works
 * offline. Live mode uses the same selectors against the real sites.
 */

const imagesDir = fileURLToPath(new URL("../sample-data/images", import.meta.url));
const htmlDir = fileURLToPath(new URL("../sample-data/html", import.meta.url));
mkdirSync(htmlDir, { recursive: true });

const images = readdirSync(imagesDir)
  .filter((f) => /\.png$/i.test(f))
  .sort();

function imgUrl(name: string): string {
  return `file:///${path.join(imagesDir, name).replaceAll("\\", "/")}`;
}

const titles = {
  vogue: ["The Celebrity Saree Moment", "Statement Lehenga at the Red Carpet", "Bollywood's Take on Pastels"],
  filmfare: ["Look of the Week", "Style File: Festive Edit", "Red Carpet Rewind"],
  fdci: ["Lakmé Fashion Week Day 3", "FDCI Showcase: Couture", "Emerging Designers Runway"],
  nykaa: ["Trending: Sequin Co-ords", "The Chikankari Revival", "Party Season Edit"],
};

type Site = keyof typeof titles;
const sites: Site[] = ["vogue", "filmfare", "fdci", "nykaa"];

const cardClass: Record<Site, { item: string; link: string; img: string; title: string; meta: string }> = {
  vogue: { item: "grid-article", link: "article-link", img: "article-image", title: "article-title", meta: "article-date" },
  filmfare: { item: "gallery-item", link: "gallery-link", img: "gallery-img", title: "gallery-title", meta: "gallery-date" },
  fdci: { item: "runway-card", link: "runway-link", img: "runway-img", title: "runway-label", meta: "runway-date" },
  nykaa: { item: "product-card", link: "product-link", img: "product-img", title: "product-name", meta: "product-price" },
};

for (const site of sites) {
  const classes = cardClass[site];
  const cards: string[] = [];
  for (let i = 0; i < 10; i++) {
    const img = images[i % images.length]!;
    const title = `${titles[site][i % titles[site].length]} #${i + 1}`;
    const meta = site === "nykaa" ? `₹${1999 + i * 300}` : `2026-08-${String((i % 7) + 1).padStart(2, "0")}`;
    cards.push(`
      <article class="${classes.item}">
        <a class="${classes.link}" href="https://${site}.example/looks/${i + 1}">
          <img class="${classes.img}" src="${imgUrl(img)}" alt="${title}" loading="lazy" />
          <h3 class="${classes.title}">${title}</h3>
          <span class="${classes.meta}">${meta}</span>
        </a>
      </article>`);
  }
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${site} — fashion looks</title></head>
<body>
  <header><h1>${site} editorial feed</h1></header>
  <main>${cards.join("\n")}</main>
</body>
</html>`;
  writeFileSync(path.join(htmlDir, `${site}.html`), html);
  console.log(`wrote ${site}.html (${html.length} bytes)`);
}
console.log("done");