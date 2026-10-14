import { describe, it, expect } from 'vitest';
import { htmlToText, extractMediaIds, isBlankBody, normalizeBody } from '../src/util';

// تجريد HTML قبل النشر — كان محتوى المحرر يُنشر خاماً فتظهر الوسوم حرفياً
describe('htmlToText', () => {
  it('يُبقي النص العادي كما هو', () => {
    expect(htmlToText('مرحباً بكم في ناف')).toBe('مرحباً بكم في ناف');
  });

  it('يُزيل الوسوم ويحوّل الفقرات إلى أسطر', () => {
    expect(htmlToText('<p>سطر أول</p><p>سطر ثانٍ</p>')).toBe('سطر أول\nسطر ثانٍ');
  });

  it('يحوّل القوائم إلى نقاط', () => {
    expect(htmlToText('<ul><li>عقود</li><li>استشارات</li></ul>')).toBe('• عقود\n• استشارات');
  });

  it('يحوّل <br> إلى سطر جديد', () => {
    expect(htmlToText('أ<br>ب')).toBe('أ\nب');
  });

  it('يفكّ كيانات HTML', () => {
    expect(htmlToText('<p>ناف &amp; شركاؤه&nbsp;هنا</p>')).toBe('ناف & شركاؤه هنا');
  });

  it('يحذف محتوى script وstyle', () => {
    expect(htmlToText('<p>نص</p><script>alert(1)</script>')).toBe('نص');
  });

  it('الأسطر الفارغة تبقى بعددها كما كُتبت', () => {
    expect(htmlToText('<p>أ</p><p></p><p></p><p>ب</p>')).toBe('أ\n\n\nب');
    expect(htmlToText('أ<div><br></div><div><br></div><div>ب</div>')).toBe('أ\n\n\nب');
  });

  // ما يكتبه المتصفح في المحرر: أول سطرٍ نصٌّ مجرّد، وكل Enter بعده <div>
  it('السطر الأول لا يلتصق بالثاني', () => {
    expect(htmlToText('سطر١<div>سطر٢</div><div>سطر٣</div>')).toBe('سطر١\nسطر٢\nسطر٣');
    expect(htmlToText('سطر١<div><br></div><div>سطر٢</div>')).toBe('سطر١\n\nسطر٢');
  });

  it('<br> الأخير في الكتلة لا يزيد سطراً، وما قبله يبقى', () => {
    expect(htmlToText('<div>أ<br></div><div>ب</div>')).toBe('أ\nب');
    expect(htmlToText('<div>أ<br><br></div><div>ب</div>')).toBe('أ\n\nب');
    expect(htmlToText('<p>أ<br/><br/>ب</p><p><br/></p><p>ج</p>')).toBe('أ\n\nب\n\nج');
  });

  it('المسافات تبقى كما كُتبت، و&nbsp; لا يُنشر حرفياً', () => {
    expect(htmlToText('ناف&nbsp; &nbsp;للمحاماة')).toBe('ناف   للمحاماة');
    expect(htmlToText('<div>أ&#160;ب &#xa0;ج</div>')).toBe('أ ب  ج');
    expect(htmlToText('<div>&amp;lt;</div>')).toBe('&lt;');
  });

  it('القائمة المرقّمة تبقى بأرقامها', () => {
    expect(htmlToText('<ol><li>أ</li><li>ب</li></ol>')).toBe('1. أ\n2. ب');
    expect(htmlToText('مقدمة<ol><li>أ</li></ol><ul><li>ب</li></ul>')).toBe('مقدمة\n1. أ\n• ب');
  });

  it('فراغُ الشيفرة بين الكتل ليس سطراً', () => {
    expect(htmlToText('<ul>\n  <li>أ</li>\n  <li>ب</li>\n</ul>')).toBe('• أ\n• ب');
  });

  it('يحذف اسم الوسيط ووصفه من بطاقة المحرر — المقطع والصورة', () => {
    // كما يبنيها `mediaEmbedHtml` في web/src/mediaEmbed.ts
    const video =
      '<div class="media-embed media-card k-video" contenteditable="false" data-media-id="media_1" data-media-url="/api/media/media_1">' +
      '<span class="media-ic">VID</span>' +
      '<span class="media-meta"><span class="media-cap">VIDdownload-1789181641218.mp4</span>' +
      '<span class="media-sub">فيديو • اضغط للاستعراض</span></span></div>';
    const image =
      '<div class="media-embed media-img" contenteditable="false" data-media-id="media_2">' +
      '<img class="media-thumb" src="/api/media/media_2" alt="CD29D019.png" loading="lazy"/>' +
      '<div class="media-cap">CD29D019.png</div></div>';
    expect(htmlToText(`<p>هذا المحتوى تجريبي ٢</p>${video}`)).toBe('هذا المحتوى تجريبي ٢');
    // البطاقة تفصل ما قبلها عمّا بعدها ولا تزيد سطراً — والسطر الفارغ الذي يتركه الإدراج بعدها يبقى
    expect(htmlToText(`<p>نص</p>${image}<p>بعدها</p>`)).toBe('نص\nبعدها');
    expect(htmlToText(`<p>نص</p>${image}<p><br/></p><p>بعدها</p>`)).toBe('نص\n\nبعدها');
    // والوسيط ما زال يُعرف من معرّفه
    expect(extractMediaIds(video)).toEqual(['media_1']);
  });

  it('يتعامل مع الفارغ بأمان', () => {
    expect(htmlToText('')).toBe('');
  });
});

