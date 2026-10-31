import {parseSources, loadSources, selectEntries, summarize, duration, planSchedule} from './core.js';
import {exportExcel} from './export.js';

const $ = id => document.getElementById(id);
let sources = [], entries = [], summary, isDemo = false, controller, shownVideos = 50, toastTimer;
const sharedKey = (import.meta.env.VITE_YOUTUBE_API_KEY || '').trim();
const themeToggle = $('theme-toggle');
function updateThemeLabel() {
  const light = document.documentElement.dataset.theme === 'light';
  themeToggle.setAttribute('aria-label', `Switch to ${light ? 'dark' : 'light'} mode`);
  themeToggle.setAttribute('title', `Switch to ${light ? 'dark' : 'light'} mode`);
  document.querySelector('meta[name="theme-color"]').content = light ? '#f6f7f2' : '#0d1110';
}
updateThemeLabel();
themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('playlist-clock-theme',theme); } catch { /* Storage is optional. */ }
  updateThemeLabel();
});
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; toastTimer = setTimeout(() => {$('toast').textContent = '';}, 4000); }
function mode() { return document.querySelector('input[name="mode"]:checked').value; }
function options() { return {mode: mode(), start: $('range-start').value, end: $('range-end').value || null, watched: $('watched').value, includeCurrent: $('include-current').checked}; }
function speed() {
  const value = Number($('speed').value);
  if (!Number.isFinite(value) || value < .25 || value > 16) throw new Error('Choose a playback speed between 0.25× and 16×.');
  return value;
}
function updateMode() {
  for (const [id, active] of [['range-options', mode() === 'range'], ['remaining-options', mode() === 'remaining']]) {
    $(id).hidden = !active;
    $(id).querySelectorAll('input').forEach(input => {input.disabled = !active;});
  }
  $('range-help').hidden = mode() === 'full';
}
updateMode();
function make(tag, className, text) { const node = document.createElement(tag); if(className) node.className = className; if(text !== undefined) node.textContent = text; return node; }
function setBusy(busy) {
  $('calculate').disabled = busy; $('demo').disabled = busy; $('cancel').hidden = !busy;
  $('output-panel').setAttribute('aria-busy',String(busy));
  $('calculate').firstElementChild.textContent = busy ? 'Reading your playlist…' : 'Calculate watch time';
}
function clearResults() { $('results').hidden = true; $('results-lower').hidden = true; $('empty-state').hidden = false; $('result-badge').textContent = 'Ready when you are'; }
function render() {
  if (!sources.length) return;
  try {
    const currentSpeed = speed();
    entries = selectEntries(sources, options());
    summary = summarize(entries, currentSpeed);
    $('results').hidden = false; $('results-lower').hidden = false; $('empty-state').hidden = true;
    $('result-badge').textContent = isDemo ? 'Example · sample data' : 'Calculation complete';
    $('result-title').textContent = mode() === 'remaining' ? 'Your remaining watch time' : 'Your watch time';
    $('result-subtitle').textContent = `${sources.length} ${sources.length === 1 ? 'source' : 'sources'} · ${mode() === 'full' ? 'Full selection' : mode() === 'range' ? 'Selected range' : 'Remaining selection'} · ${currentSpeed}× speed`;
    $('total-time').textContent = duration(summary.adjusted);
    $('original-duration').textContent = duration(summary.total);
    $('video-count').textContent = summary.count.toLocaleString();
    $('average-duration').textContent = duration(summary.average);
    $('savings').textContent = currentSpeed === 1 ? 'At the original pace. Make every minute count.' : currentSpeed > 1 ? `${duration(summary.total-summary.adjusted)} saved · ${Math.round((1-1/currentSpeed)*100)}% less watch time` : `${duration(summary.adjusted-summary.total)} more time to take it all in`;
    const comparison = $('speed-comparison'); comparison.replaceChildren();
    for (const rate of [1.25,1.5,1.75,2]) {
      const chip = make('div','comparison-chip'); chip.append(make('span','',`${rate}× speed`),make('strong','',duration(summary.total/rate))); comparison.append(chip);
    }
    const breakdown = $('source-breakdown'); breakdown.replaceChildren();
    for (const source of sources) {
      // Calculate each occurrence independently, even if the same URL was submitted twice.
      const subtotal = summarize(selectEntries([source],options()),currentSpeed);
      const row = make('div','source-row');
      const title = make('span','',source.title); title.title = source.title;
      row.append(title,make('strong','',duration(subtotal.adjusted))); breakdown.append(row);
    }
    $('result-note').textContent = `${entries.length ? `${summary.excluded} unavailable ${summary.excluded === 1 ? 'entry' : 'entries'} excluded. ` : 'No videos match this selection. '}${summary.count ? `Shortest ${duration(summary.shortest)} · Longest ${duration(summary.longest)}. ` : ''}Playback only; ads, breaks, and pauses are extra.`;
    $('progress').max = String(summary.count);
    if (Number($('progress').value) > summary.count) $('progress').value = String(summary.count);
    document.querySelectorAll('[data-speed]').forEach(button => button.setAttribute('aria-pressed',String(Number(button.dataset.speed) === currentSpeed)));
    $('list-count').textContent = `(${entries.length})`;
    renderVideos(); renderPlanner();
    status(isDemo ? 'Example loaded. These are sample videos, not live YouTube results.' : 'Calculation complete. Adjust the settings without making another request.');
  } catch(error) { clearResults(); status(error.message,true); }
}
function renderPlanner() {
  try {
    const available = entries.filter(entry => !entry.unavailable && entry.seconds > 0);
    const watched = Number($('progress').value);
    if (!Number.isInteger(watched) || watched < 0 || watched > available.length) throw new Error(`Enter a watched count from 0 to ${available.length}.`);
    const remaining = available.slice(watched).reduce((sum,entry) => sum+entry.seconds,0) / speed();
    const plan = planSchedule(remaining,{minutesPerDay: $('minutes').value, days: [...document.querySelectorAll('input[name="day"]:checked')].map(input => Number(input.value)), includeToday: $('include-today').checked});
    $('finish-date').textContent = !summary.count ? 'No watchable videos' : !plan.sessions ? 'All caught up.' : plan.finishDate.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    $('schedule-detail').textContent = `${duration(remaining)} remaining · ${plan.sessions} watching ${plan.sessions === 1 ? 'day' : 'days'} at ${speed()}×`;
    $('progress-bar').style.width = `${available.length ? watched/available.length*100 : 0}%`;
    $('progress-detail').textContent = `${watched} of ${available.length} selected videos watched · Uses your local date`;
    $('planner-status').textContent = '';
  } catch(error) { $('finish-date').textContent = 'Adjust your plan'; $('schedule-detail').textContent = ''; $('progress-detail').textContent = ''; $('progress-bar').style.width = '0%'; $('planner-status').textContent = error.message; }
}
function renderVideos() {
  const list = $('video-list'); list.replaceChildren();
  for (const entry of entries.slice(0,shownVideos)) {
    const row = make('div','video-row'); row.append(make('span','',String(entry.position)));
    if (entry.thumbnail) { const image = make('img','video-thumb'); image.src = entry.thumbnail; image.alt = ''; image.loading = 'lazy'; image.width = 76; image.height = 43; row.append(image); }
    else row.append(make('div','video-thumb'));
    const info = make('div','video-info');
    const link = make(entry.url ? 'a' : 'span','',entry.title);
    if(entry.url) {link.href=entry.url;link.target='_blank';link.rel='noopener noreferrer';}
    info.append(link,make('small','',`${entry.channel || 'Channel unavailable'}${sources.length > 1 ? ` · ${entry.sourceTitle}` : ''}`));
    row.append(info,make('strong','',entry.unavailable ? 'Unavailable' : duration(entry.seconds))); list.append(row);
  }
  $('more-videos').hidden = shownVideos >= entries.length;
  $('more-videos').textContent = `Show next ${Math.min(50,entries.length-shownVideos)} videos`;
}
$('more-videos').addEventListener('click',()=>{shownVideos+=50;renderVideos();});
$('calculator-form').addEventListener('submit',async event => {
  event.preventDefault();
  try {
    const parsed = parseSources($('sources').value);
    speed(); selectEntries([],options());
    const key = $('api-key').value.trim() || sharedKey;
    if (!key) {
      $('advanced').open=true; $('api-key').focus();
      throw new Error('A YouTube API key is needed for live results. Add your key above, or try the example. The site owner can set a shared key in Vercel.');
    }
    controller?.abort(); controller = new AbortController();
    setBusy(true); sources=[]; clearResults(); status('Connecting to YouTube…');
    sources = await loadSources(parsed,key,{signal:controller.signal,onProgress:message=>status(message)});
    isDemo=false; shownVideos=50; $('progress').value='0'; render();
  } catch(error) { sources=[]; clearResults(); status(error.name === 'AbortError' ? 'Calculation cancelled. You can try again.' : error.message,true); }
  finally {setBusy(false);}
});
$('cancel').addEventListener('click',()=>controller?.abort());
$('demo').addEventListener('click',()=>{
  const names=['Getting started with a new idea','The foundations, explained','From curiosity to a first draft','Building your first project','A closer look at the details','Making the pieces work together','A practical walkthrough','Common mistakes and small fixes','Refining your process','Putting it into practice','Your next creative challenge','Bringing it all together'];
  sources=[{id:'example',title:'A little learning, every day',url:'',entries:names.map((title,i)=>({id:`sample-${i}`,title,channel:'Sample learning series',seconds:[630,924,1080,1512,765,1290,1860,840,1140,1440,1050,1269][i],thumbnail:'',url:'',position:i+1,unavailable:false}))}];
  document.querySelector('input[name="mode"][value="full"]').checked=true; updateMode();
  $('progress').value='0'; shownVideos=50;isDemo=true;render();
});
$('speed').addEventListener('input',()=>{document.querySelectorAll('[data-speed]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.speed)===Number($('speed').value))));render();});
document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click',()=>{$('speed').value=button.dataset.speed;$('speed').dispatchEvent(new Event('input'));}));
document.querySelectorAll('input[name="mode"]').forEach(input=>input.addEventListener('change',()=>{updateMode();$('progress').value='0';render();}));
for (const id of ['range-start','range-end','watched','include-current']) $(id).addEventListener('input',()=>{$('progress').value='0';render();});
$('planner-form').addEventListener('submit',event=>event.preventDefault());
$('planner-form').addEventListener('input',renderPlanner);
$('export').addEventListener('click',async()=>{
  $('export').disabled=true; $('export').textContent='Preparing Excel…';
  try {await exportExcel(entries,{title:isDemo ? 'Playlist Clock Sample' : sources.length===1 ? sources[0].title : 'Playlist Clock Collection',speed:speed()});toast('Your Excel file is ready.');}
  catch {toast('Could not export. Please try again.');}
  finally {$('export').disabled=false;$('export').textContent='↓ Export Excel';}
});
$('copy-summary').addEventListener('click',async()=>{
  const text=`${isDemo ? 'Sample calculation — ' : ''}Playlist Clock\n${summary.count} videos · ${duration(summary.total)} original duration\n${duration(summary.adjusted)} at ${speed()}× speed\n${summary.excluded} entries excluded`;
  try {await navigator.clipboard.writeText(text);toast('Summary copied.');} catch {toast('Clipboard access is unavailable in this browser.');}
});
