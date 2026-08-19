// QrEncoder.gs — self-contained QR code matrix encoder (no external network call, per design
// spec §10 — the tournament can't depend on a third-party service being up mid-event).
// Byte mode, error-correction level M, any QR version 1-40 (auto-selected by data length).
//
// REWRITTEN 2026-08-19: the original hand-rolled implementation (Phase 4) was found live to
// produce QR codes that no real scanner — or an independent third-party decoder — could read
// at all, discovered chasing a "QR not recognized" bug report. Its own structural test only
// checked finder/timing patterns were present, never actual decodability (its header even
// flagged this: "not yet verified against a real QR scanner"). Verification method: dumped
// the raw matrix via a diagnostic action, fed it to `jsQR` (an established third-party
// decoder) through a rendering harness first validated with a known-good reference encoder
// (`qrcode` npm package) — the control test decoded correctly, the project's own encoder's
// output did not decode at all. Manually diffing the two implementations found a concrete
// bug: `_qrPlaceFormatInfo_`'s cell-index mapping had rows and columns transposed for the
// top-left format-info bits versus the ISO/IEC 18004 spec — exactly the kind of
// easy-to-transcribe-wrong bug format-info placement invites.
//
// Rather than patch that implementation bug-by-bug (real risk of missing another one just
// like it elsewhere), this is a fresh, faithful line-for-line port of the `qrcode` npm
// package's core algorithm (MIT licensed, itself based on Kazuhiko Arase's public-domain
// "QRCode for JavaScript") — kept structurally close to that verified reference rather than
// reorganized, specifically so it stays easy to diff against a working implementation if a
// bug is ever suspected again. GF(256) log/exp tables and generator polynomials are computed
// algorithmically at runtime, not hardcoded, for the same "less to transcribe wrong" reason
// the original file already followed. Verified against jsQR before being committed (see
// dev-log) — this must not ship again without that same live decode check.

const QR_MODE_BYTE = { bit: 1 << 2, ccBits: [8, 16, 16] }; // char-count indicator bits: v1-9, v10-26, v27-40
const QR_EC_LEVEL_M_BIT = 0; // format-info's 2-bit error-correction-level field for level M

// version -> total codewords (data + error correction) for that symbol size.
const QR_TOTAL_CODEWORDS = [0,
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
  404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
  1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185,
  2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706
];

// version -> [ecBlocks, ecCodewords] for error-correction level M only (this project's only
// supported level — see file header).
const QR_EC_M = [
  [1, 10], [1, 16], [1, 26], [2, 36], [2, 48], [4, 64], [4, 72], [4, 88], [5, 110], [5, 130],
  [5, 150], [8, 176], [9, 198], [9, 216], [10, 240], [10, 280], [11, 308], [13, 338], [14, 364], [16, 416],
  [17, 442], [17, 476], [18, 504], [20, 560], [21, 588], [23, 644], [25, 700], [26, 728], [28, 784], [29, 812],
  [31, 868], [33, 924], [35, 980], [37, 1036], [38, 1064], [40, 1120], [43, 1204], [45, 1260], [47, 1316], [49, 1372]
];

function _qrSymbolSize_(version) { return version * 4 + 17; }

function _qrBCHDigit_(data) {
  let digit = 0;
  while (data !== 0) { digit++; data >>>= 1; }
  return digit;
}

// --- Galois Field GF(256) --------------------------------------------------------------
function _qrGF_() {
  const EXP = new Array(512);
  const LOG = new Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D; // QR spec's primitive polynomial x^8+x^4+x^3+x^2+1
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  return {
    exp: function (n) { return EXP[n]; },
    log: function (n) { return LOG[n]; },
    mul: function (a, b) { if (a === 0 || b === 0) return 0; return EXP[LOG[a] + LOG[b]]; }
  };
}

