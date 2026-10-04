#!/usr/bin/env node
'use strict';
/**
 * Generates the two looks for unmapped ground, each at 1x, 2x and 3x (React Native picks the one for the screen):
 *   assets/fog-sky.png     a night sky: deep navy with a faint nebula glow and scattered stars
 *   assets/fog-terrain.png topographic contour lines on dark ground, like an explorer's chart
 * Both are opaque, 256 x 256 points, and tile without seams.
 *   node scripts/make-fog-textures.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const POINTS = 256;
const BASE = [6, 11, 23];

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function encode(S, pixel) {
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      const p = pixel(x, y);
      const i = y * (S * 4 + 1) + 1 + x * 4;
      raw[i] = p[0]; raw[i + 1] = p[1]; raw[i + 2] = p[2]; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Deterministic random numbers, so every size of a texture shows the same picture. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Perlin gradient noise with `cells` lattice cells per side, wrapped so it tiles. Smooth in every direction. */
function perlin(S, cells, rand) {
  const angles = Array.from({ length: cells * cells }, () => rand() * Math.PI * 2);
  const grad = (ix, iy, dx, dy) => {
    const a = angles[(((iy % cells) + cells) % cells) * cells + (((ix % cells) + cells) % cells)];
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const gx = (x / S) * cells, gy = (y / S) * cells;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0, u = fade(fx), v = fade(fy);
    const a = grad(x0, y0, fx, fy), b = grad(x0 + 1, y0, fx - 1, fy), c = grad(x0, y0 + 1, fx, fy - 1), d = grad(x0 + 1, y0 + 1, fx - 1, fy - 1);
    const top = a + (b - a) * u, bottom = c + (d - c) * u;
    out[y * S + x] = (top + (bottom - top) * v) * 0.7071 + 0.5;
  }
  return out;
}

/** Night sky. */
function sky(K) {
  const S = POINTS * K;
  const rand = rng(11);
  const stars = [];
  for (let i = 0; i < 150; i++) {
    const faint = rand() < 0.8;
    const level = faint ? 0.25 + rand() * 0.25 : 0.6 + rand() * 0.4;
    const warm = rand() < 0.15;
    stars.push({ x: rand() * POINTS, y: rand() * POINTS, level, warm, sigma: faint ? 0.55 : 0.9 });
  }
  const light = new Float32Array(S * S * 3);
  for (const s of stars) {
    const cx = Math.round(s.x * K), cy = Math.round(s.y * K), sig = s.sigma * K, reach = Math.ceil(sig * 3.2);
    const colour = s.warm ? [255, 220, 180] : [170, 200, 255];
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const k = Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig)) * s.level;
      const px = (((cx + dx) % S) + S) % S, py = (((cy + dy) % S) + S) % S;
      const i = (py * S + px) * 3;
      light[i] += colour[0] * k; light[i + 1] += colour[1] * k; light[i + 2] += colour[2] * k;
    }
  }
  const nebula = perlin(S, 4, rng(5));
  return encode(S, (x, y) => {
    const i = (y * S + x) * 3;
    const glow = Math.max(0, nebula[y * S + x] - 0.45) * 0.5;
    const c = mix(BASE, [24, 40, 86], glow);
    return [Math.min(255, c[0] + light[i]), Math.min(255, c[1] + light[i + 1]), Math.min(255, c[2] + light[i + 2])].map(Math.round);
  });
}

/** Topographic contours. */
function terrain(K) {
  const S = POINTS * K;
  const r = rng(3);
  const f1 = perlin(S, 3, r), f2 = perlin(S, 6, r), f3 = perlin(S, 12, r);
  const f = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) f[i] = f1[i] * 0.62 + f2[i] * 0.28 + f3[i] * 0.1;
  const levels = [];
  for (let l = 0.2; l < 0.85; l += 0.045) levels.push(l);
  return encode(S, (x, y) => {
    const gx = (f[y * S + ((x + 1) % S)] - f[y * S + ((x + S - 1) % S)]) / 2;
    const gy = (f[((y + 1) % S) * S + x] - f[((y + S - 1) % S) * S + x]) / 2;
    const grad = Math.hypot(gx, gy) + 1e-6;
    const v = f[y * S + x];
    let a = 0, major = false;
    levels.forEach((L, k) => {
      const t = Math.max(0, 1 - (Math.abs(v - L) / grad) / (0.9 * K));
      if (t > a) { a = t; major = k % 5 === 0; }
    });
    const base = mix(BASE, [14, 26, 54], Math.max(0, v - 0.4) * 0.55);
    return mix(base, [120, 170, 255], a * (major ? 0.34 : 0.17)).map(Math.round);
  });
}

for (const [name, make] of [['fog-sky', sky], ['fog-terrain', terrain]]) {
  for (const [K, suffix] of [[1, ''], [2, '@2x'], [3, '@3x']]) {
    const out = path.join(__dirname, '..', 'assets', `${name}${suffix}.png`);
    const png = make(K);
    fs.writeFileSync(out, png);
    console.log(`wrote ${path.basename(out)} (${png.length} bytes, ${POINTS * K}px)`);
  }
}
