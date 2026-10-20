#!/usr/bin/env node
// FaLe PDF – task pages of pdf.fale.network ("PDF unterschreiben", "Merge PDF", "PDF को मर्ज करें" …) for search engines,
// in every language that has a strings file, plus the sitemap of pdf.fale.network.
//
//   site/tasks/<code>.json   strings of one language: ui labels + one entry per task (slug, title, steps, why, faq …)
//   → site/<code>/<slug>/index.html   (German too: /de/<slug>/ – the German start page stays at /)
//   → sitemap.xml                     start pages + task pages with hreflang alternates + legal pages
//
//   node scripts/build-tasks.mjs            write the pages
//   node scripts/build-tasks.mjs --check    only compare with the files on disk (used by vercel-build.mjs)
//
// Never edit the generated pages by hand. Texts must only promise what the app really does (see site/tasks/de.json),
// and – like everywhere on the site – no other companies' product names.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const ORIGIN = 'https://pdf.fale.network';
const landing = await import(pathToFileURL(join(ROOT, 'scripts', 'build-landing.mjs')).href);

// task id → app route and screenshot of the landing images (de/en only)
export const TASKS = {
  sign: { route: '#/werkzeug/unterschreiben', img: '02_sign' },
  fill: { route: '#/werkzeug/unterschreiben', img: '02_sign' },
  edit: { route: '#/werkzeug/bearbeiten', img: '01_home' },
  merge: { route: '#/werkzeug/zusammenfuegen', img: '01_home' },
  compress: { route: '#/werkzeug/komprimieren', img: '01_home' },
  scan: { route: '#/werkzeug/scannen', img: '03_scan' },
  word: { route: '#/werkzeug/pdf-word', img: '06_sheet' },
  xfa: { route: '#/werkzeug/behoerdenformular', img: '02_sign' },
};
const BANNED = /\b(adobe|acrobat|wps|ilovepdf|smallpdf|pdf24|sejda|foxit|nitro|docusign|microsoft word)\b/i;

export const LANGS = landing.LANGS.filter(([c]) => existsSync(join(SITE, 'tasks', c + '.json')));
const load = c => JSON.parse(readFileSync(join(SITE, 'tasks', c + '.json'), 'utf8'));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escA = s => esc(s).replace(/"/g, '&quot;');
const ld = v => JSON.stringify(v).replace(/</g, '\\u003c');
const homePath = c => (c === 'de' ? '/' : `/${c}/`);
const taskPath = (c, slug) => `/${c}/${slug}/`;

function validate(code, d) {
  const where = `site/tasks/${code}.json`;
  for (const k of ['skip', 'navLabel', 'home', 'openApp', 'badge', 'stepsH', 'whyH', 'faqH', 'moreH', 'popularH', 'endH', 'endText', 'privacy', 'imprint', 'footer'])
    if (!d.ui || typeof d.ui[k] !== 'string' || !d.ui[k].trim()) throw new Error(`${where}: ui.${k} fehlt`);
  const slugs = new Set();
  for (const id of Object.keys(TASKS)) {
    const t = d.tasks && d.tasks[id];
    if (!t) throw new Error(`${where}: Aufgabe „${id}“ fehlt`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.slug || '')) throw new Error(`${where}: ${id}.slug ungültig (nur a-z, 0-9, Bindestrich)`);
    if (slugs.has(t.slug)) throw new Error(`${where}: ${id}.slug doppelt`);
    slugs.add(t.slug);
    for (const k of ['title', 'description', 'h1', 'lede', 'cta']) if (typeof t[k] !== 'string' || !t[k].trim()) throw new Error(`${where}: ${id}.${k} fehlt`);
    if (t.title.length > 70) throw new Error(`${where}: ${id}.title zu lang (${t.title.length} > 70)`);
    if (t.description.length > 170) throw new Error(`${where}: ${id}.description zu lang (${t.description.length} > 170)`);
    if (!Array.isArray(t.steps) || t.steps.length !== 3) throw new Error(`${where}: ${id}.steps braucht genau 3 Schritte`);
    if (!Array.isArray(t.why) || t.why.length !== 3) throw new Error(`${where}: ${id}.why braucht genau 3 Punkte`);
    if (!Array.isArray(t.faq) || t.faq.length < 3) throw new Error(`${where}: ${id}.faq braucht mindestens 3 Fragen`);
    if (BANNED.test(JSON.stringify(t))) throw new Error(`${where}: ${id} nennt einen fremden Produktnamen`);
  }
}