// استخراج الوسائط المضمّنة في المتن لنشرها مع المنشور
describe('extractMediaIds', () => {
  it('يستخرج معرّفاً واحداً', () => {
    expect(extractMediaIds('<img src="/api/media/med_abc123">')).toEqual(['med_abc123']);
  });

  it('يستخرج عدة معرّفات دون تكرار', () => {
    const html = '<img src="/api/media/a1"><img src="/api/media/b2"><img src="/api/media/a1">';
    expect(extractMediaIds(html)).toEqual(['a1', 'b2']);
  });

  it('يُعيد فارغاً عند غياب الوسائط', () => {
    expect(extractMediaIds('<p>نص فقط</p>')).toEqual([]);
  });
});

// النصّ الفارغ في المعنى — عليه تُشتقّ «فكرة»: مسودةٌ لم يُكتب نصّها
describe('isBlankBody', () => {
  it('ما يتركه المحرر بعد المسح فارغ', () => {
    for (const html of ['', '<br>', '<p><br></p>', '<div><br></div>', '&nbsp;', ' \n ', '\u200f', '<p>\u2068\u2069</p>']) {
      expect(isBlankBody(html), JSON.stringify(html)).toBe(true);
    }
  });

  it('غير النصّ فارغ', () => {
    expect(isBlankBody(undefined)).toBe(true);
    expect(isBlankBody(null)).toBe(true);
    expect(isBlankBody(42)).toBe(true);
  });

  it('كلمةٌ واحدة نصّ', () => {
    expect(isBlankBody('<p>عقد</p>')).toBe(false);
  });

  it('الوسيط وحده محتوى — وإن جُرّد اسمه من النصّ', () => {
    const embed =
      '<div class="media-embed media-img" contenteditable="false" data-media-id="med_1" data-media-url="/api/media/med_1">' +
      '<img class="media-thumb" src="/api/media/med_1" alt="a.png"/><div class="media-cap">a.png</div></div>';
    expect(htmlToText(embed)).toBe('');
    expect(isBlankBody(embed)).toBe(false);
    expect(isBlankBody('<img src="https://example.com/a.png">')).toBe(false);
  });
});

describe('normalizeBody', () => {
  it('الفارغ في المعنى يُخزَّن فارغاً حرفياً', () => {
    expect(normalizeBody('<div><br></div>')).toBe('');
    expect(normalizeBody(undefined)).toBe('');
  });

  it('النصّ يُخزَّن كما هو', () => {
    expect(normalizeBody('<p>نص</p>')).toBe('<p>نص</p>');
  });
});
