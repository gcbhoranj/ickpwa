// QrEncoder.gs — self-contained QR code matrix encoder (no external network call, per design
// spec §10 — the tournament can't depend on a third-party service being up mid-event).
// Supports QR versions 1-6, Byte mode, error-correction level M, a FIXED mask pattern (0).
// Using a fixed mask instead of evaluating all 8 candidate masks for lowest penalty score is a
// deliberate scope reduction: per the ISO/IEC 18004 standard, ANY of the 8 mask patterns
// produces a fully valid, scannable QR code — mask selection is a scan-reliability
// *optimization*, not a correctness requirement, and skipping it removes a large surface for
// transcription bugs. GF(256) log/exp tables and generator polynomials are computed
// algorithmically at runtime (not hardcoded) for the same reason — only the small
// per-version block-count/capacity table and alignment-pattern-position table below are
// literal constants, keeping the amount of "must be exactly right from memory" data as small
// as possible.
//
// **This code has not been verified against a real QR scanner as of authoring — flagged
// explicitly for a real-device scan test before being considered trustworthy.**

const QR_MODE_BYTE = 4; // mode indicator nibble for 8-bit byte mode

// [version]: { totalCodewords, dataCodewordsPerBlock, eccCodewordsPerBlock, numBlocks }
// Level M only, versions 1-6 only (byte-mode capacity: v1=14, v2=26, v3=42, v4=62 (2 blocks x
// 31... see below), v5=84, v6=106 usable data bytes after the 3-byte mode+length header —
// comfortably covers any reasonable token length for this project).
const QR_RS_BLOCK_TABLE_M = {
  1: { totalCodewords: 26, dataPerBlock: 16, eccPerBlock: 10, numBlocks: 1 },
  2: { totalCodewords: 44, dataPerBlock: 28, eccPerBlock: 16, numBlocks: 1 },
  3: { totalCodewords: 70, dataPerBlock: 44, eccPerBlock: 26, numBlocks: 1 },
  4: { totalCodewords: 100, dataPerBlock: 32, eccPerBlock: 18, numBlocks: 2 },
  5: { totalCodewords: 134, dataPerBlock: 43, eccPerBlock: 24, numBlocks: 2 },
  6: { totalCodewords: 172, dataPerBlock: 27, eccPerBlock: 16, numBlocks: 4 }
};

// Alignment pattern coordinate list per version (versions 1-6 use at most a 2-element list;
// version 1 has none). Positions that would overlap a finder-pattern zone (any coordinate
// pair within 8 modules of a corner) are skipped when placing.
const QR_ALIGNMENT_COORDS = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

function _qrModuleCount_(version) {
  return 17 + 4 * version;
}

function _qrBuildGaloisTables_() {
  const EXP = new Array(256);
  const LOG = new Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = x << 1;
    if (x & 0x100) x = x ^ 0x11D; // primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  return { EXP: EXP, LOG: LOG };
}

function _qrGfMul_(a, b, gf) {
  if (a === 0 || b === 0) return 0;
  return gf.EXP[(gf.LOG[a] + gf.LOG[b]) % 255];
}

// Multiplies two polynomials (arrays of coefficients, highest degree first) over GF(256).
function _qrPolyMultiply_(p1, p2, gf) {
  const result = new Array(p1.length + p2.length - 1).fill(0);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= _qrGfMul_(p1[i], p2[j], gf);
    }
  }
  return result;
}

// Builds the generator polynomial for `eccCount` error-correction codewords:
// (x - EXP[0])(x - EXP[1])...(x - EXP[eccCount-1])
function _qrGeneratorPolynomial_(eccCount, gf) {
  let poly = [1];
  for (let i = 0; i < eccCount; i++) {
    poly = _qrPolyMultiply_(poly, [1, gf.EXP[i]], gf);
  }
  return poly;
}

// Reed-Solomon encode: returns the ECC codewords for one block of data codewords.
function _qrRsEncodeBlock_(dataCodewords, eccCount, gf) {
  const generator = _qrGeneratorPolynomial_(eccCount, gf);
  const buffer = dataCodewords.concat(new Array(eccCount).fill(0));
  for (let i = 0; i < dataCodewords.length; i++) {
    const coef = buffer[i];
    if (coef === 0) continue;
    const factor = gf.LOG[coef];
    for (let j = 0; j < generator.length; j++) {
      if (generator[j] === 0) continue;
      buffer[i + j] ^= gf.EXP[(factor + gf.LOG[generator[j]]) % 255];
    }
  }
  return buffer.slice(dataCodewords.length);
}

// Picks the smallest supported version (1-6) whose Level-M data capacity fits the payload
// (mode nibble + 8-bit length + the byte data itself).
function _qrSelectVersion_(byteLength) {
  for (let v = 1; v <= 6; v++) {
    const block = QR_RS_BLOCK_TABLE_M[v];
    const totalDataCodewords = block.dataPerBlock * block.numBlocks;
    // 1 byte for mode+length header (4-bit mode nibble + 8-bit length fits in 12 bits,
    // rounds up to 2 bytes) + the payload bytes, must fit within totalDataCodewords.
    if (byteLength + 2 <= totalDataCodewords) return v;
  }
  throw apiError_('QR_TOKEN_TOO_LONG', 'Token is too long to encode at supported QR versions (max ~104 bytes).');
}

