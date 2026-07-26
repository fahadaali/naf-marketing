# جرد عام — naf-marketing

التاريخ: 2026-07-26 · الإصدار المستهدف: `naf-governance#v1.1.1`

---

## الإطار وطريقة التنسيق

| البند | القيمة |
|---|---|
| الواجهة | React `^18.3.1` + Vite `^5.3.1` + TypeScript |
| التوجيه | `react-router-dom` |
| الخادم | Cloudflare Workers + Hono (خارج نطاق هذا الجرد) |
| **طريقة التنسيق** | **CSS خام في ملف واحد** `web/src/styles.css` (508 سطر) + أنماط سطرية `style={{}}` في JSX |
| Tailwind | **غير موجود** — لا `tailwind.config`، ولا حزمة، ولا أصناف utility |
| نظام رموز | خصائص CSS مخصّصة في `:root` — **نظام موازٍ، تفصيله في `audit/colors.md`** |
| `lucide-react` | `^0.408.0` — **بنطاق مفتوح**، والسجلّ يثبّت `1.27.0` |

### تبعة غياب Tailwind

قواعد الاتجاه في `CLAUDE.md §2` مكتوبة بأصناف Tailwind (`ms-*` بدل `ml-*`). هذه المنصة لا تملكها، فالمقابل هنا هو **الخصائص المنطقية في CSS**: `margin-inline-start` و`padding-inline-end` و`inset-inline-start` — وهو ما ينصّ عليه القسم نفسه في فقرته الأخيرة.

---

## اللغة والاتجاه

| البند | الحالة |
|---|---|
| `web/index.html` | `<html lang="ar" dir="rtl">` ✅ **مضبوط مسبقاً** |
| مزوّد اتجاه على مستوى التطبيق | لا يوجد (غير مطلوب — الاتجاه على عنصر الجذر) |

---

## الوضع الداكن

**مدعوم بالكامل.** آلية `:root[data-theme='light' | 'dark']` مع مبدّل في `web/src/components/Layout.tsx:31-34` يكتب السمة على `document.documentElement`.

كل رمز لوني معرَّف في الوضعين. لا يوجد اعتماد على `prefers-color-scheme` في واجهة الإدارة (يظهر فقط في صفحات المقالات العامة المُخدَّمة من الخادم، خارج `web/src`).

---

## مكوّنات الواجهة الموجودة

`web/src/components/` — **٧ مكوّنات مشتركة**:

| المكوّن | الوظيفة |
|---|---|
| `Layout.tsx` | الهيكل العام، القائمة الجانبية، مبدّل الوضع |
| `Modal.tsx` | نافذة حوارية |
| `Popover.tsx` | قائمة منبثقة |
| `DatePicker.tsx` | منتقي تاريخ ونطاق تاريخي |
| `RichEditor.tsx` | محرر نصّي غني |
| `MediaViewer.tsx` | عارض وسائط |
| `NotificationBell.tsx` | جرس الإشعارات |

**أنماط مشتركة معرَّفة بالأصناف في `styles.css` لا كمكوّنات:** `.btn` (+ `sm` `ghost` `danger` `gold`) · `.card` · `.badge` (+ `green` `red` `gray` `blue` `purple`) · `.input` · `.select` · `.table` · `.field` · `.row` · `.grid` · `.seg` · `.stat` · `.bar-track`/`.bar-fill` · `.count-pill` · `.suggest-chip`.

`web/src/pages/` — **١٥ صفحة**: Analytics · Audit · Calendar · Campaigns · Comments · Dashboard · Editor · Login · News · Newsletters · PostsList · Queue · Search · Settings · Subscribers.

---

## الأيقونات

| البند | القيمة |
|---|---|
| المكتبة | `lucide-react` حصراً ✅ — لا مكتبة أيقونات أخرى |
| أيقونات مستوردة | **٣٥ أيقونة** فريدة |
| SVG مضمّن يدوياً | **١** — `XGlyph` في `platforms.tsx:16` (شعار إكس، غير موجود في Lucide) |

