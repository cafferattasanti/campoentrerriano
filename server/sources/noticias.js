// Noticias del campo: feeds RSS de medios agropecuarios reconocidos y listados oficiales (SENASA, INTA, Bolsa de Cereales de Entre Ríos).
// Solo se guarda título, fecha, un resumen corto y el enlace al original (no se copian artículos).
import { getText, getJson } from '../lib/http.js';
import { stripTags, decodeEntities, truncate, normalize } from '../lib/text.js';
import { classify, isExcluded } from '../lib/news-classify.js';
import { insertNews, pruneNews, getSetting } from '../db.js';

// zoneFor: zona por defecto cuando el texto no nombra ningún lugar (ver lib/news-classify.js).
const debateZone = (it) => (/\/locales\//.test(it.url) ? 'local' : /\/provinciales\//.test(it.url) ? 'provincia' : null);
export const FEEDS = [
  { id: 'debatepregon', name: 'El Debate Pregón (Gualeguay)', kind: 'atom', url: 'https://debatepregonapiv3.eleco.com.ar/feed-notes', site: 'https://www.diariodebatepregon.com/', defaults: ['entre-rios'], official: false, zoneFor: debateZone },
  { id: 'gob-er', name: 'Gobierno de Entre Ríos', kind: 'gob-er', url: 'https://portal.entrerios.gov.ar/api/public/portal/noticias', site: 'https://portal.entrerios.gov.ar/', defaults: ['entre-rios'], official: true, zoneFor: () => 'provincia' },
  { id: 'bolsacer', name: 'Bolsa de Cereales de Entre Ríos', kind: 'rss', url: 'https://bolsacer.org.ar/site/feed/', site: 'https://bolsacer.org.ar/', defaults: ['entre-rios'], official: false, zoneFor: () => 'provincia' },
  { id: 'senasa', name: 'SENASA', kind: 'gob', url: 'https://www.argentina.gob.ar/senasa/senasacomunica', defaults: ['senasa', 'sanidad'], official: true },
  { id: 'inta', name: 'INTA', kind: 'gob', url: 'https://www.argentina.gob.ar/inta/noticias', defaults: [], official: true },
  { id: 'lanacion-campo', name: 'La Nación Campo', kind: 'rss', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/economia/campo/?outputType=xml', defaults: [], official: false },
  { id: 'bichosdecampo', name: 'Bichos de Campo', kind: 'rss', url: 'https://bichosdecampo.com/feed/', defaults: [], official: false },
  { id: 'infocampo', name: 'Infocampo', kind: 'rss', url: 'https://www.infocampo.com.ar/feed/', defaults: [], official: false },
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

// Atom (El Debate Pregón): <entry><title>…</title><link rel="alternate" href="…"/><summary><![CDATA[…]]></summary><category term="locales"/><published>…</published>
export function parseAtom(xml) {
  const items = [];
  const re = /<entry[\s>][\s\S]*?<\/entry>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[0];
    const title = decodeEntities(stripTags(tag(b, 'title')));
    const link = decodeEntities((b.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i) || b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '').trim();
    const pub = tag(b, 'published') || tag(b, 'updated');
    const summary = truncate(stripTags(tag(b, 'summary').replace(/<figure[\s\S]*?<\/figure>/gi, ' ')), 280);
    const section = (b.match(/<category[^>]*term="([^"]+)"/i) || [])[1] || null;
    const d = pub ? new Date(pub) : null;
    if (title && /^https?:\/\//.test(link)) items.push({ title, url: link, publishedAt: d && !isNaN(d) ? d.toISOString() : null, summary, section });
  }
  return items;
}

// Portal del Gobierno de Entre Ríos: { data: { noticias: [{ id, titulo, copete, fecha_publicacion, tipo_noticia }] } }
export function parseGobEr(j) {
  return (j?.data?.noticias || []).map((n) => {
    const d = n.fecha_publicacion ? new Date(n.fecha_publicacion.replace(' ', 'T') + '-03:00') : null;
    return {
      title: stripTags(n.titulo || ''),
      url: 'https://portal.entrerios.gov.ar/noticias/' + encodeURIComponent(n.id),
      publishedAt: d && !isNaN(d) ? d.toISOString() : null,
      summary: truncate(stripTags(n.copete || ''), 280),
      section: n.tipo_noticia || null,
    };
  }).filter((n) => n.title);
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
  name: 'Noticias del campo (diario de Gualeguay, Gobierno de Entre Ríos, Bolsa de Cereales de ER, SENASA, INTA y medios agropecuarios)',
  org: 'Varias fuentes',
  category: 'noticias',
  url: null,
  official: false,
  access: 'Feeds RSS/Atom, servicio público del portal provincial y páginas públicas. Sin API Key. Se muestran solo notas relevantes para el productor entrerriano.',
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
        let items;
        if (f.kind === 'gob-er') {
          items = parseGobEr(await getJson(f.url, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }));
        } else {
          const body = await getText(f.url, { headers: { Accept: f.kind === 'rss' || f.kind === 'atom' ? 'application/atom+xml, application/rss+xml, application/xml, text/xml' : 'text/html' } });
          items = f.kind === 'rss' ? parseRss(body) : f.kind === 'atom' ? parseAtom(body) : parseGobListado(body);
        }
        if (!items.length) throw new Error('sin notas (¿cambió el formato?)');
        okFeeds++;
        // Se guarda todo lo que no es claramente ajeno; el filtro estricto de relevancia se aplica al mostrar
        // (así el criterio se puede ajustar sin perder notas, y las de SENASA alimentan las alertas sanitarias).
        for (const it of items.slice(0, 40)) {
          if (isExcluded(it.title, it.url)) continue;
          const cats = classify(it.title, it.summary, f.defaults);
          const { section, ...rest } = it;
          if (section && /deport|espectacul|cultura|juventud|turismo|horoscopo/.test(normalize(section))) continue;
          if (insertNews({ source: f.id, sourceName: f.name, category: cats.join(','), ...rest })) added++;
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
