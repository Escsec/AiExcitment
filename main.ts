// make.fun bounty: "Make the AI judge excited"
// Procedural 1024x1024 PNG. Node 22, standard library only, deterministic, no network.
//
// Scene: a lone craft hurtles down a spiralling warp tunnel toward a blazing gate.
// Everything converges on one white-hot point: neon gates, spiral light-rays, sparks.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1024;
const H = 1024;
const SS = 2; // supersampling per axis (clean edges)
const CX = 512;
const CY = 440;
const SEED = 0x5eed1234;

// ---------- math helpers ----------
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash(ix: number, iy: number, salt = 0): number {
  let h = (Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(salt | 0, 2246822519) ^ SEED) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// value noise, periodic in x with integer period
function vnoiseP(x: number, y: number, period: number, salt = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i0 = ((x0 % period) + period) % period;
  const i1 = (i0 + 1) % period;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(i0, y0, salt);
  const b = hash(i1, y0, salt);
  const c = hash(i0, y0 + 1, salt);
  const d = hash(i1, y0 + 1, salt);
  return mix(mix(a, b, sx), mix(c, d, sx), sy);
}

// ---------- palettes ----------
type Stop = [number, number, number, number];
function ramp(stops: Stop[], t: number, out: number[]) {
  t = clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (t <= s1[0]) {
      const k = (t - s0[0]) / (s1[0] - s0[0]);
      out[0] = mix(s0[1], s1[1], k);
      out[1] = mix(s0[2], s1[2], k);
      out[2] = mix(s0[3], s1[3], k);
      return;
    }
  }
  const l = stops[stops.length - 1];
  out[0] = l[1];
  out[1] = l[2];
  out[2] = l[3];
}

const RAY_PAL: Stop[] = [
  [0.0, 0.02, 0.0, 0.08],
  [0.22, 0.3, 0.04, 0.62],
  [0.5, 1.0, 0.1, 0.5],
  [0.75, 1.0, 0.5, 0.1],
  [1.0, 1.0, 0.95, 0.75],
];

// gates shift from electric blue (far) through cyan to white-gold (at the light)
const RING_PAL: Stop[] = [
  [0.0, 0.15, 0.4, 1.0],
  [0.3, 0.2, 0.9, 1.0],
  [0.65, 0.9, 1.0, 1.0],
  [1.0, 1.0, 0.88, 0.55],
];

// ---------- craft silhouette (points up the tunnel toward the light) ----------
const CRAFT_RAW: [number, number][] = [
  [512, 696],
  [538, 772],
  [606, 846],
  [556, 834],
  [542, 866],
  [512, 850],
  [482, 866],
  [468, 834],
  [418, 846],
  [486, 772],
];
// scaled up about the tail so it still reads as a bold shape at thumbnail size
const CRAFT: [number, number][] = CRAFT_RAW.map(([x, y]) => [512 + (x - 512) * 1.3, 866 + (y - 866) * 1.3]);

