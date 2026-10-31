/** Pure calculations and the public YouTube Data API client. No keys are persisted. */
const API_ROOT = 'https://www.googleapis.com/youtube/v3/';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,200}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);

export function parseSources(text) {
  if (typeof text !== 'string') throw new Error('Paste a YouTube playlist or video link.');
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Paste at least one YouTube playlist or video link.');
  if (lines.length > 5) throw new Error('Please enter up to 5 links, one per line.');
  return lines.map((line, index) => {
    const fail = () => { throw new Error(`Link ${index + 1}: enter a valid YouTube playlist link, playlist ID, or video link.`); };
    let type, id;
    if (/^[A-Za-z0-9_-]+$/.test(line)) {
      // Eleven-character IDs are YouTube videos; playlist IDs are longer in practice.
      type = VIDEO_ID.test(line) ? 'video' : 'playlist';
      id = line;
    } else {
      let url;
      try { url = new URL(/^https?:\/\//i.test(line) ? line : `https://${line}`); } catch { fail(); }
      if (!HOSTS.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) fail();
      if (url.searchParams.has('list')) {
        type = 'playlist';
        id = url.searchParams.get('list');
      } else {
        type = 'video';
        const path = url.pathname.split('/').filter(Boolean);
        if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') id = path.length === 1 ? path[0] : null;
        else if (url.pathname === '/watch') id = url.searchParams.get('v');
        else if (['shorts', 'embed', 'live'].includes(path[0]) && path.length === 2) id = path[1];
      }
    }
    if (!(type === 'video' ? VIDEO_ID : PLAYLIST_ID).test(id || '')) fail();
    return { type, id, url: type === 'playlist' ? `https://www.youtube.com/playlist?list=${id}` : `https://www.youtube.com/watch?v=${id}` };
  });
}

export function parseDuration(value) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value || '');
  if (!match || !match.slice(1).some(part => part !== undefined)) return null;
  const seconds = (Number(match[1]) || 0) * 86400 + (Number(match[2]) || 0) * 3600 + (Number(match[3]) || 0) * 60 + (Number(match[4]) || 0);
  return Number.isFinite(seconds) ? seconds : null;
}

function apiError(status, payload) {
  const reasons = (payload?.error?.errors || []).map(error => error.reason);
  if (reasons.some(reason => ['quotaExceeded', 'dailyLimitExceeded', 'dailyLimitExceededUnreg'].includes(reason))) {
    return new Error('The YouTube API daily quota has been reached. Try again after it resets, or add your own API key in Advanced options.');
  }
  if (reasons.includes('rateLimitExceeded') || status === 429) return new Error('YouTube is receiving too many requests. Wait a moment and try again.');
  if (reasons.includes('playlistNotFound') || status === 404) return new Error('This playlist was not found or is private. Check the link and use a public or unlisted playlist.');
  if (reasons.some(reason => ['keyInvalid', 'accessNotConfigured', 'ipRefererBlocked'].includes(reason)) || status === 400 || status === 401) {
    return new Error('The YouTube API key could not be used. Check that YouTube Data API v3 is enabled and the key allows this website.');
  }
  if (status === 403) return new Error('YouTube denied this request. Check the API key, website restrictions, and playlist visibility. Private playlists are not supported.');
  return new Error('YouTube could not complete the request. Please try again shortly.');
}

