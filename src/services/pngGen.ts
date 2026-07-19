// مولّد PNG خفيف بلا اعتماديات (DEFLATE بكتل «مُخزَّنة» غير مضغوطة) — يُستخدم لتوليد صور تجريبية
// من مزوّد الصور الوهمي (mock) عندما لا يُضبط مزوّد حقيقي.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(buf: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
function concat(arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let p = 0;
  for (const a of arrs) { out.set(a, p); p += a.length; }
  return out;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = concat([typeBytes, data]);
  return concat([u32be(data.length), body, u32be(crc32(body))]);
}
// DEFLATE بكتل مُخزَّنة (stored, BTYPE=00) — بلا ضغط، صالح تماماً وفق RFC 1951
function deflateStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  const MAX = 65535;
  for (let i = 0; i < data.length || i === 0; i += MAX) {
    const slice = data.subarray(i, Math.min(i + MAX, data.length));
    const isFinal = i + MAX >= data.length;
    const len = slice.length;
    const nlen = (~len) & 0xffff;
    blocks.push(new Uint8Array([
      isFinal ? 1 : 0,
      len & 0xff, (len >>> 8) & 0xff,
      nlen & 0xff, (nlen >>> 8) & 0xff,
    ]));
    blocks.push(slice);
    if (data.length === 0) break;
  }
  return concat(blocks);
}
function zlibWrap(data: Uint8Array): Uint8Array {
  const header = new Uint8Array([0x78, 0x01]); // CMF/FLG بلا ضغط
  const deflated = deflateStore(data);
  const adler = u32be(adler32(data));
  return concat([header, deflated, adler]);
}

// يبني صورة PNG بتدرّج لوني حتمي مشتقّ من نص (seed) — لا نص/كتابة داخل الصورة.
export function buildPlaceholderPng(seed: string, width = 512, height = 512): Uint8Array {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c1 = [80 + (h % 120), 60 + ((h >> 4) % 120), 160 + ((h >> 8) % 90)];
  const c2 = [200 - (h % 100), 120 + ((h >> 6) % 110), 90 + ((h >> 10) % 130)];

  const raw = new Uint8Array(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // فلتر: بلا فلتر
    const ty = y / (height - 1 || 1);
    for (let x = 0; x < width; x++) {
      const tx = x / (width - 1 || 1);
      const t = (tx + ty) / 2;
      raw[p++] = Math.round(c1[0] + (c2[0] - c1[0]) * t);
      raw[p++] = Math.round(c1[1] + (c2[1] - c1[1]) * t);
      raw[p++] = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    }
  }

  const ihdr = concat([u32be(width), u32be(height), new Uint8Array([8, 2, 0, 0, 0])]); // 8-bit RGB
  const png = concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibWrap(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
  return png;
}
