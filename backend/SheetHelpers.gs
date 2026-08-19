// SheetHelpers.gs — generic, schema-driven CRUD used by every later phase.

let _ss = null;
function getSpreadsheet_() {
  if (!_ss) _ss = SpreadsheetApp.openById(SHEET_ID);
  return _ss;
}

function ensureSheet_(name) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  const headers = SHEET_SCHEMAS[name];
  if (!headers) throw apiError_('UNKNOWN_SHEET', 'No schema defined for sheet: ' + name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const existingHeaderRange = sheet.getRange(1, 1, 1, headers.length);
  const existingHeaders = sheet.getLastRow() >= 1 ? existingHeaderRange.getValues()[0] : [];
  const headersMatch = headers.every(function (h, i) { return existingHeaders[i] === h; });
  if (!headersMatch) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  // Format the data range as plain text to prevent Google Sheets from auto-converting
  // strings that look like dates, booleans, or numbers. This ensures all cell values
  // round-trip correctly through setValues/getValues without type coercion.
  const dataRange = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), headers.length);
  dataRange.setNumberFormat('@'); // '@' = plain text format
  return sheet;
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw apiError_('SHEET_NOT_FOUND', 'Sheet not found: ' + name + ' — run admin.bootstrap.setupSchema first.');
  return sheet;
}

function headerIndex_(sheet) {
  const headers = SHEET_SCHEMAS[sheet.getName()];
  const map = {};
  headers.forEach(function (h, i) { map[h] = i; });
  return map;
}

function appendRow_(sheetName, obj) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const row = headers.map(function (h) {
    return obj.hasOwnProperty(h) ? obj[h] : '';
  });
  // Root-cause fix (found in Phase 3, deferred as a known risk since Phase 1): formatting
  // AFTER sheet.appendRow(row) does not retroactively fix a value Sheets already auto-typed
  // at write time (e.g. the string 'true' silently becoming a native boolean) — the format
  // change only affects future entries into that cell, not the one just written. Determine
  // the target row ourselves and format it as plain text BEFORE writing, matching
  // updateRowById_'s already-correct order, so every appendRow_ call across all 25 sheets is
  // protected the same way, not just the ones that happened to get manually tolerant-reader
  // workarounds (like _isActiveFlag_).
  const newRowNum = sheet.getLastRow() + 1;
  const targetRange = sheet.getRange(newRowNum, 1, 1, headers.length);
  targetRange.setNumberFormat('@');
  targetRange.setValues([row]);
  return obj;
}

// Bulk form of appendRow_ — one Sheets API round trip for N rows instead of N. Matters at
// real scale: FoodPackages.gs's printed-coupon batch writes one row per eligible person, and
// a college contingent can run 15-25+ people — N individual appendRow_ calls there was a
// measured, live-confirmed contributor to a single package purchase taking tens of seconds
// (see FoodPackages.gs's header note). Same plain-text-before-write safety as appendRow_.
function appendRows_(sheetName, objs) {
  if (!objs || objs.length === 0) return objs;
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const rows = objs.map(function (obj) {
    return headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  });
  const startRow = sheet.getLastRow() + 1;
  const targetRange = sheet.getRange(startRow, 1, rows.length, headers.length);
  targetRange.setNumberFormat('@');
  targetRange.setValues(rows);
  return objs;
}

function rowsToObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function findRowById_(sheetName, idColumn, idValue) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const colIndex = headers.indexOf(idColumn);
  if (colIndex === -1) throw apiError_('BAD_COLUMN', idColumn + ' is not a column of ' + sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][colIndex] === idValue) {
      const obj = {};
      headers.forEach(function (h, j) { obj[h] = values[i][j]; });
      return { rowNumber: i + 2, values: obj };
    }
  }
  return null;
}

function updateRowById_(sheetName, idColumn, idValue, patch) {
  const found = findRowById_(sheetName, idColumn, idValue);
  if (!found) throw apiError_('NOT_FOUND', sheetName + ' row not found for ' + idColumn + '=' + idValue);
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const merged = {};
  // Copy existing values
  for (const key in found.values) {
    if (found.values.hasOwnProperty(key)) {
      merged[key] = found.values[key];
    }
  }
  // Apply patch
  for (const key in patch) {
    if (patch.hasOwnProperty(key)) {
      merged[key] = patch[key];
    }
  }
  const row = headers.map(function (h) { return merged[h]; });
  // Format the row as plain text before writing to prevent Google Sheets from auto-converting
  // string values like '2026-09-21' to dates or 'false' to booleans.
  sheet.getRange(found.rowNumber, 1, 1, headers.length).setNumberFormat('@');
  sheet.getRange(found.rowNumber, 1, 1, headers.length).setValues([row]);
  return merged;
}

function findRowsByField_(sheetName, fieldName, value) {
  return rowsToObjects_(sheetName).filter(function (row) { return row[fieldName] === value; });
}

// TEST-FIXTURE CLEANUP ONLY. Production handlers must never call this — transaction/config
// tabs are append-only per the spec (§5, §78 of the original prompt).
function deleteRowById_(sheetName, idColumn, idValue) {
  const found = findRowById_(sheetName, idColumn, idValue);
  if (!found) return false;
  getSheet_(sheetName).deleteRow(found.rowNumber);
  return true;
}

function getSetting_(key, defaultValue) {
  const found = findRowById_('SETTINGS', 'Key', key);
  return found ? found.values.Value : defaultValue;
}

function setSetting_(key, value, actorId) {
  const found = findRowById_('SETTINGS', 'Key', key);
  const now = new Date().toISOString();
  if (found) {
    updateRowById_('SETTINGS', 'Key', key, { Value: value, UpdatedBy: actorId || 'system', UpdatedAt: now });
  } else {
    appendRow_('SETTINGS', { Key: key, Value: value, UpdatedBy: actorId || 'system', UpdatedAt: now });
  }
}