function page(code, htmlLang, d, id, all) {
  const t = d.tasks[id], ui = d.ui, T = TASKS[id];
  const url = ORIGIN + taskPath(code, t.slug);
  const alternates = all.map(([c, hl, dd]) => `  <link rel="alternate" hreflang="${hl}" href="${ORIGIN}${taskPath(c, dd.tasks[id].slug)}">`).join('\n')
    + `\n  <link rel="alternate" hreflang="x-default" href="${ORIGIN}${taskPath('en', all.find(x => x[0] === 'en')[2].tasks[id].slug)}">`;
  const img = `/site/img/${code === 'de' ? 'de' : 'en'}-${T.img}.webp`;
  const app = `/app/${T.route}`;
  const howto = { '@context': 'https://schema.org', '@type': 'HowTo', name: t.h1, description: t.description, inLanguage: htmlLang,
    step: t.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.t, text: s.d })), tool: { '@type': 'HowToTool', name: 'FaLe PDF' } };
  const faq = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: t.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'FaLe PDF', item: ORIGIN + homePath(code) }, { '@type': 'ListItem', position: 2, name: t.h1, item: url }] };
  const more = Object.keys(TASKS).filter(x => x !== id).map(x => `<li><a href="${taskPath(code, d.tasks[x].slug)}">${esc(d.tasks[x].h1)}</a></li>`).join('');
  const legal = code === 'de' ? { imprint: '/impressum.html', privacy: '/datenschutz.html' } : { imprint: '/impressum.html?lang=en', privacy: '/datenschutz.html?lang=en' };
  return `<!doctype html>
<html lang="${escA(htmlLang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(t.title)}</title>
  <meta name="description" content="${escA(t.description)}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#EEF0F8" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#10112A" media="(prefers-color-scheme: dark)">
  <link rel="canonical" href="${url}">
${alternates}
  <link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="FaLe PDF">
  <meta property="og:title" content="${escA(t.title)}">
  <meta property="og:description" content="${escA(t.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ORIGIN}${code === 'de' ? '/og-image.png' : '/og-image-en.png'}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preload" href="/vendor/fonts/bricolage-grotesque/BricolageGrotesque-Bold.woff" as="font" type="font/woff" crossorigin>
  <link rel="stylesheet" href="/site/landing.css">
  <script src="/site/landing.js"></script>
  <script type="application/ld+json">${ld(howto)}</script>
  <script type="application/ld+json">${ld(faq)}</script>
  <script type="application/ld+json">${ld(crumbs)}</script>
</head>
<body class="task">
<a class="skip" href="#main">${esc(ui.skip)}</a>
<header class="wrap top">
  <a class="brand" href="${homePath(code)}"><img src="/icons/favicon.svg" alt="" width="36" height="36">FaLe PDF</a>
  <nav aria-label="${escA(ui.navLabel)}">
    <a class="hide-s" href="${homePath(code)}">${esc(ui.home)}</a>
    <a class="btn btn-main" href="/app/">${esc(ui.openApp)}</a>
  </nav>
</header>
<main id="main">
  <section class="wrap hero">
    <div>
      <p class="badge">${esc(ui.badge)}</p>
      <h1>${esc(t.h1)}</h1>
      <p class="lede">${esc(t.lede)}</p>
      <div class="cta"><a class="btn btn-main" href="${app}">${esc(t.cta)}</a></div>
    </div>
    <div class="fan" aria-hidden="true">
      <div class="sheet s1"></div><div class="sheet s2"></div>
      <div class="sheet s3"><img src="${img}" alt="" width="540" height="960"></div>
    </div>
  </section>
  <section class="sec" aria-labelledby="steps-h">
    <div class="wrap desk task-steps">
      <div>
        <h2 id="steps-h">${esc(ui.stepsH)}</h2>
        <ol class="desk-steps">${t.steps.map(s => `<li><b>${esc(s.t)}</b> ${esc(s.d)}</li>`).join('')}</ol>
        <div class="cta"><a class="btn btn-main" href="${app}">${esc(t.cta)}</a></div>
      </div>
    </div>
  </section>
  <section class="sec" aria-labelledby="why-h">
    <div class="wrap">
      <h2 id="why-h">${esc(ui.whyH)}</h2>
      <ul class="jobs">${t.why.map(w => `<li><b>${esc(w.t)}</b><span>${esc(w.d)}</span></li>`).join('')}</ul>
    </div>
  </section>
  <section class="sec" id="fragen">
    <div class="wrap faq">
      <h2>${esc(ui.faqH)}</h2>
      ${t.faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
    </div>
  </section>
  <section class="sec" aria-labelledby="more-h">
    <div class="wrap">
      <h2 id="more-h">${esc(ui.moreH)}</h2>
      <ul class="task-more">${more}</ul>
    </div>
  </section>
  <section class="wrap end">
    <h2>${esc(ui.endH)}</h2>
    <p class="intro center">${esc(ui.endText)}</p>
    <div class="cta"><a class="btn btn-main" href="${app}">${esc(t.cta)}</a></div>
  </section>
</main>
<footer><div class="wrap"><span>© 2026 FaLe.dev · ${esc(ui.footer)}</span>
  <nav><a href="${legal.imprint}">${esc(ui.imprint)}</a><a href="${legal.privacy}">${esc(ui.privacy)}</a></nav>
</div></footer>
</body>
</html>
`;
}

