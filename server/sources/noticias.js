// Noticias del campo: feeds RSS de medios agropecuarios reconocidos y listados oficiales (SENASA, INTA, Bolsa de Cereales de Entre Ríos).
// Solo se guarda título, fecha, un resumen corto y el enlace al original (no se copian artículos).
import { getText } from '../lib/http.js';
import { stripTags, decodeEntities, truncate } from '../lib/text.js';
import { classify, isExcluded, isAgroRelevant } from '../lib/news-classify.js';
import { insertNews, pruneNews, getSetting } from '../db.js';

export const FEEDS = [
  { id: 'senasa', name: 'SENASA', kind: 'gob', url: 'https://www.argentina.gob.ar/senasa/senasacomunica', defaults: ['senasa', 'sanidad'], official: true, filter: false },
  { id: 'inta', name: 'INTA', kind: 'gob', url: 'https://www.argentina.gob.ar/inta/noticias', defaults: [], official: true, filter: false },
  { id: 'bolsacer', name: 'Bolsa de Cereales de Entre Ríos', kind: 'rss', url: 'https://bolsacer.org.ar/site/feed/', defaults: ['entre-rios'], official: false, filter: false },
  { id: 'lanacion-campo', name: 'La Nación Campo', kind: 'rss', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/economia/campo/?outputType=xml', defaults: [], official: false, filter: true },
  { id: 'bichosdecampo', name: 'Bichos de Campo', kind: 'rss', url: 'https://bichosdecampo.com/feed/', defaults: [], official: false, filter: true },
  { id: 'infocampo', name: 'Infocampo', kind: 'rss', url: 'https://www.infocampo.com.ar/feed/', defaults: [], official: false, filter: true },
];

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

export function parseRss(xml) {
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[0];
    const title = decodeEntities(stripTags(tag(b, 'title')));
    const link = decodeEntities(tag(b, 'link')).trim();
    const pub = tag(b, 'pubDate') || tag(b, 'dc:date');
    const desc = stripTags(decodeEntities(tag(b, 'description')));
    const d = pub ? new Date(pub) : null;
    if (title && /^https?:\/\//.test(link)) items.push({ title, url: link, publishedAt: d && !isNaN(d) ? d.toISOString() : null, summary: truncate(desc, 280) });
  }
  return items;
}

// Listados de argentina.gob.ar (SENASA, INTA): <a href="/noticias/..."> <time datetime='YYYY-MM-DD HH:MM:SS'> <h3>Título</h3> <p class="text-muted"><p>Resumen</p>
export function parseGobListado(html) {
  const items = [];
  const re = /<a href="(\/noticias\/[^"]+)"[^>]*class="panel panel-default"[\s\S]*?<time datetime='([^']+)'[^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const d = new Date(m[2].replace(' ', 'T') + '-03:00');
    items.push({
      title: stripTags(m[3]),
      url: 'https://www.argentina.gob.ar' + m[1],
      publishedAt: isNaN(d) ? null : d.toISOString(),
      summary: truncate(stripTags(m[4]), 280),
    });
  }
  return items;
}

export default {
  id: 'noticias',
  name: 'Noticias del campo (SENASA, INTA, Bolsa de Cereales de Entre Ríos y medios agropecuarios)',
  org: 'Varias fuentes',
  category: 'noticias',
  url: null,
  official: false,
  access: 'Feeds RSS y páginas públicas. Sin API Key.',
  everyMin: 60,
  staleAfterMin: 60 * 12,
  async run({ log }) {
    const disabled = getSetting('news_disabled_feeds', []);
    let added = 0;
    let okFeeds = 0;
    const errors = [];
    for (const f of FEEDS) {
      if (disabled.includes(f.id)) continue;
      try {
        const body = await getText(f.url, { headers: { Accept: f.kind === 'rss' ? 'application/rss+xml, application/xml, text/xml' : 'text/html' } });
        const items = f.kind === 'rss' ? parseRss(body) : parseGobListado(body);
        if (!items.length) throw new Error('sin notas (¿cambió el formato?)');
        okFeeds++;
        for (const it of items.slice(0, 25)) {
          if (isExcluded(it.title)) continue;
          const cats = classify(it.title, it.summary, f.defaults);
          if (f.filter && !isAgroRelevant(cats)) continue;
          if (insertNews({ source: f.id, sourceName: f.name, category: cats.join(','), ...it })) added++;
        }
      } catch (e) {
        errors.push(`${f.name}: ${e.message}`);
      }
    }
    if (errors.length) log('warn', errors.join(' | '));
    if (!okFeeds) throw new Error('Ninguna fuente de noticias respondió: ' + errors.join(' | '));
    pruneNews();
    return { items: added, message: `${added} noticias nuevas de ${okFeeds} fuentes` };
  },
};
