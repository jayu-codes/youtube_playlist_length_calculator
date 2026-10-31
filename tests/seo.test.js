import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/seo.mjs', import.meta.url));
const template = '<html><head><meta name="robots" content="index,follow"><!-- SEO_URL_TAGS --></head><body>Calculator</body></html>';
async function fixture(t, settings = {}, { dotenv, placeholder = true } = {}) {
  const base = process.env.TEST_TMP_DIR || tmpdir();
  await mkdir(base, { recursive: true });
  const cwd = await mkdtemp(join(base, 'playlist-clock-seo-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, 'dist'));
  await writeFile(join(cwd, 'dist/index.html'), placeholder ? template : template.replace('<!-- SEO_URL_TAGS -->', ''));
  if (dotenv) await writeFile(join(cwd, '.env.local'), dotenv);
  const env = { ...process.env };
  for (const key of ['VITE_SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_ENV']) delete env[key];
  Object.assign(env, settings);
  return { cwd, run: () => execute(process.execPath, [script], { cwd, env }), read: file => readFile(join(cwd, 'dist', file), 'utf8') };
}

test('SEO production build emits correct canonical, social image, and sitemap', async t => {
  const f = await fixture(t, { VITE_SITE_URL: 'https://playlist.example/' });
  await f.run();
  const html = await f.read('index.html');
  assert.match(html, /rel="canonical" href="https:\/\/playlist\.example\/"/);
  assert.match(html, /property="og:image" content="https:\/\/playlist\.example\/og-image\.png"/);
  assert.match(html, /name="twitter:image"/);
  assert.doesNotMatch(html, /SEO_URL_TAGS|noindex/);
  assert.match(await f.read('sitemap.xml'), /<loc>https:\/\/playlist\.example\/<\/loc>/);
  assert.match(await f.read('robots.txt'), /Allow: \/\nSitemap: https:\/\/playlist\.example\/sitemap.xml/);
});

test('SEO resolves production origin from Vercel and handles stripped placeholder', async t => {
  const f = await fixture(t, { VERCEL_PROJECT_PRODUCTION_URL: 'playlist.vercel.app' }, { placeholder: false });
  await f.run();
  assert.match(await f.read('index.html'), /rel="canonical" href="https:\/\/playlist.vercel.app\/"/);
});

test('SEO preview build prevents indexing and removes stale sitemap', async t => {
  const f = await fixture(t, { VITE_SITE_URL: 'https://playlist.example', VERCEL_ENV: 'preview' });
  await writeFile(join(f.cwd, 'dist/sitemap.xml'), 'stale sitemap');
  await f.run();
  const html = await f.read('index.html');
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(html, /content="index,follow"/);
  assert.equal(await f.read('robots.txt'), 'User-agent: *\nDisallow: /\n');
  await assert.rejects(access(join(f.cwd, 'dist/sitemap.xml')));
});

test('SEO does not invent a canonical origin when none is configured', async t => {
  const f = await fixture(t);
  await f.run();
  assert.doesNotMatch(await f.read('index.html'), /canonical|og:image|SEO_URL_TAGS/);
  assert.equal(await f.read('robots.txt'), 'User-agent: *\nAllow: /\n');
  await assert.rejects(access(join(f.cwd, 'dist/sitemap.xml')));
});

test('SEO reads local build configuration and rejects insecure production origins', async t => {
  const local = await fixture(t, {}, { dotenv: 'VITE_SITE_URL=https://local-build.example\n' });
  await local.run();
  assert.match(await local.read('index.html'), /https:\/\/local-build.example\//);
  const invalid = await fixture(t, { VITE_SITE_URL: 'http://playlist.example/path' });
  await assert.rejects(invalid.run(), /HTTPS production origin/);
});