function _qrPolyMul_(p1, p2, gf) {
  const coeff = new Array(p1.length + p2.length - 1).fill(0);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      coeff[i + j] ^= gf.mul(p1[i], p2[j]);
    }
  }
  return coeff;
}

function _qrGenerateECPolynomial_(degree, gf) {
  let poly = [1];
  for (let i = 0; i < degree; i++) poly = _qrPolyMul_(poly, [1, gf.exp(i)], gf);
  return poly;
}

// Reed-Solomon: returns the `degree` error-correction codewords for one block of data
// codewords, via polynomial long division in GF(256) (the standard LFSR-style formulation —
// equivalent to, but faster than, repeated polynomial-mod-with-leading-zero-stripping).
function _qrReedSolomonEncode_(dataCodewords, degree, gf) {
  const genPoly = _qrGenerateECPolynomial_(degree, gf);
  const buffer = dataCodewords.concat(new Array(degree).fill(0));
  for (let i = 0; i < dataCodewords.length; i++) {
    const coeff = buffer[i];
    if (coeff === 0) continue;
    for (let j = 0; j < genPoly.length; j++) {
      buffer[i + j] ^= gf.mul(genPoly[j], coeff);
    }
  }
  return buffer.slice(dataCodewords.length);
}

// --- Bit buffer --------------------------------------------------------------------------
function _qrBitBuffer_() {
  return {
    buffer: [], length: 0,
    putBit: function (bit) {
      const bufIndex = Math.floor(this.length / 8);
      if (this.buffer.length <= bufIndex) this.buffer.push(0);
      if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
      this.length++;
    },
    put: function (num, len) {
      for (let i = 0; i < len; i++) this.putBit(((num >>> (len - i - 1)) & 1) === 1);
    }
  };
}

// --- Version / capacity ------------------------------------------------------------------
function _qrCharCountIndicatorBits_(version) {
  if (version < 10) return QR_MODE_BYTE.ccBits[0];
  if (version < 27) return QR_MODE_BYTE.ccBits[1];
  return QR_MODE_BYTE.ccBits[2];
}

function _qrCapacityBytes_(version) {
  const totalCodewords = QR_TOTAL_CODEWORDS[version];
  const ecCodewords = QR_EC_M[version - 1][1];
  const dataBits = (totalCodewords - ecCodewords) * 8;
  const usableBits = dataBits - (4 + _qrCharCountIndicatorBits_(version)); // mode nibble + char count
  return Math.floor(usableBits / 8);
}

function _qrSelectVersion_(byteLength) {
  for (let v = 1; v <= 40; v++) {
    if (byteLength <= _qrCapacityBytes_(v)) return v;
  }
  throw apiError_('QR_TOKEN_TOO_LONG', 'Token is too long to encode in a QR code (max ~2950 bytes).');
}

// --- Finder / timing / alignment patterns -------------------------------------------------
function _qrPlaceFinderPattern_(matrix, reserved, size, row, col) {
  for (let r = -1; r <= 7; r++) {
    if (row + r <= -1 || size <= row + r) continue;
    for (let c = -1; c <= 7; c++) {
      if (col + c <= -1 || size <= col + c) continue;
      const isDark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      matrix[row + r][col + c] = isDark;
      reserved[row + r][col + c] = true;
    }
  }
}

function _qrSetupFinderPatterns_(matrix, reserved, size) {
  _qrPlaceFinderPattern_(matrix, reserved, size, 0, 0);
  _qrPlaceFinderPattern_(matrix, reserved, size, 0, size - 7);
  _qrPlaceFinderPattern_(matrix, reserved, size, size - 7, 0);
}

function _qrSetupTimingPattern_(matrix, reserved, size) {
  for (let r = 8; r < size - 8; r++) {
    const value = r % 2 === 0;
    matrix[r][6] = value; reserved[r][6] = true;
    matrix[6][r] = value; reserved[6][r] = true;
  }
}