function sdPoly(px: number, py: number, P: [number, number][]): number {
  const n = P.length;
  let d = (px - P[0][0]) ** 2 + (py - P[0][1]) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ex = P[j][0] - P[i][0];
    const ey = P[j][1] - P[i][1];
    const wx = px - P[i][0];
    const wy = py - P[i][1];
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * t;
    const by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = py >= P[i][1];
    const c2 = py < P[j][1];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// ---------- scene ----------
const TAU = Math.PI * 2;
const RING_Q = Math.log(1.62);
const RING_PH = 0.15;
const SP_N = 170;
const tmp = [0, 0, 0];
let cr = 0;
let cg = 0;
let cb = 0;

function scene(px: number, py: number) {
  const u = (px - CX) / 512;
  const v = (py - CY) / 512;
  const r = Math.hypot(u, v);
  const a = Math.atan2(v, u);

  const s = Math.log(r + 0.004); // depth coordinate
  const aa = a + 0.7 * Math.log(r + 0.03); // spiral twist
  const ta = aa / TAU;

  // ---- spiral light-rays: fine, bold, and big beams
  const n1 = vnoiseP(ta * 300, s * 1.1, 300, 1);
  const n2 = vnoiseP(ta * 90 + 7, s * 0.7 + 3, 90, 2);
  const n3 = vnoiseP(ta * 11 + 2, s * 0.35, 11, 3);
  const s1 = Math.pow(smoothstep(0.6, 0.95, n1), 2.0);
  const s2 = smoothstep(0.58, 0.82, n2);
  const beam = smoothstep(0.35, 0.8, n3);
  const prox = 0.2 + 2.2 * Math.exp(-r * 2.6);
  const rays = (0.45 * s1 + 0.95 * s2) * (0.12 + beam * 1.0) * prox;

  // ---- sparks (short bright dashes flying outward)
  let spark = 0;
  {
    const spx = ta * SP_N;
    const ix = Math.floor(spx);
    const fx = spx - ix;
    const spy = s * 2.0;
    const iy = Math.floor(spy);
    const fy = spy - iy;
    const wix = ((ix % SP_N) + SP_N) % SP_N;
    const hh = hash(wix, iy, 7);
    if (hh > 0.88) {
      const off = 0.25 + 0.5 * hash(wix, iy, 8);
      const dx = Math.abs(fx - off) / 0.16;
      const wx = 1 - smoothstep(0.6, 1.0, dx);
      const len0 = 0.25 + 0.5 * hash(wix, iy, 9);
      const wy = smoothstep(0.0, 0.25, fy) * (1 - smoothstep(len0, len0 + 0.3, fy));
      spark = wx * wy * (0.6 + hash(wix, iy, 10)) * 2.2 * (0.4 + 0.6 * smoothstep(0.05, 0.5, r));
    }
  }

  // ---- gates: crisp neon rings in log-depth
  const phase = s / RING_Q;
  const k = Math.round(phase - RING_PH);
  const rk = Math.exp((k + RING_PH) * RING_Q) - 0.004;
  const dist = Math.abs(r - rk);
  const w = rk * 0.03 + 0.0006;
  const aaw = 1.1 / 512;
  const stroke = 1 - smoothstep(w - aaw, w + aaw, dist);
  const glow = Math.exp(-dist / (w * 2 + 0.0015));
  const wedge = a / TAU * 3 + hash(k, 0, 11) * 3 + k * 0.21;
  const wf = wedge - Math.floor(wedge);
  const seg = smoothstep(0.14, 0.16, wf);
  const ringFade = smoothstep(0.012, 0.03, r) * (1 - smoothstep(1.35, 1.7, r));
  const hot = Math.exp(-rk * 2.4);

  // ---- base (deep space)
  const haze = Math.exp(-r * 1.6);
  let R = 0.004 + 0.02 * haze;
  let G = 0.002 + 0.004 * haze;
  let B = 0.02 + 0.03 * haze;

  ramp(RAY_PAL, rays * 0.9, tmp);
  R += tmp[0] * rays;
  G += tmp[1] * rays;
  B += tmp[2] * rays;

  R += spark * 1.0;
  G += spark * 0.9;
  B += spark * 0.8;

  const sg = stroke * seg * ringFade * 1.7;
  const gl = glow * (0.6 + 0.4 * seg) * ringFade * 0.1;
  ramp(RING_PAL, hot, tmp);
  R += (sg + gl * 0.7) * tmp[0];
  G += (sg + gl * 0.7) * tmp[1];
  B += (sg + gl * 0.7) * tmp[2];

  // ---- core bloom
  const core = 0.006 / (r * r + 0.0006) + 0.45 * Math.exp(-r * 4.5);
  R += core * 1.0;
  G += core * 0.8;
  B += core * 0.5;
  if (r < 0.02) {
    R += 10;
    G += 10;
    B += 10;
  }
  // flare cross
  const fh = 0.7 * Math.exp(-Math.abs(v) * 70) * Math.exp(-Math.abs(u) * 2.0);
  const fv = 0.3 * Math.exp(-Math.abs(u) * 70) * Math.exp(-Math.abs(v) * 2.0);
  R += (fh + fv) * 1.0;
  G += (fh + fv) * 0.85;
  B += (fh + fv) * 0.7;

  // ---- vignette
  const vg = 1 - 0.8 * smoothstep(0.5, 1.45, r);
  R *= vg;
  G *= vg;
  B *= vg;

  // ---- engine exhaust (trails away from the light)
  {
    const ex = px - 512;
    const ty = py - 856;
    if (ty > 0) {
      const wd = 9 + 0.05 * ty;
      const tr = Math.exp(-(ex * ex) / (2 * wd * wd)) * Math.exp(-ty / 110) * 1.5;
      R += tr * 0.5;
      G += tr * 0.9;
      B += tr * 1.3;
    }
    const eg = Math.exp(-(ex * ex) / 1600 - ((py - 862) * (py - 862)) / 420);
    R += eg * 0.5;
    G += eg * 0.9;
    B += eg * 1.4;
  }

  // ---- craft silhouette with rim light from the gate
  const d = sdPoly(px, py, CRAFT);
  const cover = smoothstep(0.7, -0.7, d);
  if (cover > 0) {
    const e = 1.0;
    const gx = sdPoly(px + e, py, CRAFT) - sdPoly(px - e, py, CRAFT);
    const gy = sdPoly(px, py + e, CRAFT) - sdPoly(px, py - e, CRAFT);
    const gln = Math.hypot(gx, gy) || 1;
    const nx = gx / gln;
    const ny = gy / gln;
    const dx = CX - px;
    const dy = CY - py;
    const dl = Math.hypot(dx, dy) || 1;
    const face = clamp(((nx * dx + ny * dy) / dl) * 0.5 + 0.5, 0, 1);
    const rim = Math.exp(-Math.max(-d, 0) / 2.2);
    const lit = rim * (0.2 + 2.6 * face * face);
    const low = rim * smoothstep(0.1, 1.0, ny);
    // central spine highlight
    const sx = px - 512;
    const spine =
      Math.exp(-(sx * sx) / (2 * 1.4 * 1.4)) * smoothstep(655, 705, py) * (1 - smoothstep(765, 830, py)) * 0.55;
    const cR = 0.004 + lit * 1.5 + spine * 0.9 + low * 0.1;
    const cG = 0.003 + lit * 0.7 + spine * 0.45 + low * 0.7;
    const cB = 0.012 + lit * 0.5 + spine * 0.3 + low * 1.0;
    R = mix(R, cR, cover);
    G = mix(G, cG, cover);
    B = mix(B, cB, cover);
  }

  cr = R;
  cg = G;
  cb = B;
}

// ---------- render ----------
const img = new Float32Array(W * H * 3);
const inv = 1 / (SS * SS);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let j = 0; j < SS; j++) {
      for (let i = 0; i < SS; i++) {
        scene(x + (i + 0.5) / SS, y + (j + 0.5) / SS);
        sr += cr;
        sg += cg;
        sb += cb;
      }
    }
    const k = (y * W + x) * 3;
    img[k] = sr * inv;
    img[k + 1] = sg * inv;
    img[k + 2] = sb * inv;
  }
}