function sitemap(all) {
  const day = '2026-10-20';
  const urls = [];
  const alt = list => list.map(([hl, href]) => `\n    <xhtml:link rel="alternate" hreflang="${hl}" href="${href}"/>`).join('');
  // start pages (every published language)
  const homes = landing.LANGS.map(([c, hl]) => [hl, ORIGIN + homePath(c)]);
  for (const [, href] of homes) urls.push(`  <url>\n    <loc>${href}</loc>${alt([...homes, ['x-default', ORIGIN + '/']])}\n    <lastmod>${day}</lastmod>\n    <priority>1.0</priority>\n  </url>`);
  for (const id of Object.keys(TASKS)) {
    const list = all.map(([c, hl, d]) => [hl, ORIGIN + taskPath(c, d.tasks[id].slug)]);
    const en = all.find(x => x[0] === 'en');
    for (const [, href] of list) urls.push(`  <url>\n    <loc>${href}</loc>${alt([...list, ['x-default', ORIGIN + taskPath('en', en[2].tasks[id].slug)]])}\n    <lastmod>${day}</lastmod>\n    <priority>0.8</priority>\n  </url>`);
  }
  urls.push(`  <url>\n    <loc>${ORIGIN}/datenschutz.html</loc>\n    <lastmod>2026-10-14</lastmod>\n    <priority>0.3</priority>\n  </url>`);
  urls.push(`  <url>\n    <loc>${ORIGIN}/impressum.html</loc>\n    <lastmod>2026-10-14</lastmod>\n    <priority>0.2</priority>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

export function build() {
  const all = LANGS.map(([c, hl]) => { const d = load(c); validate(c, d); return [c, hl, d]; });
  if (!all.some(x => x[0] === 'en')) throw new Error('site/tasks/en.json fehlt (x-default)');
  const out = new Map();
  for (const [c, hl, d] of all) for (const id of Object.keys(TASKS)) out.set(join('site', c, d.tasks[id].slug, 'index.html'), page(c, hl, d, id, all));
  out.set('sitemap.xml', sitemap(all));
  return out;
}

/** Folders with task pages per language (for vercel-build). */
export function taskFolders() {
  return LANGS.map(([c]) => [c, Object.keys(TASKS).map(id => load(c).tasks[id].slug)]);
}

export function stalePages() {
  const stale = [];
  for (const [rel, html] of build()) {
    const p = join(ROOT, rel);
    if (!existsSync(p) || readFileSync(p, 'utf8') !== html) stale.push(rel);
  }
  return stale;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const s = stalePages();
    if (s.length) { console.error('veraltet:', s.join(', ')); process.exit(1); }
    console.log('Aufgabenseiten aktuell');
  } else {
    let n = 0;
    for (const [rel, html] of build()) { mkdirSync(dirname(join(ROOT, rel)), { recursive: true }); writeFileSync(join(ROOT, rel), html); n++; }
    console.log(`${n - 1} Aufgabenseiten (${LANGS.map(l => l[0]).join(', ')}) + sitemap.xml geschrieben`);
  }
}