الأيقونات المستوردة:
`Archive` `BarChart3` `BookOpen` `CalendarClock` `CalendarDays` `Check` `FileText` `History` `ImagePlus` `LayoutDashboard` `LayoutTemplate` `ListChecks` `Loader2` `LogOut` `Mails` `MessageCircle` `Moon` `Newspaper` `PenLine` `RefreshCw` `Rocket` `Save` `Scale` `Search` `Send` `Settings` `ShieldCheck` `Sparkles` `Sun` `Target` `Trash2` `Users` `Video` `Wand2`
(+ أخرى في ملفات الصفحات: `Plus` `Eye` `Globe` `Mail` `ExternalLink` `Heading2` `Type` `Image` `Link2` `Quote` `Minus` `MousePointerClick` `Share2` `FlaskConical` `ArrowUp` `ArrowDown` `Star` `AtSign` `Ghost` `Music2` `Facebook` `Instagram` `Linkedin` `Youtube` `FileDown` `AlertTriangle` `Lock` `Pencil` `ThumbsUp` `EyeOff` `UserMinus` `UserCheck` `Upload` `Bell` …)

### ⚠️ تعارض إصدار يمنع التنفيذ الآلي

المنصة على `^0.408.0` والسجلّ يثبّت `1.27.0`. هذه **قفزة إصدار رئيسي**، و`CLAUDE.md §3` صريح:

> «Major upgrades are a four-step procedure, never a single-repo change… Never upgrade in one repository alone.»

الخطوات الأربع تبدأ بتشغيل `/verify-icons` على **الستة مستودعات** قبل رفع أي رقم. **لذلك لم أرفع الرقم، ولن أرفعه في هذه الجلسة.** مسجَّل كقرار معلّق.

---

## الإيموجي في الواجهة

**١٤ موضعاً · ٦ محارف فريدة.** التفصيل الكامل مع المعاني في `audit/icons-mapping.md`.

منها **٣ مواضع داخل تعليقات برمجية** (`platforms.tsx:46`, `Comments.tsx:31`, `Settings.tsx:219`) — ليست واجهة مستخدم، فليست مخالفة لـ `§3`.

**١١ موضعاً في واجهة مرئية** تحتاج استبدالاً.

---

## الشعارات

| البند | الحالة |
|---|---|
| ملفات شعار في المنصة | **لا يوجد** — لا SVG ولا favicon مخصّص |
| البديل الحالي | أيقونة `Scale` من Lucide داخل `Layout.tsx` كعلامة بصرية |
| المتاح في السجلّ | `naf-logo.svg` · `naf-logo-dark.svg` · `naf-logo-mono.svg` · `naf-mark.svg` · `naf-mark-dark.svg` |

---

## مخالفات الاتجاه

**٢١ مخالفة** موزّعة:

| النوع | العدد |
|---|---|
| `margin-left/right` · `marginLeft/Right` | 9 |
| `text-align: left/right` · `textAlign` | 6 |
| `left`/`right` كموضع | 2 |
| `padding-left/right` | 2 |
| `border-left/right` | 2 |
| أصناف Tailwind (`ml-` `mr-` …) | **0** — لا وجود لـ Tailwind |

**الملفات الأكثر تركيزاً:** `styles.css` (7) · `Newsletters.tsx` (5) · `Editor.tsx` (4) · `Analytics.tsx` (3) · `Popover.tsx` (1) · `Settings.tsx` (1).

العدد منخفض نسبياً لأن أغلب التخطيط يعتمد flexbox مع `gap` (محايد اتجاهياً).

---

## ملخّص رقمي عام

| البند | العدد |
|---|---|
| ملفات الواجهة المفحوصة | 31 |
| صفحات | 15 |
| مكوّنات مشتركة | 7 |
| رموز محلية (نظام موازٍ) | 29 |
| قيم لونية خام فريدة | 31 |
| مقاسات خط فريدة | 19 |
| قيم مسافة/انحناء فريدة | 195 (‏88 خارج مضاعفات ٤) |
| تعريفات ظل فريدة | 14 |
| مخالفات اتجاه | 21 |
| مواضع إيموجي في واجهة مرئية | 11 |
| أيقونات Lucide مستوردة | 35+ |
| SVG مضمّن يدوياً | 1 |
| ملفات شعار | 0 |
| **قرارات معلّقة تمنع التنفيذ** | **1** (إصدار lucide) |