// Row/column coordinates of alignment-pattern centers for this version (symmetric — same
// list used for both axes), per ISO/IEC 18004 §6.5.2. Version 1 has none.
function _qrAlignmentRowColCoords_(version) {
  if (version === 1) return [];
  const size = _qrSymbolSize_(version);
  const posCount = Math.floor(version / 7) + 2;
  const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
  const positions = [size - 7];
  for (let i = 1; i < posCount - 1; i++) positions[i] = positions[i - 1] - intervals;
  positions.push(6);
  return positions.reverse();
}

function _qrSetupAlignmentPattern_(matrix, reserved, size, version) {
  const coords = _qrAlignmentRowColCoords_(version);
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      // Skip the three positions that overlap a finder pattern's corner.
      if ((i === 0 && j === 0) || (i === 0 && j === coords.length - 1) || (i === coords.length - 1 && j === 0)) continue;
      const row = coords[i], col = coords[j];
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const isDark = (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
          matrix[row + r][col + c] = isDark;
          reserved[row + r][col + c] = true;
        }
      }
    }
  }
}

// --- Format info (error-correction level + mask pattern, duplicated twice for redundancy) --
// 15-bit sequence: 5 data bits (2-bit EC level + 3-bit mask) + 10 BCH error-correction bits
// (generator G15 = 0b10100110111, 0x537), then XORed with the fixed mask 0x5412 so no
// combination of level+mask ever produces an all-zero format string.
function _qrFormatInfoEncodedBits_(levelBit, mask) {
  const G15 = 0x537;
  const G15_MASK = 0x5412;
  const G15_BCH = _qrBCHDigit_(G15);
  const data = (levelBit << 3) | mask;
  let d = data << 10;
  while (_qrBCHDigit_(d) - G15_BCH >= 0) {
    d ^= (G15 << (_qrBCHDigit_(d) - G15_BCH));
  }
  return ((data << 10) | d) ^ G15_MASK;
}

// Placement kept line-for-line matched to the reference implementation's exact branch
// structure (not reorganized) — this exact cell-index mapping is where the previous
// implementation had a transposition bug, so faithfulness here matters more than tidiness.
function _qrSetupFormatInfo_(matrix, reserved, size, mask) {
  const bits = _qrFormatInfoEncodedBits_(QR_EC_LEVEL_M_BIT, mask);
  for (let i = 0; i < 15; i++) {
    const mod = ((bits >> i) & 1) === 1;

    // vertical (column 8, near the top-left finder pattern, then down the left edge)
    if (i < 6) { matrix[i][8] = mod; reserved[i][8] = true; }
    else if (i < 8) { matrix[i + 1][8] = mod; reserved[i + 1][8] = true; }
    else { matrix[size - 15 + i][8] = mod; reserved[size - 15 + i][8] = true; }

    // horizontal (row 8, along the top edge, then near the top-left finder pattern)
    if (i < 8) { matrix[8][size - i - 1] = mod; reserved[8][size - i - 1] = true; }
    else if (i < 9) { matrix[8][15 - i - 1 + 1] = mod; reserved[8][15 - i - 1 + 1] = true; }
    else { matrix[8][15 - i - 1] = mod; reserved[8][15 - i - 1] = true; }
  }
  // The one always-dark module adjacent to the bottom-left finder pattern.
  matrix[size - 8][8] = true; reserved[size - 8][8] = true;
}

// --- Data placement (zigzag, unmasked — masking is a separate pass, see _qrApplyMask_) -----
function _qrSetupData_(matrix, reserved, size, codewords) {
  const bits = [];
  codewords.forEach(function (byte) { for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1); });

  let inc = -1;
  let row = size - 1;
  let bitIndex = 0;

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing-pattern column

    while (true) {
      for (let c = 0; c < 2; c++) {
        if (!reserved[row][col - c]) {
          const dark = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
          matrix[row][col - c] = dark;
          bitIndex++;
        }
      }
      row += inc;
      if (row < 0 || size <= row) { row -= inc; inc = -inc; break; }
    }
  }
}

