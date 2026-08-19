// IdGenerator.gs — locked, counter-based ID/document-number allocator.
// Every counter lives as a SETTINGS row keyed "Counter_<prefix>_Next", auto-initialized to 1.

function nextId_(prefix, padding) {
  padding = padding || ID_PADDING_OVERRIDES[prefix] || 4;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const key = 'Counter_' + prefix + '_Next';
    const current = parseInt(getSetting_(key, '1'), 10);
    setSetting_(key, String(current + 1), 'system');
    const padded = String(current).padStart(padding, '0');
    return prefix + '-' + padded;
  } finally {
    lock.releaseLock();
  }
}

// Bulk form of nextId_ — one lock acquisition/SETTINGS read-write for N ids instead of N.
// See SheetHelpers.gs's appendRows_ for why this matters at real team-size scale.
function nextIdBatch_(prefix, count, padding) {
  padding = padding || ID_PADDING_OVERRIDES[prefix] || 4;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const key = 'Counter_' + prefix + '_Next';
    const current = parseInt(getSetting_(key, '1'), 10);
    setSetting_(key, String(current + count), 'system');
    const ids = [];
    for (let i = 0; i < count; i++) {
      ids.push(prefix + '-' + String(current + i).padStart(padding, '0'));
    }
    return ids;
  } finally {
    lock.releaseLock();
  }
}

// Admin-configurable document numbers (Registration/Receipt/Coupon/Refund/Relieving/
// Accommodation) — distinct from nextId_'s internal record IDs. Reads
// Numbering_<type>_Prefix/Next/Padding from SETTINGS (seeded by Phase 1's seedSettings_).
function nextDocumentNumber_(type) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const prefix = getSetting_('Numbering_' + type + '_Prefix', '');
    const next = parseInt(getSetting_('Numbering_' + type + '_Next', '1'), 10);
    const padding = parseInt(getSetting_('Numbering_' + type + '_Padding', '3'), 10);
    setSetting_('Numbering_' + type + '_Next', String(next + 1), 'system');
    return prefix + String(next).padStart(padding, '0');
  } finally {
    lock.releaseLock();
  }
}
