import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSources, parseDuration, loadSources, selectEntries, summarize, duration, planSchedule } from '../src/core.js';

const ID = 'abcdefghijk';
const PLAYLIST = 'PLabcdefghijklmnop';
const source = parseSources(PLAYLIST);
const response = (items, extra = {}) => ({ ok: true, status: 200, json: async () => ({ items, ...extra }) });
const video = (id, length = 'PT10M', liveBroadcastContent = 'none') => ({ id, snippet: { title: `Video ${id}`, channelTitle: 'Example channel', liveBroadcastContent, thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } } }, contentDetails: { duration: length } });
const entry = (id, position) => ({ snippet: { position, title: `Entry ${position}` }, contentDetails: { videoId: id } });

test('parses supported playlist and video inputs without accepting unrelated hosts', () => {
  for (const input of [PLAYLIST, `https://www.youtube.com/playlist?list=${PLAYLIST}`, `youtube.com/watch?v=${ID}&list=${PLAYLIST}`, `https://music.youtube.com/playlist?list=${PLAYLIST}`]) {
    assert.deepEqual(parseSources(input)[0], { type: 'playlist', id: PLAYLIST, url: `https://www.youtube.com/playlist?list=${PLAYLIST}` });
  }
  for (const input of [ID, `https://youtu.be/${ID}`, `https://youtube.com/shorts/${ID}`, `https://youtube.com/live/${ID}`, `https://youtube.com/watch?v=${ID}`, `https://m.youtube.com/embed/${ID}`]) assert.equal(parseSources(input)[0].type, 'video');
  for (const input of ['', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://youtube.com@evil.test/watch?v=abcdefghijk', 'https://youtube.com/watch?v=short', 'https://youtube.com/playlist?list=', `${PLAYLIST}\n`.repeat(6), 'ftp://youtube.com/watch?v=abcdefghijk']) assert.throws(() => parseSources(input));
  assert.equal(parseSources(` ${PLAYLIST}\r\n\nhttps://youtu.be/${ID} `).length, 2);
});

test('ISO durations and human output handle days, fractional seconds and invalid data', () => {
  assert.equal(parseDuration('P1DT2H3M4S'), 93784);
  assert.equal(parseDuration('PT0.5S'), 0.5);
  assert.equal(parseDuration('PT120M'), 7200);
  assert.equal(parseDuration('P'), null);
  assert.equal(parseDuration('not a duration'), null);
  assert.equal(duration(3600.1), '1h 1s');
  assert.equal(duration(0), '0s');
  assert.equal(duration(100 * 3600), '100h');
  assert.equal(duration(NaN), '—');
});

test('loads every page and counts duplicates while retaining unavailable positions', async () => {
  const calls = [];
  const fetcher = async input => {
    const url = new URL(input); calls.push(url);
    if (url.pathname.endsWith('/playlists')) return response([{ id: PLAYLIST, snippet: { title: 'A course' } }]);
    if (url.pathname.endsWith('/playlistItems')) {
      if (!url.searchParams.has('pageToken')) return response([entry(ID, 0), entry('missing0000', 1)], { nextPageToken: 'page2' });
      assert.equal(url.searchParams.get('pageToken'), 'page2');
      return response([entry(ID, 2), entry('livevideo00', 3), entry('upcoming000', 4)]);
    }
    assert.equal(url.searchParams.get('id'), `${ID},missing0000,livevideo00,upcoming000`);
    return response([video(ID), video('livevideo00', 'PT2H', 'live'), video('upcoming000', 'PT2H', 'upcoming')]);
  };
  const results = await loadSources(source, 'test-key', { fetcher });
  assert.equal(results[0].title, 'A course');
  assert.deepEqual(results[0].entries.map(item => item.position), [1, 2, 3, 4, 5]);
  assert.equal(results[0].entries[1].unavailable, true);
  assert.deepEqual(summarize(selectEntries(results), 2), { total: 1200, adjusted: 600, count: 2, excluded: 3, average: 600, longest: 600, shortest: 600 });
  assert.equal(calls.length, 4);
});

test('duration API batches unique video IDs into groups of 50 and empty playlists work', async () => {
  const ids = Array.from({ length: 103 }, (_, i) => `video${String(i).padStart(6, '0')}`);
  const batches = [];
  const fetcher = async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('/playlists')) return response([{ id: PLAYLIST, snippet: {} }]);
    if (url.pathname.endsWith('/playlistItems')) {
      const offset = Number(url.searchParams.get('pageToken') || 0);
      return response(ids.slice(offset, offset + 50).map((id, index) => entry(id, offset + index)), offset + 50 < ids.length ? { nextPageToken: String(offset + 50) } : {});
    }
    const batch = url.searchParams.get('id').split(','); batches.push(batch.length);
    return response(batch.map(id => video(id, 'PT1M')));
  };
  const results = await loadSources(source, 'key', { fetcher });
  assert.deepEqual(batches, [50, 50, 3]);
  assert.equal(summarize(selectEntries(results)).total, 6180);
  const empty = await loadSources(source, 'key', { fetcher: async input => new URL(input).pathname.endsWith('/playlists') ? response([{ id: PLAYLIST, snippet: {} }]) : response([]) });
  assert.equal(summarize(selectEntries(empty)).count, 0);
});

