import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportExcel } from '../src/export.js';

test('Excel download contains accurate durations, safe text, and real clickable links', async t => {
  let capturedBlob;
  let clicked = false;
  let removed = false;
  let revoke;
  const anchor = { click() { clicked = true; }, remove() { removed = true; } };
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) { assert.equal(tag, 'a'); return anchor; },
    body: { append(value) { assert.equal(value, anchor); } },
  };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  t.mock.method(URL, 'createObjectURL', blob => { capturedBlob = blob; return 'blob:export-test'; });
  const revoked = t.mock.method(URL, 'revokeObjectURL', () => {});
  const actualTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 10000) { revoke = callback; return 0; }
    return actualTimeout(callback, delay, ...args);
  });

  await exportExcel([
    { position: 1, title: '=SUM(1,2)', channel: '@unsafe', seconds: 3661, url: 'https://www.youtube.com/watch?v=abcdefghijk', unavailable: false },
    { position: 2, title: 'Unavailable video', channel: '', seconds: 0, url: 'javascript:alert(1)', unavailable: true },
    { position: 3, title: 'Second lesson', channel: 'Teacher', seconds: 120, url: 'https://youtu.be/lmnopqrstuv', unavailable: false },
  ], { title: '=Export / Example', speed: 2 });

  assert.ok(clicked && removed);
  assert.equal(anchor.download, 'export-example.xlsx');
  assert.equal(anchor.href, 'blob:export-test');
  assert.equal(capturedBlob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await capturedBlob.arrayBuffer());
  const sheet = workbook.getWorksheet('Playlist videos');
  assert.equal(sheet.rowCount, 4);
  assert.equal(sheet.getCell('B2').value, "'=SUM(1,2)");
  assert.equal(sheet.getCell('C2').value, "'@unsafe");
  assert.equal(sheet.getCell('D2').value, 3661);
  assert.equal(sheet.getCell('E2').value.getTime() - Date.UTC(1899, 11, 30), 3661 * 1000);
  assert.equal(sheet.getCell('F2').value.getTime() - Date.UTC(1899, 11, 30), 3661 / 2 * 1000);
  assert.equal(sheet.getCell('E2').numFmt, '[h]:mm:ss');
  assert.deepEqual(sheet.getCell('G2').value, { text: 'https://www.youtube.com/watch?v=abcdefghijk', hyperlink: 'https://www.youtube.com/watch?v=abcdefghijk' });
  assert.equal(sheet.getCell('G3').value, '');
  assert.equal(sheet.getCell('D3').value, null);
  assert.equal(sheet.getCell('H3').value, 'Excluded / unavailable');
  for (const row of sheet.getRows(1, 4)) row.eachCell(cell => assert.equal(cell.formula, undefined));
  const summary = workbook.getWorksheet('Summary');
  assert.equal(summary.getCell('B1').value, "'=Export / Example");
  assert.equal(summary.getCell('B3').value, 2);
  assert.equal(summary.getCell('B4').value, 1);
  assert.equal(summary.getCell('B6').value, 3781);
  assert.equal(summary.getCell('B7').value, 1890.5);
  assert.equal(revoked.mock.callCount(), 0);
  revoke();
  assert.equal(revoked.mock.calls[0].arguments[0], 'blob:export-test');
});

test('Excel export rejects invalid speed before creating a download', async () => {
  await assert.rejects(exportExcel([], { speed: 0 }), /valid playback speed/);
  await assert.rejects(exportExcel([], { speed: NaN }), /valid playback speed/);
});
