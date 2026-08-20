import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../../src/collectors/common/csv.ts";

test("parses a simple CSV with header and rows", () => {
  const rows = parseCsv("a,b,c\n1,2,3\n4,5,6");
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1", "2", "3"],
    ["4", "5", "6"],
  ]);
});

test("handles commas and quotes inside quoted fields", () => {
  const rows = parseCsv('url,desc\nhttps://x, "festive, saree look"');
  assert.deepEqual(rows, [
    ["url", "desc"],
    ["https://x", " festive, saree look"],
  ]);
});

test("handles escaped double quotes", () => {
  const rows = parseCsv('desc\n"he said ""hello"""');
  assert.deepEqual(rows, [["desc"], ['he said "hello"']]);
});

test("handles CRLF line endings", () => {
  const rows = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("drops empty trailing rows", () => {
  const rows = parseCsv("a,b\n1,2\n\n\n");
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("empty input yields no rows", () => {
  assert.deepEqual(parseCsv(""), []);
});