test('single videos, duplicate sources, and unsafe thumbnails', async () => {
  const parsed = parseSources(`${ID}\n${ID}`);
  let calls = 0;
  const results = await loadSources(parsed, 'key', { fetcher: async () => { calls++; const item = video(ID); item.snippet.thumbnails.medium.url = 'https://tracking.example/image'; return response([item]); } });
  assert.equal(calls, 1);
  assert.equal(results.length, 2);
  assert.equal(results[0].entries[0].thumbnail, '');
  assert.equal(summarize(selectEntries(results)).total, 1200);
});

test('API errors, network failure, missing keys and cancellation never return partial totals', async () => {
  const reject = reason => async () => ({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason }] } }) });
  await assert.rejects(loadSources(source, 'key', { fetcher: reject('quotaExceeded') }), /quota/);
  await assert.rejects(loadSources(source, 'key', { fetcher: reject('playlistNotFound') }), /private/);
  await assert.rejects(loadSources(source, 'key', { fetcher: reject('accessNotConfigured') }), /enabled/);
  await assert.rejects(loadSources(source, '', { fetcher: () => assert.fail('must not fetch') }), /configured/);
  await assert.rejects(loadSources(source, 'key', { fetcher: async () => { throw new TypeError('network'); } }), /connection/);
  await assert.rejects(loadSources(source, 'key', { fetcher: async () => response([]) }), /private/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadSources(source, 'key', { signal: controller.signal, fetcher: () => assert.fail('must not fetch') }), { name: 'AbortError' });
  await assert.rejects(loadSources(source, 'key', { fetcher: async input => new URL(input).pathname.endsWith('/playlists') ? response([{ id: PLAYLIST, snippet: {} }]) : response([], { nextPageToken: 'same' }) }), /changed/);
});

const results = [{ id: 'a', title: 'A', entries: [1, 2, 3, 4].map(position => ({ position, seconds: position * 60, unavailable: false })) }, { id: 'b', title: 'B', entries: [{ position: 1, seconds: 10, unavailable: false }, { position: 2, seconds: 0, unavailable: true }] }];
test('ranges and remaining apply independently to every source with original positions', () => {
  assert.deepEqual(selectEntries(results, { mode: 'range', start: 2, end: 3 }).map(item => [item.sourceId, item.position]), [['a', 2], ['a', 3], ['b', 2]]);
  assert.deepEqual(selectEntries(results, { mode: 'remaining', watched: 2 }).map(item => item.position), [3, 4]);
  assert.deepEqual(selectEntries(results, { mode: 'remaining', watched: 2, includeCurrent: true }).map(item => item.position), [2, 3, 4, 2]);
  assert.equal(selectEntries(results, { mode: 'remaining', watched: 0, includeCurrent: true }).length, 6);
  assert.equal(selectEntries(results, { mode: 'remaining', watched: 99 }).length, 0);
  assert.throws(() => selectEntries(results, { mode: 'range', start: 3, end: 1 }), /Range end/);
  assert.throws(() => selectEntries(results, { mode: 'remaining', watched: -1 }));
  assert.throws(() => selectEntries(results, { mode: 'range', start: 1.5 }));
  assert.throws(() => summarize([], 0));
  assert.deepEqual(summarize([]), { total: 0, adjusted: 0, count: 0, excluded: 0, average: 0, longest: 0, shortest: 0 });
});

function dateKey(date) { return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`; }
test('watch schedule respects weekdays, today, zero time and calendar boundaries', () => {
  const friday = new Date(2026, 9, 30, 23, 55);
  const options = { minutesPerDay: 60, days: [1, 2, 3, 4, 5], today: friday };
  assert.equal(dateKey(planSchedule(7200, options).finishDate), '2026-11-2');
  assert.equal(dateKey(planSchedule(3600, { ...options, includeToday: false }).finishDate), '2026-11-2');
  assert.equal(dateKey(planSchedule(6 * 3600, options).finishDate), '2026-11-6');
  assert.equal(dateKey(planSchedule(8 * 3600, { ...options, days: [5] }).finishDate), '2026-12-18');
  assert.equal(planSchedule(3600.1, options).sessions, 2);
  assert.deepEqual(planSchedule(0, options), { sessions: 0, finishDate: null });
  assert.throws(() => planSchedule(3600, { ...options, days: [] }), /watching day/);
  assert.throws(() => planSchedule(3600, { ...options, minutesPerDay: 0 }), /daily watch time/);
  assert.throws(() => planSchedule(3600, { ...options, days: [7] }));
});