function bil(ch: number, x: number, y: number): number {
  x = clamp(x, 0, W - 1.001);
  y = clamp(y, 0, H - 1.001);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = (y0 * W + x0) * 3 + ch;
  return mix(mix(img[i], img[i + 3], fx), mix(img[i + W * 3], img[i + W * 3 + 3], fx), fy);
}

// radial chromatic fringing + tonemap + dither -> 8-bit RGB
const px8 = new Uint8Array(W * H * 3);
const EXPOSURE = 1.15;
const CA = 0.007;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 3;
    const dx = x + 0.5 - CX;
    const dy = y + 0.5 - CY;
    const rr = Math.hypot(dx, dy) / 512;
    const kr = 1 + CA * rr;
    const kb = 1 - CA * rr;
    const vals = [
      bil(0, CX + dx * kr - 0.5, CY + dy * kr - 0.5),
      img[k + 1],
      bil(2, CX + dx * kb - 0.5, CY + dy * kb - 0.5),
    ];
    const dn = hash(x, y, 99) - 0.5;
    for (let c = 0; c < 3; c++) {
      const lin = 1 - Math.exp(-vals[c] * EXPOSURE);
      const g = Math.pow(lin, 1 / 2.2) * 255 + dn * 0.3;
      px8[k + c] = clamp(Math.round(g), 0, 255);
    }
  }
}

// ---------- PNG encoder ----------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [0, 1, 2, 4].map(() => new Uint8Array(stride));
  const types = [0, 1, 2, 4];
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? row[i - 3] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= 3 ? prev[i - 3] : 0;
      cand[0][i] = row[i];
      cand[1][i] = (row[i] - a) & 255;
      cand[2][i] = (row[i] - b) & 255;
      cand[3][i] = (row[i] - paeth(a, b, c)) & 255;
    }
    let best = 0;
    let bestScore = Infinity;
    for (let t = 0; t < 4; t++) {
      let sc = 0;
      for (let i = 0; i < stride; i++) {
        const v = cand[t][i];
        sc += v < 128 ? v : 256 - v;
      }
      if (sc < bestScore) {
        bestScore = sc;
        best = t;
      }
    }
    raw[y * (stride + 1)] = types[best];
    raw.set(cand[best], y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
const png = encodePNG(px8, W, H);
writeFileSync(join(outDir, "entry.png"), png);
console.log(`wrote ${join(outDir, "entry.png")} (${png.length} bytes)`);
