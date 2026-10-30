// نموذج الأسطر: ما يُرى في المحرر هو ما يُنشر، وهو ما يصل بيسكامب ويعود منه.

import { describe, it, expect } from 'vitest';
import { htmlToText } from '../src/util';
import { bodyLines, linesToBasecamp } from '../src/richText';
import { cardContentToBody } from '../src/services/basecampSync';

const toBasecamp = (html: string) =>
  linesToBasecamp(bodyLines(html), (e) => `<bc-attachment sgid="sg_${e.id}" caption="${e.name}"></bc-attachment>`);

// ما يقبله بيسكامب في النصّ الغني — وما سواه يحذفه
const ALLOWED = new Set(['div', 'h1', 'br', 'strong', 'em', 'strike', 'a', 'pre', 'ol', 'ul', 'li', 'blockquote', 'bc-attachment']);
const tagsOf = (html: string) => [...html.matchAll(/<\/?([a-z][\w-]*)/gi)].map((m) => m[1].toLowerCase());

describe('النشر من محتوى ملصوق', () => {
  it('قائمة مستندات جوجل: النقطة مع نصّها في سطرٍ واحد', () => {
    const gdocs = '<ul style="x"><li dir="rtl"><p dir="rtl"><span>أول</span></p></li><li><p><span>ثانٍ</span></p></li></ul>';
    expect(htmlToText(gdocs)).toBe('• أول\n• ثانٍ');
    expect(htmlToText('<ol><li><p>أ</p></li><li><p>ب</p></li></ol>')).toBe('1. أ\n2. ب');
  });

  it('السطر الفارغ بين فقرتين ملصوقتين يبقى', () => {
    expect(htmlToText('<p dir="rtl"><span>سطر</span></p><br><p dir="rtl"><span>بعده</span></p>')).toBe('سطر\n\nبعده');
  });

  it('فراغ الشيفرة داخل الفقرة مسافةٌ لا سطر — كما يعرضه المحرر', () => {
    expect(htmlToText('<p>نص طويل\n    يكمل</p>')).toBe('نص طويل يكمل');
  });

  it('النصّ المنسّق white-space: pre-wrap يبقى بأسطره وشرطاته وأرقامه', () => {
    const pasted = '<span style="white-space: pre-wrap;">سطر١\n\nسطر٣\n- شرطة\n1- رقم</span>';
    expect(htmlToText(pasted)).toBe('سطر١\n\nسطر٣\n- شرطة\n1- رقم');
  });

  it('<br> قبل كتلة لا يزيد سطراً', () => {
    expect(htmlToText('أ<br><div>ب</div>')).toBe('أ\nب');
  });
});

describe('وصف بطاقة بيسكامب', () => {
  it('الغامق والمائل بوسوم بيسكامب — كان <b> يُحذف فيضيع الغامق', () => {
    const out = toBasecamp('<div><b>غامق</b> و<i>مائل</i> و<span style="font-weight: 700">ملصوق</span></div>');
    expect(out).toBe('<div><strong>غامق</strong> و<em>مائل</em> و<strong>ملصوق</strong></div>');
  });

  it('الأسطر والأسطر الفارغة بـ<br> داخل الكتلة، كما يكتبها محرر بيسكامب', () => {
    expect(toBasecamp('سطر١<div>سطر٢</div><div><br></div><div>سطر٤</div>')).toBe('<div>سطر١<br>سطر٢<br><br>سطر٤</div>');
    // السطر الملصوق بمحرف سطر — كان يلتصق في بيسكامب
    expect(toBasecamp('<span style="white-space:pre-wrap">أ\nب</span>')).toBe('<div>أ<br>ب</div>');
  });

  it('القوائم قوائم، والمتداخلة متداخلة', () => {
    expect(toBasecamp('<ul><li>أ<ul><li>ب</li></ul></li><li>ج</li></ul>')).toBe('<ul><li>أ<ul><li>ب</li></ul></li><li>ج</li></ul>');
    expect(toBasecamp('<ol><li><p>أ</p></li><li>ب</li></ol><p>بعد</p>')).toBe('<ol><li>أ</li><li>ب</li></ol><div>بعد</div>');
  });

  it('الوسيط مرفقٌ في موضعه', () => {
    const embed = '<div class="media-embed media-img" contenteditable="false" data-media-id="m1" data-media-name="a.png"><img src="/api/media/m1"/><div class="media-cap">a.png</div></div>';
    expect(toBasecamp(`<p>قبل</p>${embed}<p>بعد</p>`)).toBe('<div>قبل</div><bc-attachment sgid="sg_m1" caption="a.png"></bc-attachment><div>بعد</div>');
  });

  it('لا وسم خارج ما يقبله بيسكامب', () => {
    const html = '<h2>عنوان</h2><blockquote>اقتباس</blockquote><p><u>مسطّر</u> <s>مشطوب</s> <a href="https://naf.sa">رابط</a> <font>خط</font></p><table><tr><td>خلية</td></tr></table>';
    for (const t of tagsOf(toBasecamp(html))) expect(ALLOWED.has(t), t).toBe(true);
  });
});

