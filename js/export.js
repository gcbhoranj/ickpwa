// export.js — shared Excel export helper for Reports (reports.js), Teams (registration.js),
// and Audit Log (reports.js). PDF is handled separately via window.print() + the .no-print
// CSS class in app.css — no library needed for that.
//
// Uses the vendored SheetJS build (js/vendor/xlsx.full.min.js) so exports work fully offline,
// same as the rest of this PWA. Must be loaded before this file — see index.html/service-worker.js.

// sheets: [{ name: 'Sheet Name', headers: ['Col A', 'Col B'], rows: [[v1, v2], ...] }, ...]
// Building from arrays-of-arrays (rather than scraping the rendered <table>) keeps numbers as
// numbers and gives each sheet control over column labels/order independent of the HTML.
function exportRowsToXlsx(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(function (sheet) {
    const aoa = [sheet.headers].concat(sheet.rows);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Excel sheet names: max 31 chars, no []:*?/\ characters.
    const safeName = sheet.name.replace(/[\[\]:*?/\\]/g, '').substring(0, 31) || 'Sheet1';
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  });
  XLSX.writeFile(wb, filename);
}

// Today's date as YYYY-MM-DD, for filenames.
function _exportDateStamp() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
