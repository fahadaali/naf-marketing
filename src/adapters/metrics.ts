function toIso(v: unknown): string {
  if (v == null) return new Date().toISOString();
  const n = Number(v);
  const d = Number.isFinite(n) && n > 1e9 && n < 1e11 ? new Date(n * 1000) : new Date(v as string);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/* ═══ تخريط المقاييس ═══

   المزوّد يوحّد أربعةً في المستوى الأعلى — الإعجاب والتعليق والمشاركة
   والحفظ — ويضع ما عداها في `extra` بأسماء المنصّة نفسها: `view_count`
   لتيك توك، و`impressionCount` للينكدإن، و`reach` لإنستغرام. وقد يردّ
   الأربعة بلاحقة (`like_count`، `comments_count`).

   وثلاث قواعد:
   ١) الاسم يُردّ إلى أصله قبل الجمع — `like_count` إعجابٌ كـ`likes`. وكان
      التطابق حرفياً، فكل مقياسٍ بلاحقةٍ خارج التفاعل: صفر.
   ٢) ما في `extra` لا يُضاف إلى ما في المستوى الأعلى باسمه الموحّد — وإلا
      عُدّ الإعجاب مرّتين.
   ٣) الغياب ليس صفراً: ما لم يُعلَن يعود `null`، ومنشورٌ لم تُعلَن له أرقام
      أصلاً `present: false` — فلا يدخل مجموعاً ولا متوسّطاً. */

const METRIC_ALIASES: Record<string, string> = {
  like: 'likes', like_count: 'likes', likes_count: 'likes', likecount: 'likes', favorite_count: 'favorites',
  favorites: 'favorites', favourites: 'favorites',
  reaction_count: 'reactions', reactions_count: 'reactions', reactioncount: 'reactions',
  comment: 'comments', comment_count: 'comments', comments_count: 'comments', commentcount: 'comments',
  share: 'shares', share_count: 'shares', shares_count: 'shares', sharecount: 'shares',
  repost_count: 'reposts', reposts_count: 'reposts', retweet_count: 'retweets', quote_count: 'quotes',
  save: 'saves', saved: 'saves', save_count: 'saves', saves_count: 'saves', bookmark_count: 'bookmarks',
  click: 'clicks', click_count: 'clicks', clicks_count: 'clicks', clickcount: 'clicks',
  follow_count: 'follows',
  view: 'views', view_count: 'views', views_count: 'views', viewcount: 'views', video_views: 'views', play_count: 'views', plays: 'views',
  impression_count: 'impressions', impressioncount: 'impressions',
  reach_count: 'reach',
};

/** مقاييس التفاعل — تُجمع في «التفاعل». */
const ENGAGE = new Set(['reactions', 'comments', 'shares', 'reposts', 'saves', 'clicks', 'likes', 'quotes', 'follows', 'favorites', 'retweets', 'bookmarks']);

/** الاسم الموحّد لمقياس — أو `null` لما ليس مقياساً معروفاً. */
export function canonicalMetric(key: string): string | null {
  const k = METRIC_ALIASES[key] ?? key;
  if (ENGAGE.has(k) || k === 'reach' || k === 'impressions' || k === 'views') return k;
  return null;
}

/** أسماءٌ لا تُعدّ ظهوراً ولا وصولاً وإن حوت الكلمة: مدّةٌ ونسبةٌ ومتوسّط. */
function isRatioLike(key: string): boolean {
  return /rate|ratio|percent|avg|average|duration|time|_ms$|seconds/.test(key);
}

export function mapMetrics(metricsObj: any): {
  reach: number | null;
  impressions: number | null;
  engagement: number | null;
  raw: any[];
  /** أعلن المزوّد أرقاماً أصلاً — لا صفراً افتراضياً عن غياب. */
  present: boolean;
  /** متى زامن المزوّد هذه الأرقام من المنصّة (`metrics_synced_at`) إن أعلنه. */
  syncedAt: string | null;
} {
  const top = new Map<string, number>();
  const nested = new Map<string, number>();
  // الاسم كما أرسله المزوّد — يُحفظ مع الموحَّد فلا يضيع أصلُه
  const original = new Map<string, string>();
  /* ووحدةُ ما جاء مصفوفةً بوحداته — المدّة بالدقائق — تبقى كما هي. وكانت تُعاد
     «count» لكل ما ليس نسبة، فتُكتب مدّة المشاهدة عدداً. */
  const units = new Map<string, string>();
  let syncedAt: unknown;

  const put = (into: Map<string, number>, key: string, value: unknown, name?: unknown, unit?: unknown) => {
    const n = typeof value === 'number' ? value : Number(value);
    // معرّفٌ أو ترتيبٌ رقميّ ليس مقياساً — ولا يجعل منشوراً بلا أرقام «مقيساً»
    if (!key || !Number.isFinite(n) || key === 'id' || /_id$|^index$|position|version/.test(key)) return;
    const k = METRIC_ALIASES[key] ?? key;
    if (!into.has(k)) into.set(k, n);
    if (!original.has(k)) original.set(k, typeof name === 'string' && name ? name : key);
    if (typeof unit === 'string' && unit && !units.has(k)) units.set(k, unit);
  };

  if (Array.isArray(metricsObj)) {
    for (const m of metricsObj) put(top, String(m?.type || m?.name || '').toLowerCase(), m?.value, m?.name, m?.unit);
  } else if (metricsObj && typeof metricsObj === 'object') {
    if ('metrics_synced_at' in metricsObj) syncedAt = metricsObj.metrics_synced_at;
    // نتعمّق في الكائنات المتداخلة (مثل extra:{view_count}) لتسطيح كل المقاييس الرقمية
    const walk = (o: any) => {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v);
        else if (typeof v === 'number') put(nested, k.toLowerCase(), v);
      }
    };
    // المستوى الأعلى أوّلاً ثم المتداخل — فيُحفظ للاسم الموحَّد أصلُه من حيث أُخذت قيمته
    for (const [k, v] of Object.entries(metricsObj)) if (typeof v === 'number') put(top, k.toLowerCase(), v);
    for (const v of Object.values(metricsObj)) if (v && typeof v === 'object' && !Array.isArray(v)) walk(v);
  }

  // المستوى الأعلى يسبق: ما في `extra` يُكمل ولا يُكرّر
  const entries = new Map(top);
  for (const [k, v] of nested) if (!entries.has(k)) entries.set(k, v);

  const raw: any[] = [];
  for (const [key, value] of entries) {
    raw.push({ type: key, name: original.get(key) ?? key, value, unit: units.get(key) ?? (key.includes('rate') ? 'percentage' : 'count') });
  }

  /* الوصول والظهور والمشاهدات: الاسم الصريح أوّلاً، وإلا أكبرُ ما حمل الكلمة.
     الجمعُ على كل ما حوى «impression» كان يضمّ الظهور الكلّي والفريد
     والمدفوع والعضوي في رقمٍ واحد — أضعافَ الحقيقة. */
  const pick = (exact: string, word: string): number | null => {
    if (entries.has(exact)) return entries.get(exact) as number;
    let best: number | null = null;
    for (const [k, v] of entries) {
      // «reviews» تحوي «view» وليست مشاهدة
      if (k.includes(word) && !isRatioLike(k) && !k.includes('review') && (best === null || v > best)) best = v;
    }
    return best;
  };
  const reach = pick('reach', 'reach');
  const views = pick('views', 'view');
  const impressions = pick('impressions', 'impression') ?? views ?? reach;

  let engagement: number | null = null;
  for (const [k, v] of entries) {
    if (ENGAGE.has(k)) engagement = (engagement ?? 0) + v;
  }

  /* مزوّدٌ صرّح بأنه لم يُزامن أرقام هذا المنشور بعد (`metrics_synced_at: null`)
     وأعاد أصفاراً: أصفارُه غيابٌ لا قياس. */
  const allZero = raw.every((r) => r.value === 0);
  const present = raw.length > 0 && !(syncedAt === null && allZero);
  const stamp = typeof syncedAt === 'string' && syncedAt ? toIso(syncedAt) : null;

  if (!present) return { reach: null, impressions: null, engagement: null, raw, present, syncedAt: stamp };
  return { reach, impressions, engagement, raw, present, syncedAt: stamp };
}