// Builds the full data-codeword sequence (mode + length + payload bytes + padding),
// split across blocks, then Reed-Solomon-encoded and interleaved per the standard's
// codeword-interleaving rule (round-robin across blocks, data first then ECC).
function _qrBuildCodewords_(text, version, gf) {
  const block = QR_RS_BLOCK_TABLE_M[version];
  const totalDataCodewords = block.dataPerBlock * block.numBlocks;
  const bytes = [];
  for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xFF);

  // Bit buffer: mode (4 bits) + length (8 bits, byte-mode length field for versions 1-9) +
  // data bytes (8 bits each) + terminator/padding to fill totalDataCodewords bytes.
  const bits = [];
  function pushBits(value, count) {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
  }
  pushBits(QR_MODE_BYTE, 4);
  pushBits(bytes.length, 8);
  bytes.forEach(function (b) { pushBits(b, 8); });
  // Terminator (up to 4 zero bits), then pad to a byte boundary, then pad bytes 0xEC/0x11.
  for (let i = 0; i < 4 && bits.length < totalDataCodewords * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCodewordsAll = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataCodewordsAll.push(byte);
  }
  const padBytes = [0xEC, 0x11];
  let padIndex = 0;
  while (dataCodewordsAll.length < totalDataCodewords) {
    dataCodewordsAll.push(padBytes[padIndex % 2]);
    padIndex++;
  }

  // Split into per-block data codewords, RS-encode each block's ECC codewords.
  const dataBlocks = [];
  const eccBlocks = [];
  for (let b = 0; b < block.numBlocks; b++) {
    const blockData = dataCodewordsAll.slice(b * block.dataPerBlock, (b + 1) * block.dataPerBlock);
    dataBlocks.push(blockData);
    eccBlocks.push(_qrRsEncodeBlock_(blockData, block.eccPerBlock, gf));
  }

  // Interleave: all data codewords round-robin, then all ECC codewords round-robin.
  const interleaved = [];
  for (let i = 0; i < block.dataPerBlock; i++) {
    for (let b = 0; b < block.numBlocks; b++) interleaved.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < block.eccPerBlock; i++) {
    for (let b = 0; b < block.numBlocks; b++) interleaved.push(eccBlocks[b][i]);
  }
  return interleaved;
}

function _qrPlaceFinderPattern_(matrix, reserved, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || rr >= matrix.length || cc < 0 || cc >= matrix.length) continue;
      const isDark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      matrix[rr][cc] = isDark;
      reserved[rr][cc] = true;
    }
  }
}

function _qrPlaceAlignmentPattern_(matrix, reserved, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = row + r, cc = col + c;
      const isDark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      matrix[rr][cc] = isDark;
      reserved[rr][cc] = true;
    }
  }
}

function _qrPlaceTimingPatterns_(matrix, reserved, size) {
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    if (!reserved[6][i]) { matrix[6][i] = dark; reserved[6][i] = true; }
    if (!reserved[i][6]) { matrix[i][6] = dark; reserved[i][6] = true; }
  }
}

// Format info: 5 data bits (2-bit ECC level + 3-bit mask pattern) + 10 BCH error-correction
// bits (generator G15 = 0x537), XORed with the standard mask 0x5412, per ISO/IEC 18004.
function _qrFormatInfoBits_(eccLevelBits, maskPattern) {
  const data = (eccLevelBits << 3) | maskPattern;
  let d = data << 10;
  const g15 = 0x537;
  for (let i = 4; i >= 0; i--) {
    if ((d >> (i + 10)) & 1) d ^= g15 << i;
  }
  return ((data << 10) | d) ^ 0x5412;
}

function _qrPlaceFormatInfo_(matrix, reserved, size, maskPattern) {
  // ECC level M = 0b00 per the standard's format-info level bits.
  const bits = _qrFormatInfoBits_(0, maskPattern);
  function bit(i) { return (bits >> i) & 1; }
  // Around the top-left finder pattern.
  for (let i = 0; i <= 5; i++) { matrix[8][i] = !!bit(i); reserved[8][i] = true; }
  matrix[8][7] = !!bit(6); reserved[8][7] = true;
  matrix[8][8] = !!bit(7); reserved[8][8] = true;
  matrix[7][8] = !!bit(8); reserved[7][8] = true;
  for (let i = 9; i < 15; i++) { matrix[14 - i][8] = !!bit(i); reserved[14 - i][8] = true; }
  // Bottom-left (column 8, rows size-1..size-7) and top-right (row 8, cols size-8..size-1).
  for (let i = 0; i < 8; i++) { matrix[size - 1 - i][8] = !!bit(i); reserved[size - 1 - i][8] = true; }
  for (let i = 8; i < 15; i++) { matrix[8][size - 15 + i] = !!bit(i); reserved[8][size - 15 + i] = true; }
  // The one always-dark module adjacent to the bottom-left finder pattern.
  matrix[size - 8][8] = true; reserved[size - 8][8] = true;
}