/** fetcher is injectable for deterministic API tests; production defaults to fetch. */
export async function loadSources(sources, key, { signal, onProgress = () => {}, fetcher = globalThis.fetch } = {}) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 5) throw new Error('Choose between 1 and 5 playlists or videos.');
  if (typeof key !== 'string' || !key.trim()) throw new Error('The site API key has not been configured. Add a YouTube Data API key in Advanced options to continue.');
  for (const source of sources) {
    if (!['playlist', 'video'].includes(source.type) || !(source.type === 'video' ? VIDEO_ID : PLAYLIST_ID).test(source.id)) throw new Error('An invalid YouTube source was provided.');
  }
  async function request(resource, params) {
    if (signal?.aborted) throw new DOMException('Calculation cancelled.', 'AbortError');
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    try {
      const response = await fetcher(`${API_ROOT}${resource}?${new URLSearchParams({ ...params, key: key.trim() })}`, { signal: controller.signal });
      let data;
      try { data = await response.json(); } catch { throw new Error('YouTube returned an unreadable response. Please try again.'); }
      if (!response.ok) throw apiError(response.status, data);
      if (!data || !Array.isArray(data.items)) throw new Error('YouTube returned an incomplete response. Please try again.');
      return data;
    } catch (error) {
      if (timedOut) throw new Error('The YouTube request timed out. Check your connection and try again.');
      if (signal?.aborted) throw new DOMException('Calculation cancelled.', 'AbortError');
      if (error instanceof TypeError) throw new Error('Could not connect to YouTube. Check your internet connection and try again.');
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  const playlistIds = [...new Set(sources.filter(source => source.type === 'playlist').map(source => source.id))];
  const metadata = new Map();
  if (playlistIds.length) {
    const data = await request('playlists', { part: 'snippet', id: playlistIds.join(',') });
    for (const item of data.items) metadata.set(item.id, item.snippet?.title || 'YouTube playlist');
    if (playlistIds.some(id => !metadata.has(id))) throw new Error('One of these playlists was not found or is private. Use public or unlisted playlist links.');
  }
  const cache = new Map();
  let totalEntries = 0;
  for (const source of sources) {
    const cacheId = `${source.type}:${source.id}`;
    if (cache.has(cacheId)) continue;
    if (source.type === 'video') { cache.set(cacheId, [{ id: source.id, position: 1 }]); continue; }
    const entries = [];
    let pageToken;
    const seenTokens = new Set();
    do {
      const data = await request('playlistItems', { part: 'snippet,contentDetails', playlistId: source.id, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
      for (const item of data.items) {
        entries.push({
          id: item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '',
          position: Number.isInteger(item.snippet?.position) ? item.snippet.position + 1 : entries.length + 1,
          fallbackTitle: item.snippet?.title || 'Unavailable video',
        });
      }
      onProgress(`Reading playlists · ${totalEntries + entries.length} entries found`);
      pageToken = data.nextPageToken;
      if (pageToken && seenTokens.has(pageToken)) throw new Error('The playlist changed while loading. Please try again.');
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
    totalEntries += entries.length;
    cache.set(cacheId, entries);
  }
  const ids = [...new Set([...cache.values()].flat().map(entry => entry.id).filter(id => VIDEO_ID.test(id)))];
  const videos = new Map();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const data = await request('videos', { part: 'snippet,contentDetails', id: ids.slice(offset, offset + 50).join(',') });
    for (const item of data.items) {
      const seconds = parseDuration(item.contentDetails?.duration);
      const live = ['live', 'upcoming'].includes(item.snippet?.liveBroadcastContent);
      const thumbnail = item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '';
      // Only documented YouTube image hosts are surfaced to the UI.
      const safeThumbnail = /^https:\/\/(?:i\.ytimg\.com|i[1-4]\.ytimg\.com)\//.test(thumbnail) ? thumbnail : '';
      videos.set(item.id, { title: item.snippet?.title || 'YouTube video', channel: item.snippet?.channelTitle || '', seconds: seconds > 0 && !live ? seconds : 0, thumbnail: safeThumbnail, unavailable: !(seconds > 0) || live });
    }
    onProgress(`Checking durations · ${Math.min(offset + 50, ids.length)} of ${ids.length} videos`);
  }
  return sources.map(source => {
    const entries = cache.get(`${source.type}:${source.id}`).map(entry => ({
      id: entry.id,
      title: entry.fallbackTitle || 'Unavailable video',
      channel: '', seconds: 0, thumbnail: '', unavailable: true,
      ...videos.get(entry.id),
      position: entry.position,
      url: VIDEO_ID.test(entry.id) ? `https://www.youtube.com/watch?v=${entry.id}${source.type === 'playlist' ? `&list=${source.id}&index=${entry.position}` : ''}` : '',
    }));
    return { id: source.id, title: source.type === 'playlist' ? metadata.get(source.id) : entries[0]?.title || 'YouTube video', url: source.type === 'playlist' ? `https://www.youtube.com/playlist?list=${source.id}` : `https://www.youtube.com/watch?v=${source.id}`, entries };
  });
}

function integer(value, name, minimum) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < minimum || value === '' || value === null) throw new Error(`${name} must be a whole number of ${minimum} or more.`);
  return Number(value);
}

/** Ranges and watched positions apply separately to each submitted source. */
export function selectEntries(results, { mode = 'full', start = 1, end = null, watched = 0, includeCurrent = false } = {}) {
  if (!['full', 'range', 'remaining'].includes(mode)) throw new Error('Choose a valid calculation mode.');
  let from = 1, to = Infinity;
  if (mode === 'range') {
    from = integer(start, 'Range start', 1);
    to = end === null || end === '' || end === undefined ? Infinity : integer(end, 'Range end', 1);
    if (to < from) throw new Error('Range end must be greater than or equal to range start.');
  } else if (mode === 'remaining') {
    const count = integer(watched, 'Videos watched', 0);
    from = Math.max(1, count + (includeCurrent ? 0 : 1));
  }
  return results.flatMap(result => result.entries.filter(entry => entry.position >= from && entry.position <= to).map(entry => ({ ...entry, sourceId: result.id, sourceTitle: result.title })));
}

export function summarize(entries, speed = 1) {
  if (!Number.isFinite(Number(speed)) || Number(speed) <= 0 || Number(speed) > 16) throw new Error('Playback speed must be greater than 0 and at most 16×.');
  const available = entries.filter(entry => !entry.unavailable && Number.isFinite(entry.seconds) && entry.seconds > 0);
  const times = available.map(entry => entry.seconds);
  const total = times.reduce((sum, time) => sum + time, 0);
  return { total, adjusted: total / Number(speed), count: times.length, excluded: entries.length - times.length, average: times.length ? total / times.length : 0, longest: times.reduce((max, time) => Math.max(max, time), 0), shortest: times.length ? times.reduce((min, time) => Math.min(min, time), Infinity) : 0 };
}

export function duration(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  const seconds = Math.ceil(value), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), remainder = seconds % 60;
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', remainder || !seconds ? `${remainder}s` : ''].filter(Boolean).join(' ');
}

