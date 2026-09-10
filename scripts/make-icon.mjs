#!/usr/bin/env node
/**
 * Generate build/icon.png without an image toolchain.
 *
 * electron-builder derives the .ico and .icns from a single 512px PNG, so one
 * file is enough. The design is the app's own commit graph: three nodes on two
 * lanes joined by a branch and a merge, drawn with the same accent and lane
 * colours the UI uses.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const SIZE = 512
const S = SIZE / 512 // design is authored at 512

const BG = [0x18, 0x1a, 0x1f]
const LANE_A = [0x3b, 0x82, 0xf6] // accent blue
const LANE_B = [0x4a, 0xde, 0x80] // graph green

/** Signed distance to a rounded rectangle, for antialiased edges. */
function roundedRect(x, y, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(x - cx) - (halfW - r)
  const dy = Math.abs(y - cy) - (halfH - r)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - r
}

function circle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r
}

/** Distance to a line segment, so strokes can be drawn as capsules. */
function segment(x, y, x1, y1, x2, y2, halfWidth) {
  const vx = x2 - x1
  const vy = y2 - y1
  const len2 = vx * vx + vy * vy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / len2))
  return Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy)) - halfWidth
}

/**
 * Quadratic bezier as a chain of capsules.
 *
 * Distance to the sampled *points* alone renders as a dotted line — the gaps
 * between samples are further from the curve than the stroke is wide. Joining
 * consecutive samples with segments closes them.
 */
function curve(x, y, p0, p1, p2, halfWidth) {
  const STEPS = 48
  const at = (t) => {
    const u = 1 - t
    return [
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
    ]
  }
  let best = Infinity
  let prev = at(0)
  for (let i = 1; i <= STEPS; i++) {
    const next = at(i / STEPS)
    best = Math.min(best, segment(x, y, prev[0], prev[1], next[0], next[1], halfWidth))
    prev = next
  }
  return best
}

/** Coverage from a signed distance, giving a 1px antialiased edge. */
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d))

function blend(dst, src, alpha) {
  for (let i = 0; i < 3; i++) dst[i] = Math.round(dst[i] * (1 - alpha) + src[i] * alpha)
}

const pixels = Buffer.alloc(SIZE * SIZE * 4)

const LANE_X = 190 * S
const LANE_X2 = 322 * S
const TOP = 130 * S
const MID = 256 * S
const BOT = 382 * S
const STROKE = 15 * S
const NODE = 34 * S
const RING = 46 * S
const RING_STROKE = 13 * S

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const x = px + 0.5
    const y = py + 0.5
    const out = [0, 0, 0]
    let alpha = 0

    // Card
    const card = cover(roundedRect(x, y, SIZE / 2, SIZE / 2, SIZE / 2, SIZE / 2, 112 * S))
    if (card > 0) {
      blend(out, BG, 1)
      alpha = card
    }
    if (alpha <= 0) continue

    // Main lane, top to bottom
    const trunk = cover(segment(x, y, LANE_X, TOP, LANE_X, BOT, STROKE / 2))
    if (trunk > 0) blend(out, LANE_A, trunk)

    // Branch out and merge back
    const branchOut = cover(
      curve(x, y, [LANE_X, MID - 62 * S], [LANE_X2, MID - 40 * S], [LANE_X2, MID], STROKE / 2)
    )
    if (branchOut > 0) blend(out, LANE_B, branchOut)
    const branchBack = cover(
      curve(x, y, [LANE_X2, MID], [LANE_X2, BOT - 40 * S], [LANE_X, BOT], STROKE / 2)
    )
    if (branchBack > 0) blend(out, LANE_B, branchBack)

    // Nodes: two solid on the trunk, one ring on the branch
    for (const cy of [TOP, BOT]) {
      const n = cover(circle(x, y, LANE_X, cy, NODE / 2))
      if (n > 0) blend(out, LANE_A, n)
    }
    const ringOuter = circle(x, y, LANE_X2, MID, RING / 2)
    const ringInner = circle(x, y, LANE_X2, MID, RING / 2 - RING_STROKE)
    const ring = Math.min(cover(ringOuter), cover(-ringInner))
    if (ring > 0) blend(out, LANE_B, ring)
    const hole = cover(ringInner)
    if (hole > 0) blend(out, BG, hole)

    const i = (py * SIZE + px) * 4
    pixels[i] = out[0]
    pixels[i + 1] = out[1]
    pixels[i + 2] = out[2]
    pixels[i + 3] = Math.round(alpha * 255)
  }
}

// --- PNG container ---------------------------------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

let table = null
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let c = -1
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // truecolour with alpha
// Each scanline is prefixed with its filter byte; 0 means none.
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
console.log(`build/icon.png — ${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} kB`)