// --- Masking ---------------------------------------------------------------------------
function _qrMaskAt_(pattern, i, j) {
  switch (pattern) {
    case 0: return (i + j) % 2 === 0;
    case 1: return i % 2 === 0;
    case 2: return j % 3 === 0;
    case 3: return (i + j) % 3 === 0;
    case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return (i * j) % 2 + (i * j) % 3 === 0;
    case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
    case 7: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
    default: throw new Error('bad mask pattern: ' + pattern);
  }
}

function _qrApplyMask_(pattern, matrix, reserved, size) {
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (reserved[row][col]) continue;
      matrix[row][col] = matrix[row][col] !== _qrMaskAt_(pattern, row, col); // xor
    }
  }
}

// Penalty scoring (ISO/IEC 18004 §6.8.2 rules N1-N4), used only to pick the best of the 8
// mask patterns — any of the 8 produces a fully valid, decodable QR code; this only improves
// real-world scan reliability (contrast/pattern-confusion) on cheap phone cameras.
function _qrPenaltyN1_(matrix, size) {
  let points = 0;
  for (let row = 0; row < size; row++) {
    let sameCountCol = 0, sameCountRow = 0, lastCol = null, lastRow = null;
    for (let col = 0; col < size; col++) {
      let m = matrix[row][col];
      if (m === lastCol) sameCountCol++; else { if (sameCountCol >= 5) points += 3 + (sameCountCol - 5); lastCol = m; sameCountCol = 1; }
      m = matrix[col][row];
      if (m === lastRow) sameCountRow++; else { if (sameCountRow >= 5) points += 3 + (sameCountRow - 5); lastRow = m; sameCountRow = 1; }
    }
    if (sameCountCol >= 5) points += 3 + (sameCountCol - 5);
    if (sameCountRow >= 5) points += 3 + (sameCountRow - 5);
  }
  return points;
}

function _qrPenaltyN2_(matrix, size) {
  let points = 0;
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const dark = [matrix[row][col], matrix[row][col + 1], matrix[row + 1][col], matrix[row + 1][col + 1]]
        .filter(function (v) { return v; }).length;
      if (dark === 4 || dark === 0) points++;
    }
  }
  return points * 3;
}

function _qrPenaltyN3_(matrix, size) {
  let points = 0;
  for (let row = 0; row < size; row++) {
    let bitsCol = 0, bitsRow = 0;
    for (let col = 0; col < size; col++) {
      bitsCol = ((bitsCol << 1) & 0x7FF) | (matrix[row][col] ? 1 : 0);
      if (col >= 10 && (bitsCol === 0x5D0 || bitsCol === 0x05D)) points++;
      bitsRow = ((bitsRow << 1) & 0x7FF) | (matrix[col][row] ? 1 : 0);
      if (col >= 10 && (bitsRow === 0x5D0 || bitsRow === 0x05D)) points++;
    }
  }
  return points * 40;
}

function _qrPenaltyN4_(matrix, size) {
  let dark = 0;
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) if (matrix[row][col]) dark++;
  const k = Math.abs(Math.ceil((dark * 100 / (size * size)) / 5) - 10);
  return k * 10;
}

function _qrBestMask_(matrix, reserved, size) {
  let bestPattern = 0, lowestPenalty = Infinity;
  for (let p = 0; p < 8; p++) {
    _qrSetupFormatInfo_(matrix, reserved, size, p);
    _qrApplyMask_(p, matrix, reserved, size);
    const penalty = _qrPenaltyN1_(matrix, size) + _qrPenaltyN2_(matrix, size) + _qrPenaltyN3_(matrix, size) + _qrPenaltyN4_(matrix, size);
    _qrApplyMask_(p, matrix, reserved, size); // undo — masking twice with the same pattern is a no-op
    if (penalty < lowestPenalty) { lowestPenalty = penalty; bestPattern = p; }
  }
  return bestPattern;
}

