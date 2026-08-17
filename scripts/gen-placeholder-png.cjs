/**
 * Generate placeholder PNG files for demo logos.
 * Creates minimal valid PNG files that can be replaced by the user.
 * Usage: node scripts/gen-placeholder-png.js
 */
const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePNG(width, height, r, g, b, a) {
  const raw = Buffer.alloc(1 + 4 * height * width);
  for (let y = 0; y < height; y++) {
    raw[y * (4 * width + 1)] = 0; // filter byte None
    for (let x = 0; x < width; x++) {
      const i = y * (4 * width + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const deflated = zlib.deflateSync(raw);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflated),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Indigo-blue placeholder logos
const icon = makePNG(200, 60, 79, 70, 229, 255);
const full = makePNG(400, 120, 79, 70, 229, 255);

fs.writeFileSync('src/assets/login/demo-logo-icon.png', icon);
fs.writeFileSync('src/assets/login/demo-logo-full.png', full);

console.log('Created placeholder PNGs:');
console.log('  src/assets/login/demo-logo-icon.png (' + icon.length + ' bytes)');
console.log('  src/assets/login/demo-logo-full.png (' + full.length + ' bytes)');
