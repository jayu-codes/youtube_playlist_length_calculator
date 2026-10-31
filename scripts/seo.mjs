import { readFile, writeFile, rm } from 'node:fs/promises';
import { loadEnv } from 'vite';

const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
const configured = env.VITE_SITE_URL?.trim() || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
let origin = '';
if (configured) {
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('VITE_SITE_URL must be your HTTPS production origin, without a path, query, or credentials.');
  }
  origin = url.origin;
}
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let html = await readFile('dist/index.html', 'utf8');
const tags = origin ? [
  `<link rel="canonical" href="${escape(origin)}/">`,
  `<meta property="og:url" content="${escape(origin)}/">`,
  `<meta property="og:image" content="${escape(origin)}/og-image.png">`,
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta property="og:image:alt" content="Playlist Clock — YouTube playlist length calculator">',
  `<meta name="twitter:image" content="${escape(origin)}/og-image.png">`,
  '<meta name="twitter:image:alt" content="Playlist Clock — YouTube playlist length calculator">',
].join('\n') : '';
if (html.includes('<!-- SEO_URL_TAGS -->')) html = html.replace('<!-- SEO_URL_TAGS -->', tags);
else html = html.replace('</head>', `${tags}\n</head>`);
const preview = env.VERCEL_ENV === 'preview';
if (preview) {
  html = html.replace(/<meta\s+name=["']robots["'][^>]*>/gi, '');
  html = html.replace('</head>', '<meta name="robots" content="noindex, nofollow">\n</head>');
}
await writeFile('dist/index.html', html);
await writeFile('dist/robots.txt', `User-agent: *\n${preview ? 'Disallow: /' : 'Allow: /'}\n${origin && !preview ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`);
if (origin && !preview) {
  await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(origin)}/</loc></url></urlset>\n`);
} else {
  await rm('dist/sitemap.xml', { force: true });
}
console.log(origin ? 'SEO production URLs generated.' : 'SEO: Set VITE_SITE_URL before production deployment to generate canonical URLs and a sitemap.');
