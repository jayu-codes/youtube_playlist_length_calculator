/** Create an Excel workbook on demand. No video data leaves the browser. */
export async function exportExcel(entries, { title = 'Playlist Clock', speed = 1 } = {}) {
  if (!Number.isFinite(Number(speed)) || Number(speed) <= 0) throw new Error('Choose a valid playback speed before exporting.');
  const module = await import('exceljs');
  const ExcelJS = module.default || module;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Playlist Clock';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Playlist videos', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 22 },
  });
  sheet.columns = [
    { header: 'Position', key: 'position', width: 12 },
    { header: 'Video title', key: 'title', width: 60 },
    { header: 'Channel', key: 'channel', width: 28 },
    { header: 'Duration (seconds)', key: 'seconds', width: 22 },
    { header: 'Duration', key: 'duration', width: 19 },
    { header: `Watch time at ${Number(speed)}x`, key: 'adjusted', width: 24 },
    { header: 'YouTube link', key: 'url', width: 60 },
    { header: 'Status', key: 'status', width: 22 },
  ];
  const safeText = value => {
    const text = String(value ?? '').slice(0, 32700);
    // ExcelJS stores strings as strings, but also protect data copied into CSV.
    return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  };
  for (const entry of entries) {
    const available = !entry.unavailable && Number.isFinite(entry.seconds) && entry.seconds > 0;
    let link = null;
    try {
      const parsed = new URL(entry.url);
      if (parsed.protocol === 'https:' && ['www.youtube.com', 'youtube.com', 'youtu.be'].includes(parsed.hostname)) link = parsed.href;
    } catch { /* An unavailable entry can have no video link. */ }
    const row = sheet.addRow({
      position: Number(entry.position) || '',
      title: safeText(entry.title),
      channel: safeText(entry.channel),
      seconds: available ? entry.seconds : null,
      duration: available ? entry.seconds / 86400 : null,
      adjusted: available ? entry.seconds / Number(speed) / 86400 : null,
      url: link ? { text: link, hyperlink: link } : '',
      status: available ? 'Included' : 'Excluded / unavailable',
    });
    row.getCell('duration').numFmt = '[h]:mm:ss';
    row.getCell('adjusted').numFmt = '[h]:mm:ss';
    if (link) row.getCell('url').font = { color: { argb: 'FF5965E8' }, underline: true };
    if (row.number % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4FA' } };
  }
  const header = sheet.getRow(1);
  header.height = 30;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF282A45' } };
  sheet.autoFilter = { from: 'A1', to: `H${Math.max(1, sheet.rowCount)}` };
  const summary = workbook.addWorksheet('Summary');
  const valid = entries.filter(entry => !entry.unavailable && Number.isFinite(entry.seconds) && entry.seconds > 0);
  const seconds = valid.reduce((sum, entry) => sum + entry.seconds, 0);
  summary.columns = [{ width: 30 }, { width: 65 }];
  summary.addRows([
    ['Playlist', safeText(title)],
    ['Exported entries', entries.length],
    ['Videos with duration', valid.length],
    ['Excluded entries', entries.length - valid.length],
    ['Playback speed', Number(speed)],
    ['Original duration (seconds)', seconds],
    ['Watch time (seconds)', seconds / Number(speed)],
    ['Note', 'Estimated playback only. Ads, breaks, and pauses are not included.'],
  ]);
  const data = await workbook.xlsx.writeBuffer();
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'playlist-clock'}.xlsx`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser time to start reading the download before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
