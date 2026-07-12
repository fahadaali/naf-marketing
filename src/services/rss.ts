import type { Env } from '../types';
import { newId } from '../util';

// جلب خلاصات RSS/Atom وتخزين العناصر الجديدة في news_items (idempotent عبر link الفريد).

type ParsedItem = { title: string; link: string; summary: string; published_at: string | null };

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return decodeEntities(stripCdata(m[1]).replace(/<[^>]+>/g, '').trim());
}

function extractLink(block: string): string {
  // RSS: <link>url</link> | Atom: <link href="url"/>
  const rss = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim()) return decodeEntities(stripCdata(rss[1]).trim());
  const atom = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return atom ? decodeEntities(atom[1]) : '';
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseFeed(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) || [];
  for (const block of blocks) {
    const title = extractTag(block, 'title');
    const link = extractLink(block);
    const summary =
      extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content');
    const dateRaw =
      extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated');
    let published_at: string | null = null;
    if (dateRaw) {
      const d = new Date(dateRaw);
      if (!isNaN(d.getTime())) published_at = d.toISOString();
    }
    if (link || title) items.push({ title, link, summary: summary.slice(0, 1000), published_at });
  }
  return items;
}

export async function fetchFeed(url: string): Promise<ParsedItem[]> {
  const res = await fetch(url, { headers: { 'user-agent': 'naf-marketing-rss/1.0' } });
  if (!res.ok) throw new Error(`فشل جلب الخلاصة (${res.status})`);
  const xml = await res.text();
  return parseFeed(xml);
}

// يجلب كل الخلاصات المفعّلة ويخزّن العناصر الجديدة. يعيد عدد العناصر المُضافة.
export async function refreshAllFeeds(env: Env): Promise<number> {
  const { results: feeds } = await env.DB.prepare(
    'SELECT id, url FROM rss_feeds WHERE is_active = 1',
  ).all<{ id: string; url: string }>();

  let added = 0;
  for (const feed of feeds) {
    let items: ParsedItem[] = [];
    try {
      items = await fetchFeed(feed.url);
    } catch {
      continue; // تجاوز الخلاصة المعطوبة دون إيقاف البقية
    }
    for (const it of items) {
      if (!it.link) continue;
      const res = await env.DB.prepare(
        `INSERT OR IGNORE INTO news_items (id, feed_id, title, link, summary, published_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(newId('news'), feed.id, it.title, it.link, it.summary, it.published_at)
        .run();
      if (res.meta.changes > 0) added++;
    }
  }
  return added;
}
