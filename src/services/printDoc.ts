import { escapeHtml } from './inline';

/* ===== مستند الطباعة =====

   ملف القيم الحرفية الثاني في هذا المستودع بعد emailTheme.ts، وسببه
   منصوصٌ عليه في CLAUDE.md §1 — استثناء الطباعة و PDF:

     «مستندٌ يُولَّد في نافذته الخاصة لا يرث ورقة أنماط التطبيق ولا
      يستطيع حلّ var(--…). ويجب أن يبقى فاتحاً مهما كان وضع القارئ:
      فاتورةٌ داكنة تهدر الحبر، ومذكّرةٌ داكنة لا تُقدَّم.»

   فلا رمز CSS واحد هنا، ولا @media (prefers-color-scheme: dark).
   والصفحة تُفتح في نافذة جديدة وتستدعي print() بنفسها، فالقارئ يحفظها
   PDF من حوار الطباعة — ومحرّك المتصفح يصفّ العربية صحيحةً بتشكيلها
   وتكسير أسطرها، وهو ما لا تفعله مكتبة PDF خفيفة في Workers.

   القيم أسودُ على أبيض عمداً: المستند القانوني يُصوَّر ويُرسَل بالفاكس
   ويُضمّ إلى ملفّ، والرماديّ الفاتح يختفي في كلّ واحدة من هذه. */

/* autoPrint: تفتحه نافذةُ المتصفح فتطبع نفسها. ويُطفأ حين يُصيَّر
   المستند إلى PDF في الخادم — لا نافذة هناك تطبع، واستدعاء print()
   في كروم بلا واجهة يعلّق التصيير بلا فائدة. */
export function printDocument(title: string, bodyHtml: string, opts: { autoPrint?: boolean } = {}): string {
  const autoPrint = opts.autoPrint !== false;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  /* قيم حرفية — استثناء الطباعة، CLAUDE.md §1. لا رموز ولا وضع داكن. */
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #FFFFFF; color: #000000;
    font-family: "Times New Roman", "Traditional Arabic", serif;
    font-size: 12pt; line-height: 1.9;
  }
  .doc { max-width: 170mm; margin: 0 auto; padding: 12mm 0; }
  h1 { font-size: 20pt; line-height: 1.4; margin: 0 0 12pt; }
  h2 { font-size: 15pt; margin: 16pt 0 8pt; }
  h3 { font-size: 13pt; margin: 14pt 0 6pt; }
  p { margin: 0 0 8pt; text-align: justify; }
  img { max-width: 100%; height: auto; }
  figure { margin: 10pt 0; }
  figcaption { font-size: 10pt; text-align: center; margin-top: 4pt; }
  /* border-right لا border-inline-start: هذا مستندٌ RTL مكتوب جهتُه
     مباشرةً، ومحرّكات الطباعة القديمة لا تحلّ الخصائص المنطقية. */
  blockquote { margin: 10pt 0; padding: 0 10pt 0 0; border-right: 2pt solid #000000; }
  hr { border: none; border-top: 1pt solid #000000; margin: 14pt 0; }
  a { color: #000000; text-decoration: underline; }
  /* الرابط في ورق مطبوع بلا عنوانه رابطٌ ميّت — يُطبع بجانبه */
  @media print { a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 9pt; } }
  table { width: 100%; border-collapse: collapse; margin: 10pt 0; font-size: 11pt; }
  th, td { border: 1pt solid #000000; padding: 4pt 6pt; text-align: right; }
  th { font-weight: 700; }
  pre { font-family: Consolas, monospace; font-size: 10pt; direction: ltr; text-align: left;
        border: 1pt solid #000000; padding: 6pt; white-space: pre-wrap; word-break: break-word; }
  .article-toc, .callout, .link-card { border: 1pt solid #000000; padding: 6pt 8pt; margin: 10pt 0; }
  .link-card { display: block; }

  /* عناوين البطاقة وبطاقة الرابط كتلٌ لا نصٌّ سطريّ.

     وسما strong وspan افتراضهما inline، وورقة الصفحة العامة تجعلهما
     block — وهذه الورقة لم تكن تفعل. فخرج المستند بـ«تحذيرالمهلة
     النظامية» و«نموذج العقدتنزيل» ملتصقتين تُقرآن كلمةً واحدة. ظهر في
     التصيير لا في المراجعة. */
  .callout-title, .link-card-title, .link-card-note, .toc-title, .fn-title { display: block; }
  .callout-title, .link-card-title { font-weight: 700; margin-bottom: 3pt; }
  .link-card-note { font-size: 10pt; }
  /* بطاقة الرابط في الورق: العنوان يُطبع تحتها بقاعدة a[href] أعلاه،
     فلا يُكرَّر تسطيره على السطرين. */
  .link-card { text-decoration: none; }

  /* الإطار المضمَّن لا يُطبع: صندوقٌ فارغٌ بحدود يشغل ربع صفحة ولا يقول
     شيئاً. يُخفى ويبقى ما حوله — والعنوان يصل القارئ من بطاقة الرابط
     أو من نصّ المقال. */
  .embed-frame { display: none; }

  /* رابط «رجوع» من الحاشية إلى موضعها لا معنى له على الورق: لا نقرة
     في مستندٍ مطبوع، والكلمة تبقى ضجيجاً في آخر كل حاشية. */
  .fn-back { display: none; }

  /* مشغّلا الصوت والفيديو لا يُشغَّلان على ورق. يُخفى المشغّل ويبقى
     عنوانه (figcaption) فيعرف القارئ أن في المقال مادةً مسموعة ولم
     تُطبع — وإخفاء الاثنين معاً يحذف الخبر لا الضجيج. */
  .media-block audio, .media-block video { display: none; }
  .media-block figcaption { text-align: start; font-weight: 700; }
  .article-footnotes { margin-top: 16pt; padding-top: 8pt; border-top: 1pt solid #000000; font-size: 10pt; }
  .columns { display: block; }
  .checklist { list-style: none; padding: 0; }
  /* لا يُقطع العنوان عن فقرته الأولى بين صفحتين */
  h1, h2, h3 { break-after: avoid; }
  table, figure, blockquote, pre { break-inside: avoid; }
  .no-print { margin-bottom: 10mm; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
<div class="doc">
  ${autoPrint ? '<div class="no-print"><button onclick="window.print()">طباعة</button></div>' : ''}
  <h1>${escapeHtml(title)}</h1>
  ${bodyHtml}
</div>
${autoPrint ? `<script>
  /* الطباعة تُطلب بعد اكتمال تحميل الصور: حوار الطباعة يلتقط الصفحة
     كما هي لحظتَه، وصورةٌ لم تصل بعد تُطبع فراغاً. */
  window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });
</script>` : ''}
</body>
</html>`;
}
