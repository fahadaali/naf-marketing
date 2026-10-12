/* ═══ سلسلة الردود تحت تعليق ═══

   التعليق كان يحمل ردّاً واحداً: آخرَ ما كتبه حسابُنا. وما كتبه غيرُنا تحته
   يُرمى، فلا يُرى ردُّ العميل على ردّنا ولا ما كتبه الفريق من تطبيق المنصة
   بعد ردّه الأول. فتُحفظ السلسلة كلّها كما تردّها المنصة — ردودُنا من هنا ومن
   التطبيق، وردودُ غيرنا — في `platform_comments.thread_json`.

   وحالُ التعليق من السلسلة نفسها: «تم الرد» إن كان آخرُ ما فيها منّا،
   و«بلا رد» إن كتب العميل بعد ردّنا — قرار المالك، كما في الرسائل الخاصة.
   وردُّ غيرنا لا يجيب العميل (naf-terms «نصوص صندوق التعليقات»). */

/** ردٌّ في سلسلة تعليق. */
export type ThreadEntry = {
  /** معرّفه على منصته — فارغٌ إن لم تُعلنه. */
  id: string;
  author: string;
  /** كتبه حسابُنا — من هنا أو من تطبيق المنصة. */
  own: boolean;
  body: string;
  /** وقته (ISO) — `null` إن لم تُعلنه المنصة. */
  at: string | null;
  /** كُتب من هنا — به يُعرف ردُّنا قبل أن تعيده المنصة، ويُعدَّل ويُحذف. */
  here?: boolean;
};

/** أقصى ما يُحفظ من السلسلة — أحدثُها. منشورٌ بمئات الردود لا يُثقل صفّه. */
export const THREAD_MAX = 50;

/** ردٌّ كُتب من هنا ولم تُعده المنصة بعد يبقى يوماً — ثم يُعدّ محذوفاً منها. */
const HERE_PENDING_MS = 86_400_000;

/**
 * بترتيبها الزمني. وما لا وقت له يبقى في موضعه بعد سابقه — المنصات تردّ
 * الردود بترتيبها، فالموضع أصدقُ من وضعه في أوّلها أو آخرها.
 */
export function sortThread(entries: ThreadEntry[]): ThreadEntry[] {
  let carry = Number.NEGATIVE_INFINITY;
  const keyed = entries.map((e, i) => {
    const t = e.at ? Date.parse(e.at) : NaN;
    if (Number.isFinite(t)) carry = t;
    return { e, i, k: carry };
  });
  keyed.sort((a, b) => a.k - b.k || a.i - b.i);
  return keyed.map((x) => x.e).slice(-THREAD_MAX);
}

/** السلسلة المحفوظة — مصفوفةً، أو فارغةً لما لا سلسلة له. */
export function parseThread(json: string | null | undefined): ThreadEntry[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((e) => e && typeof e === 'object' && typeof e.body === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * الردُّ الذي يجيب العميل: آخرُ ما كتبناه إن لم يكتب أحدٌ بعده — وإلا لا ردّ.
 * به يُكتب العنصر الجديد «تم الرد» أو «بلا رد».
 */
export function threadAnswer(thread: ThreadEntry[]): ThreadEntry | null {
  const last = thread[thread.length - 1];
  return last?.own ? last : null;
}

/**
 * السلسلة كما تردّها المنصة الآن، ومعها ما يُعرف هنا وحده: علامةُ ما كُتب من
 * هنا (`here`)، وردٌّ كُتب من هنا ولم تُعده المنصة بعد (Ayrshare يحدّث
 * تعليقاته كل عشر دقائق) — يبقى يوماً كي لا يُقرأ تعليقٌ رددنا عليه للتوّ
 * «بلا رد». و`hereIds` معرّفاتُ ما كُتب من هنا ممّا حُفظ خارج السلسلة.
 */
export function mergeThread(stored: ThreadEntry[], fetched: ThreadEntry[], hereIds: string[] = [], now = Date.now()): ThreadEntry[] {
  const here = new Set([...stored.filter((e) => e.here && e.id).map((e) => e.id), ...hereIds.filter(Boolean)]);
  const seen = new Set(fetched.map((e) => e.id).filter(Boolean));
  const merged = fetched.map((e) => (e.id && here.has(e.id) ? { ...e, own: true, here: true } : e));
  for (const e of stored) {
    if (!e.here || (e.id && seen.has(e.id))) continue;
    const t = e.at ? Date.parse(e.at) : NaN;
    if (Number.isFinite(t) && now - t < HERE_PENDING_MS) merged.push(e);
  }
  return sortThread(merged);
}

/** ما يُكتب في صفّ التعليق بعد قراءة سلسلته. */
export type ThreadDecision =
  /** آخرُ ما في السلسلة منّا ولا ردّ محفوظ: يُكتب «تم الرد» بردّنا من التطبيق. */
  | { action: 'answer'; reply: ThreadEntry }
  /** كتب العميل بعد ردّنا: يعود «بلا رد». */
  | { action: 'reopen' }
  /** كتب بعد تجاهله: يعود «بلا رد» من «متجاهَل». */
  | { action: 'unignore' }
  | { action: 'none' };

/**
 * حالُ التعليق من سلسلته وصفِّه. `row` ما يلزم من الصفّ: الردُّ المحفوظ ووقته،
 * ووقتُ التجاهل.
 *
 * ولا يُعاد تعليقٌ إلى «بلا رد» بلا يقين: ردٌّ محفوظ لا يُعرف وقته — صفوفُ ما
 * قبل السلسلة — لا يُقارَن بما بعده.
 */
export function threadDecision(
  thread: ThreadEntry[],
  row: { reply_body: string | null; replied_at: string | null; ignored_at: string | null },
): ThreadDecision {
  const times = (list: ThreadEntry[]) => list.map((e) => (e.at ? Date.parse(e.at) : NaN)).filter(Number.isFinite);
  const others = thread.filter((e) => !e.own);
  const lastOther = others.length ? Math.max(Number.NEGATIVE_INFINITY, ...times(others)) : null;
  const ownTimes = times(thread.filter((e) => e.own));
  const savedAt = row.reply_body !== null && row.replied_at ? Date.parse(row.replied_at) : NaN;
  if (Number.isFinite(savedAt)) ownTimes.push(savedAt);
  const lastOwn = ownTimes.length ? Math.max(...ownTimes) : null;

  if (row.reply_body !== null) {
    if (lastOther !== null && Number.isFinite(lastOther) && lastOwn !== null && lastOther > lastOwn) return { action: 'reopen' };
    return { action: 'none' };
  }
  const answer = threadAnswer(thread);
  if (answer) return { action: 'answer', reply: answer };
  if (row.ignored_at && lastOther !== null && Number.isFinite(lastOther) && lastOther > Date.parse(row.ignored_at)) {
    return { action: 'unignore' };
  }
  return { action: 'none' };
}