/** Dates are calculated in the viewer's local timezone, using calendar-day increments. */
export function planSchedule(seconds, { minutesPerDay = 60, days = [0, 1, 2, 3, 4, 5, 6], includeToday = true, today = new Date() } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Remaining watch time must be a valid duration.');
  const minutes = Number(minutesPerDay);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw new Error('Set a daily watch time greater than 0 and no more than 1,440 minutes.');
  if (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Choose at least one watching day.');
  if (!(today instanceof Date) || !Number.isFinite(today.getTime())) throw new Error('The schedule start date is invalid.');
  const sessions = Math.ceil(seconds / (minutes * 60));
  if (!sessions) return { sessions: 0, finishDate: null };
  if (!Number.isSafeInteger(sessions)) throw new Error('This schedule is too long. Increase your daily watch time.');
  const weekdays = new Set(days);
  const date = new Date(today);
  date.setHours(12, 0, 0, 0);
  if (!includeToday) date.setDate(date.getDate() + 1);
  while (!weekdays.has(date.getDay())) date.setDate(date.getDate() + 1);
  let remaining = sessions - 1;
  // Skip complete weeks, then advance at most six additional calendar days.
  const weeks = Math.floor(remaining / weekdays.size);
  date.setDate(date.getDate() + weeks * 7);
  if (!Number.isFinite(date.getTime())) throw new Error('This schedule is too long. Increase your daily watch time.');
  remaining %= weekdays.size;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (weekdays.has(date.getDay())) remaining--;
  }
  if (!Number.isFinite(date.getTime())) throw new Error('This schedule is too long. Increase your daily watch time.');
  return { sessions, finishDate: date };
}