// --- Codeword construction (mode/length header, data, terminator/padding, Reed-Solomon,
// block interleaving) --------------------------------------------------------------------
function _qrBuildCodewords_(text, version, gf) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xFF);

  const buffer = _qrBitBuffer_();
  buffer.put(QR_MODE_BYTE.bit, 4);
  buffer.put(bytes.length, _qrCharCountIndicatorBits_(version));
  bytes.forEach(function (b) { buffer.put(b, 8); });

  const totalCodewords = QR_TOTAL_CODEWORDS[version];
  const ecTotalCodewords = QR_EC_M[version - 1][1];
  const dataTotalBits = (totalCodewords - ecTotalCodewords) * 8;

  if (buffer.length + 4 <= dataTotalBits) buffer.put(0, 4); // terminator
  while (buffer.length % 8 !== 0) buffer.putBit(false); // pad to a byte boundary

  const dataCodewords = buffer.buffer.slice();
  const padBytes = [0xEC, 0x11];
  let padIndex = 0;
  while (dataCodewords.length < (dataTotalBits / 8)) {
    dataCodewords.push(padBytes[padIndex % 2]);
    padIndex++;
  }

  // Split into per-block data codewords, Reed-Solomon-encode each, interleave data-then-ECC
  // round-robin across blocks (ISO/IEC 18004 §6.6) — matters once a version needs >1 block;
  // for the single-block case this just returns data followed by its ECC codewords.
  const ecTotalBlocks = QR_EC_M[version - 1][0];
  const dataTotalCodewords = totalCodewords - ecTotalCodewords;
  const blocksInGroup2 = totalCodewords % ecTotalBlocks;
  const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
  const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
  const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
  const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
  const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;

  let offset = 0;
  const dcBlocks = [], ecBlocks = [];
  let maxDataSize = 0;
  for (let b = 0; b < ecTotalBlocks; b++) {
    const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
    const block = dataCodewords.slice(offset, offset + dataSize);
    dcBlocks.push(block);
    ecBlocks.push(_qrReedSolomonEncode_(block, ecCount, gf));
    offset += dataSize;
    maxDataSize = Math.max(maxDataSize, dataSize);
  }

  const interleaved = [];
  for (let i = 0; i < maxDataSize; i++) for (let b = 0; b < ecTotalBlocks; b++) if (i < dcBlocks[b].length) interleaved.push(dcBlocks[b][i]);
  for (let i = 0; i < ecCount; i++) for (let b = 0; b < ecTotalBlocks; b++) interleaved.push(ecBlocks[b][i]);
  return interleaved;
}

// Public entry point: returns { size, matrix, version } where matrix[row][col] is true for a
// dark module, false for light. `text` should already be the exact token string to encode
// (ASCII — this project's tokens are always hex characters).
function qrEncode_(text) {
  const gf = _qrGF_();
  const version = _qrSelectVersion_(text.length);
  const size = _qrSymbolSize_(version);
  const matrix = [], reserved = [];
  for (let r = 0; r < size; r++) { matrix.push(new Array(size).fill(false)); reserved.push(new Array(size).fill(false)); }

  _qrSetupFinderPatterns_(matrix, reserved, size);
  _qrSetupTimingPattern_(matrix, reserved, size);
  _qrSetupAlignmentPattern_(matrix, reserved, size, version);
  // Reserve the format-info cells now (value irrelevant — real bits written after mask
  // selection below) so data placement never writes into them.
  _qrSetupFormatInfo_(matrix, reserved, size, 0);

  const codewords = _qrBuildCodewords_(text, version, gf);
  _qrSetupData_(matrix, reserved, size, codewords);

  const bestMask = _qrBestMask_(matrix, reserved, size);
  _qrApplyMask_(bestMask, matrix, reserved, size);
  _qrSetupFormatInfo_(matrix, reserved, size, bestMask); // overwrite placeholder with real bits

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
