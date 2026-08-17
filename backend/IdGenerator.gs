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
