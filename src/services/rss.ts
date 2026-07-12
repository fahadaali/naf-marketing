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
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; naf-marketing-rss/1.0)',
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`فشل جلب الخلاصة (HTTP ${res.status})`);
  const xml = await res.text();
  const items = parseFeed(xml);
  if (items.length === 0) {
    throw new Error('لم يُعثر على عناصر في الخلاصة (تنسيق غير مدعوم أو خلاصة فارغة)');
  }
  return items;
}

export type FeedResult = { url: string; added: number; fetched: number; error: string | null };

// يجلب خلاصة واحدة ويخزّن عناصرها الجديدة (idempotent عبر link الفريد).
async function ingestFeed(env: Env, feed: { id: string; url: string }): Promise<FeedResult> {
  let items: ParsedItem[];
  try {
    items = await fetchFeed(feed.url);
  } catch (err: any) {
    return { url: feed.url, added: 0, fetched: 0, error: String(err?.message || err) };
  }
  let added = 0;
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
  return { url: feed.url, added, fetched: items.length, error: null };
}

// يجلب كل الخلاصات المفعّلة. يعيد إجمالي المُضاف وتفصيلاً لكل خلاصة.
export async function refreshAllFeeds(env: Env): Promise<{ added: number; feeds: FeedResult[] }> {
  const { results: feeds } = await env.DB.prepare(
    'SELECT id, url FROM rss_feeds WHERE is_active = 1',
  ).all<{ id: string; url: string }>();

  const results: FeedResult[] = [];
  let added = 0;
  for (const feed of feeds) {
    const r = await ingestFeed(env, feed);
    results.push(r);
    added += r.added;
  }
  return { added, feeds: results };
}

// جلب فوري لخلاصة محددة (يُستخدم عند إضافتها).
export async function refreshOneFeed(env: Env, feedId: string): Promise<FeedResult> {
  const feed = await env.DB.prepare('SELECT id, url FROM rss_feeds WHERE id = ?')
    .bind(feedId)
    .first<{ id: string; url: string }>();
  if (!feed) return { url: '', added: 0, fetched: 0, error: 'الخلاصة غير موجودة' };
  return ingestFeed(env, feed);
}