/* الثابت: النصّ المنشور من المنشور = المنشور من وصف بطاقته = المنشور بعد
   عودته من بيسكامب. فلا يغيّر الذهاب والإياب سطراً ولا نقطةً ولا رقماً. */
const CORPUS = [
  'سطر١<div>سطر٢</div><div><br></div><div><br></div><div>سطر٥</div>',
  '<p>أ<br/><br/>ب</p><p><br/></p><p>ج</p>',
  '<p>مقدمة</p><ol><li>أ</li><li>ب</li></ol><ul><li>ج</li></ul><p>خاتمة</p>',
  '<div><b>عنوان غامق</b></div><div>- شرطة أولى</div><div>- شرطة ثانية</div><div><br></div><div>1) رقم</div>',
  '<span style="white-space: pre-wrap;">قضية رقم 2291/ت/1447\n\n• نقطة\n  مسافة بادئة</span>',
  '<ul style="x"><li><p><span>أول</span></p></li><li><p>ثانٍ</p></li></ul><br><p>بعد</p>',
  'ناف&nbsp; &nbsp;للمحاماة<div>&amp;lt; رمز</div>',
  '<h2>عنوان</h2><blockquote>اقتباس<br>سطر ثانٍ</blockquote><div>نص</div>',
  '<ol><li>أ<ol><li>أ-١</li></ol></li><li>ب</li></ol>',
  '<div>أ<br><br></div><ul><li>ب</li></ul>',
  '<p><b>غامق<br>يمتد</b> سطرين</p>',
];

function rand(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}
function fuzz(r: () => number, depth = 0): string {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  let out = '';
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const k = depth > 3 ? pick(['t', 'br', 's']) : pick(['t', 't', 'br', 's', 'b', 'i', 'div', 'p', 'ul', 'ol', 'empty', 'pre', 'h2', 'nl']);
    if (k === 't') out += pick(['نص', 'كلمة أخرى', '12,400', '- شرطة', '1. رقم', '&nbsp;', ' ', 'a&amp;b']);
    else if (k === 'br') out += '<br>';
    else if (k === 's') out += pick(['  ', '\n', ' \n  ']);
    else if (k === 'nl') out += '\n';
    else if (k === 'b') out += `<b>${fuzz(r, depth + 1)}</b>`;
    else if (k === 'i') out += `<span style="font-style: italic">${fuzz(r, depth + 1)}</span>`;
    else if (k === 'div' || k === 'p' || k === 'h2') out += `<${k}>${fuzz(r, depth + 1)}</${k}>`;
    else if (k === 'empty') out += pick(['<div><br></div>', '<p></p>', '<div></div>']);
    else if (k === 'pre') out += `<span style="white-space:pre-wrap">${pick(['أ\nب', '\n\nج', 'د\n'])}</span>`;
    else {
      const items = 1 + Math.floor(r() * 3);
      out += `<${k}>`;
      for (let j = 0; j < items; j++) out += `<li>${fuzz(r, depth + 1)}</li>`;
      out += `</${k}>`;
    }
  }
  return out;
}

describe('الذهاب إلى بيسكامب والعودة منه لا يغيّر النصّ المنشور', () => {
  const env = {} as any; // بلا مرفقات لا يُسأل عن شيء
  const cases = [...CORPUS];
  for (const seed of [7, 7919, 104729, 1299709]) {
    const r = rand(seed);
    for (let i = 0; i < 300; i++) cases.push(fuzz(r));
  }

  it('الوصف ينشر ما ينشره المنشور', () => {
    for (const html of cases) expect(htmlToText(toBasecamp(html)), html).toBe(htmlToText(html));
  });

  it('ما يعود من بيسكامب ينشر ما كان، ولا يتغيّر بذهابٍ ثانٍ', async () => {
    for (const html of cases) {
      const back = await cardContentToBody(env, toBasecamp(html), html);
      expect(htmlToText(back), html).toBe(htmlToText(html));
      // المحتوى الفارغ في معناه يُخزَّن '' (`normalizeBody`) — لا وصف يُقارن
      if (back) expect(toBasecamp(back), html).toBe(toBasecamp(html));
    }
  });

  it('الوصف بوسوم بيسكامب وحدها', () => {
    for (const html of cases) for (const t of tagsOf(toBasecamp(html))) expect(ALLOWED.has(t), `${t} in ${html}`).toBe(true);
  });
});
