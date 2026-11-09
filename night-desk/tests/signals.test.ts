import { test } from "node:test";
import assert from "node:assert/strict";
import { sma, momentum, breakout, volumeRatio, atrPct, features } from "../src/signals.js";
import type { Bar } from "../src/alpaca.js";

const bar = (c: number, h = c, l = c, v = 1000): Bar => ({ t: "2026-01-01T00:00:00Z", o: c, h, l, c, v });
const rising = Array.from({ length: 30 }, (_, i) => bar(100 + i)); // 100..129

test("sma and momentum on a known rising series", () => {
  assert.equal(sma(rising, 5), (125 + 126 + 127 + 128 + 129) / 5);
  assert.equal(momentum(rising, 10)!.toFixed(4), (129 / 119 - 1).toFixed(4));
  assert.equal(momentum([bar(100)], 10), undefined, "not enough bars -> undefined, never guessed");
});

test("breakout fires when today closes above the prior high, not otherwise", () => {
  const bs = [...Array.from({ length: 21 }, () => bar(100, 105)), bar(106, 106)];
  assert.equal(breakout(bs, 20), true);
  assert.equal(breakout([...Array.from({ length: 21 }, () => bar(100, 110)), bar(101, 101)], 20), false);
});

test("volumeRatio and atrPct are sane; features returns null without enough bars", () => {
  const bs = [...Array.from({ length: 20 }, () => bar(100, 101, 99, 1000)), bar(100, 101, 99, 3000)];
  assert.equal(volumeRatio(bs, 20), 3);
  assert.ok((atrPct(rising, 14) ?? 0) >= 0);
  assert.equal(features("X", [bar(100)]), null);
});
