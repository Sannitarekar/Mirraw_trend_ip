import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PinsPage, PinterestBoard, PinterestPin } from "./types.ts";

const SAMPLE_IMAGES_DIR = fileURLToPath(new URL("../../../sample-data/images", import.meta.url));

const SAMPLE_BOARDS: PinterestBoard[] = [
  { id: "brd_ethnic", name: "Ethnic Wear Trends", owner: { username: "mock_mirraw" } },
  { id: "brd_sarees", name: "Saree Styles", owner: { username: "mock_mirraw" } },
  { id: "brd_lehengas", name: "Lehenga Inspo", owner: { username: "mock_mirraw" } },
  { id: "brd_kurtas", name: "Kurtas & Co-ords", owner: { username: "mock_mirraw" } },
];

const FASHION_WORDS = [
  "golden zari saree styling",
  "ivory silk lehenga",
  "mint organza saree",
  "festive red anarkali",
  "royal blue kurta",
  "crimson wedding lehenga",
  "pastel sharara set",
  "coord set fusion look",
  "embroidered ethnic ensemble",
  "summer 2026 festive edit",
];

/**
 * Deterministic mock of the Pinterest API v5.
 *
 * IMPORTANT: this is a demo fixture, not Pinterest. It produces synthetic pins
 * that reference the local sample images (file:// URLs) so the full pipeline
 * runs offline. It mirrors the real provider's fetch surface (listBoards +
 * getBoardPins with page_size/bookmark), so switching PINTEREST_PROVIDER=api
 * is config-only.
 */
export class MockPinterestProvider {
  private readonly images: string[];
  private readonly boards: PinterestBoard[];

  constructor(boards: PinterestBoard[] = SAMPLE_BOARDS) {
    this.boards = boards;
    this.images = readdirSync(SAMPLE_IMAGES_DIR)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort();
  }

  async listBoards(): Promise<PinterestBoard[]> {
    return this.boards;
  }

  async getBoardPins(boardId: string, options: { pageSize?: number; bookmark?: string } = {}): Promise<PinsPage> {
    const boardIndex = this.boards.findIndex((b) => b.id === boardId);
    if (boardIndex === -1) return { items: [], bookmark: "" };

    // Two pages per board so bookmark pagination is exercised.
    const pageSize = options.pageSize ?? 100;
    const page = options.bookmark === "page2" ? 1 : 0;
    const baseIndex = boardIndex * 6;

    const items: PinterestPin[] = [];
    for (let i = 0; i < 6; i++) {
      const idx = (baseIndex + i) % this.images.length;
      const img = this.images[idx];
      if (!img) continue;
      const pinId = `pin_${boardIndex}_${i}`;
      if (page === 0 && i >= pageSize) continue;
      if (page === 1) {
        if (i < 3) continue; // only 3 items on page 2
        if (pageSize < 3) break;
      }
      const imageUrl = `file:///${path.join(SAMPLE_IMAGES_DIR, img).replaceAll("\\", "/")}`;
      const word = FASHION_WORDS[(baseIndex + i) % FASHION_WORDS.length]!;
      const boardName = this.boards[boardIndex]?.name;
      const board: { id: string; name?: string } = { id: boardId };
      if (boardName) {
        board.name = boardName;
      }
      const owner = this.boards[boardIndex]?.owner;
      const boardOwner: { username?: string } = { username: "mock_mirraw" };
      if (owner?.username) {
        boardOwner.username = owner.username;
      }
      const description = `${word} — curated board "${boardName ?? "untitled"}"`;
      const media = {
        images: { "600x": { url: imageUrl } },
        image_type: "image",
      };
      const created = this.createdAtFor(baseIndex + i);
      const pin: PinterestPin = {
        id: pinId,
        description,
        board,
        board_owner: boardOwner,
        media,
        pin_metrics: { save_count: this.saveCountFor(baseIndex + i) },
        created_at: created,
      };
      items.push(pin);
    }
    return { items, bookmark: page === 0 ? "page2" : "" };
  }

  private saveCountFor(i: number): number {
    // Wide spread so scoring rank differs: some viral, some low.
    const spreads = [3200, 1450, 780, 220, 60, 15];
    return spreads[i % spreads.length]!;
  }

  private createdAtFor(i: number): string {
    // Within the last 7 days so recency scoring has signal.
    const daysAgo = i % 7;
    const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    return d.toISOString();
  }
}