function _qrPlaceData_(matrix, reserved, size, codewords, maskPattern) {
  const bits = [];
  codewords.forEach(function (byte) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  });
  let bitIndex = 0;
  let col = size - 1;
  let upward = true;
  while (col > 0) {
    if (col === 6) col--; // skip the vertical timing-pattern column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row][cc]) continue;
        let value = bitIndex < bits.length ? bits[bitIndex] : 0;
        bitIndex++;
        // Mask pattern 0: (row + col) % 2 === 0 flips the module.
        if ((row + cc) % 2 === 0) value = value ^ 1;
        matrix[row][cc] = !!value;
      }
    }
    upward = !upward;
    col -= 2;
  }
}

// Public entry point: returns { size, matrix } where matrix[row][col] is true for a dark
// module, false for light. `text` should already be the exact token string to encode.
function qrEncode_(text) {
  const gf = _qrBuildGaloisTables_();
  const version = _qrSelectVersion_(text.length);
  const size = _qrModuleCount_(version);
  const matrix = [];
  const reserved = [];
  for (let r = 0; r < size; r++) {
    matrix.push(new Array(size).fill(false));
    reserved.push(new Array(size).fill(false));
  }

  _qrPlaceFinderPattern_(matrix, reserved, 0, 0);
  _qrPlaceFinderPattern_(matrix, reserved, 0, size - 7);
  _qrPlaceFinderPattern_(matrix, reserved, size - 7, 0);
  _qrPlaceTimingPatterns_(matrix, reserved, size);

  const alignCoords = QR_ALIGNMENT_COORDS[version] || [];
  alignCoords.forEach(function (r) {
    alignCoords.forEach(function (c) {
      if (reserved[r][c]) return; // skip positions overlapping a finder-pattern zone
      _qrPlaceAlignmentPattern_(matrix, reserved, r, c);
    });
  });

  _qrPlaceFormatInfo_(matrix, reserved, size, 0);

  const codewords = _qrBuildCodewords_(text, version, gf);
  _qrPlaceData_(matrix, reserved, size, codewords, 0);

  return { size: size, matrix: matrix, version: version };
}

// Appends the batchUpdate requests needed to draw one QR matrix as a grid of solid-fill
// rectangle shapes onto `pageObjectId`, inside a `moduleCount x moduleCount` region starting
// at (left, top) with each module `moduleSizePt` points square. Adjacent same-color modules
// in a row are merged into one wider rectangle to keep the shape count down. A white
// quiet-zone rectangle is drawn first so the code reads correctly against any background.
// `idPrefix` must be unique per QR instance within the presentation (object IDs are
// presentation-wide) — e.g. include a page/cell index when drawing many QRs across a sheet.
//
// History: an earlier version of this function used the Advanced Slides Service's
// `Presentations.batchUpdate` to send every shape for one QR in a single network round-trip,
// instead of one round-trip per shape via the basic SlidesApp service — measured ~12 seconds
// per QR with the basic service, a genuine problem (a single food-package purchase took up
// to 48 seconds, and system.selfTest's several packages together blew past Apps Script's
// 6-minute execution limit). The batched version was FASTER but proved unreliable live: for
// this document's QR (a few hundred shapes), `batchUpdate` intermittently failed partway
// through a single request array with "the page could not be found" — on a page every
// surrounding request in the same call addressed successfully — at a different, seemingly
// random position each time, including after a same-chunk retry. That's a correctness risk
// this project won't accept for a document coupons/mess-scanning ultimately depend on.
// Reverted to the slower-but-reliable basic-service approach; the original speed problem is
// instead solved by keeping single actions safely fast (already true — a purchase completes
// in well under Apps Script's execution limit even at ~12s/QR) and by system.selfTestSplit
// (Main.gs) for the test suite, which no longer needs to fit in one execution.
function qrDrawOnSlide_(slide, qr, left, top, moduleSizePt) {
  const quietZoneModules = 4; // ISO/IEC 18004 minimum quiet zone
  const totalModules = qr.size + quietZoneModules * 2;
  const totalSizePt = totalModules * moduleSizePt;
  const quietRect = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, left, top, totalSizePt, totalSizePt);
  quietRect.getFill().setSolidFill('#FFFFFF');
  quietRect.getBorder().setTransparent();

  const offset = quietZoneModules * moduleSizePt;
  for (let r = 0; r < qr.size; r++) {
    let c = 0;
    while (c < qr.size) {
      if (!qr.matrix[r][c]) { c++; continue; }
      let runEnd = c;
      while (runEnd + 1 < qr.size && qr.matrix[r][runEnd + 1]) runEnd++;
      const runLength = runEnd - c + 1;
      const rect = slide.insertShape(
        SlidesApp.ShapeType.RECTANGLE,
        left + offset + c * moduleSizePt, top + offset + r * moduleSizePt,
        runLength * moduleSizePt, moduleSizePt
      );
      rect.getFill().setSolidFill('#000000');
      rect.getBorder().setTransparent();
      c = runEnd + 1;
    }
  }
}
