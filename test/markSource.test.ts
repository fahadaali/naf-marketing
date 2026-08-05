import { describe, it, expect } from 'vitest';
import { parseMarks, applyCleanEdit, wrapClean, clearColorIn } from '../web/src/lib/markSource';
import { renderInline, stripInline } from '../src/services/inline';

/* النواة التي يقوم عليها إخفاء العلامات: الحقل يعرض نصّاً نظيفاً،
   والمصدر يبقى معلَّماً، وبينهما خريطة. أخطر ما فيها أن يزحف اللون عن
   كلمته بعد تحرير — فأكثر الاختبارات هنا على ذلك. */

const P = (s: string) => parseMarks(s);

describe('فصل النظيف عن المعلَّم', () => {
  it('يجرّد العلامات كما يجرّدها الخادم حرفاً بحرف', () => {
    const cases = [
      '{c:#937133|ملوّن} عادي',
      'فيها **غامق** و*مائل* و__مسطّر__',
      '[نصّ الرابط](https://naf.sa) بعده',
      '{h:#EFEAE2|مظلّل} و{c:#FF0000|أحمر}',
      '{c:#000000|**قوي وملوّن**}',
      'بلا علامات',
    ];
    // `stripInline` هو ما يستعمله الخادم للمقتطف — فالنظيف عندنا هو نفسه
    for (const s of cases) expect(P(s).clean).toBe(stripInline(s));
  });

  it('الخريطة تشير إلى موضع كل حرف في المصدر', () => {
    const src = '{c:#937133|أب} ج';
    const p = P(src);
    expect(p.clean).toBe('أب ج');
    expect(src[p.map[0]]).toBe('أ');
    expect(src[p.map[3]]).toBe('ج');
  });

  it('النمط يلحق بالحرف لا بالمدى', () => {
    const p = P('عادي {c:#937133|ملوّن}');
    expect(p.styles[0].color).toBeUndefined();
    expect(p.styles[p.clean.indexOf('م')].color).toBe('#937133');
  });

  it('التظليل خلفية والغامق ثقل — كلٌّ في حقله', () => {
    const p = P('{h:#EFEAE2|**قوي**}');
    expect(p.styles[0].bg).toBe('#EFEAE2');
    expect(p.styles[0].bold).toBe(true);
    expect(p.clean).toBe('قوي');
  });

  it('لونٌ فاسد ليس علامة — يبقى نصّاً ظاهراً', () => {
    expect(P('{c:red|نصّ}').clean).toBe('{c:red|نصّ}');
  });
});

describe('ترجمة التحرير من النظيف إلى المصدر', () => {
  const edit = (src: string, next: string) => applyCleanEdit(src, P(src), next);

  it('إضافة حرفٍ داخل كلمةٍ ملوّنة تبقى ملوّنة', () => {
    expect(edit('{c:#937133|سلام} عليكم', 'سلاام عليكم')).toBe('{c:#937133|سلاام} عليكم');
  });

  it('الكتابة بعد كلمةٍ ملوّنة لا تُصبغ بلا طلب', () => {
    expect(edit('{c:#937133|سلام}', 'سلام عليكم')).toBe('{c:#937133|سلام} عليكم');
  });

  it('الكتابة قبلها كذلك', () => {
    expect(edit('{c:#937133|سلام}', 'يا سلام')).toBe('يا {c:#937133|سلام}');
  });

  it('حذف جزءٍ من الملوّن يبقي الباقي ملوّناً', () => {
    expect(edit('{c:#937133|سلام عليكم}', 'سلام')).toBe('{c:#937133|سلام}');
  });

  it('حذف الكلمة الملوّنة كلّها يزيل علامتها ولا يتركها فارغة', () => {
    const out = edit('قبل {c:#937133|ملوّن} بعد', 'قبل  بعد');
    expect(out).toBe('قبل  بعد');
    expect(out).not.toContain('{c:');
  });

  it('لصقُ نصٍّ مكان تحديدٍ يمسّ علامتين', () => {
    const src = '{c:#111111|أ} وسط {c:#222222|ب}';
    expect(P(edit(src, 'أ جديد ب')).clean).toBe('أ جديد ب');
  });

  it('مسح الحقل كلّه يعيد نصّاً فارغاً بلا بقايا', () => {
    expect(edit('{c:#937133|سلام} و**غامق**', '')).toBe('');
  });

  it('تحريرٌ متتابع لا يراكم خطأً في المواضع', () => {
    let src = '{c:#937133|سلام} عليكم';
    for (const next of ['سلام عليكم ورحمة', 'سلام عليكم ورحمة الله', 'سلام عليك ورحمة الله']) {
      src = applyCleanEdit(src, P(src), next);
      expect(P(src).clean).toBe(next);
    }
    expect(src.startsWith('{c:#937133|سلام')).toBe(true);
  });
});

describe('لفّ مدىً بعلامة', () => {
  it('يلوّن التحديد في موضعه من المصدر', () => {
    const src = 'سلام عليكم';
    const out = wrapClean(src, P(src), 5, 10, '{c:#937133|', '}');
    expect(out).toBe('سلام {c:#937133|عليكم}');
  });

  it('يلوّن داخل نصٍّ فيه علامةٌ سابقة', () => {
    const src = '**غامق** وعادي';
    const out = wrapClean(src, P(src), 6, 11, '{h:#EFEAE2|', '}');
    expect(P(out).clean).toBe('غامق وعادي');
    expect(P(out).styles[6].bg).toBe('#EFEAE2');
  });

  /* الطرف الأيمن للّفّ عند آخر حرفٍ محدَّد لا عند الحرف الذي يليه:
     موضع التالي يقع بعد فاتحة العلامة التي تليه. */
  it('ينتهي اللفّ قبل فاتحة العلامة التالية لا بعدها', () => {
    const src = 'السلام{c:#937133| عليكم}';
    const out = wrapClean(src, P(src), 0, 6, '{h:#F3EADD|', '}');
    expect(out).toBe('{h:#F3EADD|السلام}{c:#937133| عليكم}');
    expect(P(out).clean).toBe('السلام عليكم');
    expect(P(out).styles[0].bg).toBe('#F3EADD');
    expect(P(out).styles[6].color).toBe('#937133');
    expect(out).not.toContain('|}');
  });

  it('لفّ كلمةٍ ملوّنة كلِّها يقع داخل علامتها لا حولها مكسورة', () => {
    const src = '{c:#111111|أب} ج';
    const out = wrapClean(src, P(src), 0, 2, '**', '**');
    expect(out).toBe('{c:#111111|**أب**} ج');
    expect(P(out).clean).toBe('أب ج');
    expect(P(out).styles[0].bold).toBe(true);
    expect(renderInline(out, true)).toContain('<strong>أب</strong>');
  });
});

/* المسار الذي يسلكه زرّ اللون في الشريط: نزعٌ ثم لفّ. الرقعتان
   صحيحتان كلٌّ وحدها، والعطب كان في تركيبهما — فيُفحص التركيب. */
describe('تلوين مدىً داخل نصٍّ ملوّن — نزعٌ ثم لفّ', () => {
  const recolor = (src: string, a: number, b: number, open: string) => {
    const cleared = clearColorIn(src, P(src), a, b);
    return wrapClean(cleared, P(cleared), a, b, open, '}');
  };

  it('تظليل أوّل كلمةٍ من فقرةٍ ملوّنة', () => {
    const src = '{c:#937133|السلام عليكم ورحمة}';
    const out = recolor(src, 0, 6, '{h:#F3EADD|');
    expect(P(out).clean).toBe('السلام عليكم ورحمة');
    expect(P(out).styles[0].bg).toBe('#F3EADD');
    expect(P(out).styles[0].color).toBeUndefined(); // حلّ محلّه لا فوقه
    expect(P(out).styles[7].color).toBe('#937133'); // وما بعده باقٍ
    expect(out).not.toContain('|}'); // لا علامة فارغة
    expect(renderInline(out, true)).not.toContain('{c:');
  });

  it('تظليل كلمةٍ في وسط فقرةٍ ملوّنة', () => {
    const src = '{c:#937133|السلام عليكم ورحمة}';
    const out = recolor(src, 7, 12, '{h:#F3EADD|');
    expect(P(out).clean).toBe('السلام عليكم ورحمة');
    expect(P(out).styles[7].bg).toBe('#F3EADD');
    expect(P(out).styles[0].color).toBe('#937133');
    expect(P(out).styles[13].color).toBe('#937133');
    expect(renderInline(out, true)).not.toContain('{c:');
  });

  it('تظليل آخر كلمةٍ منها', () => {
    const src = '{c:#937133|السلام عليكم ورحمة}';
    const out = recolor(src, 13, 18, '{h:#F3EADD|');
    expect(P(out).clean).toBe('السلام عليكم ورحمة');
    expect(P(out).styles[13].bg).toBe('#F3EADD');
    expect(P(out).styles[0].color).toBe('#937133');
    expect(renderInline(out, true)).not.toContain('{c:');
  });

  it('تلوين الفقرة كلِّها يستبدل اللون ولا يعشّشه', () => {
    const src = '{c:#937133|السلام عليكم}';
    const out = recolor(src, 0, 13, '{c:#006EA4|');
    expect(out).toBe('{c:#006EA4|السلام عليكم}');
  });

  it('لا يمسّ فقرةً ملوّنةً أخرى في السطر التالي', () => {
    const src = '{c:#937133|السلام عليكم}\n{c:#006EA4|كيف الحال} جميعاً';
    const out = recolor(src, 0, 6, '{h:#F3EADD|');
    expect(out).toContain('{c:#006EA4|كيف الحال} جميعاً');
    expect(P(out).clean).toBe('السلام عليكم\nكيف الحال جميعاً');
  });
});

describe('إعادة المدى إلى الافتراضي', () => {
  const clear = (src: string, a: number, b: number) => clearColorIn(src, P(src), a, b);

  it('تُزال عن الكلمة كلّها', () => {
    expect(clear('{c:#937133|ملوّن}', 0, 5)).toBe('ملوّن');
  });

  it('تُزال عن جزءٍ فيبقى الباقي ملوّناً', () => {
    const out = clear('{c:#937133|أب جد}', 0, 2);
    expect(out).toBe('أب{c:#937133| جد}');
    expect(P(out).clean).toBe('أب جد');
  });

  it('لا تمسّ علامةً خارج المدى', () => {
    const src = '{c:#111111|أ} و{c:#222222|ب}';
    const out = clear(src, 0, 1);
    expect(out).toContain('{c:#222222|ب}');
    expect(out).not.toContain('{c:#111111|');
  });

  it('لا تُفقد الروابط ولا الغامق', () => {
    const src = '{c:#937133|[رابط](https://naf.sa) و**قوي**}';
    const out = clear(src, 0, 40);
    expect(out).toContain('[رابط](https://naf.sa)');
    expect(out).toContain('**قوي**');
    expect(out).not.toContain('{c:');
  });

  it('مدىً يشقّ كلمةً غامقة يُزيل اللون عن المتن كلّه بدل كسر العلامة', () => {
    const src = '{c:#937133|**قوي**}';
    const out = clear(src, 0, 2);
    expect(out).toBe('**قوي**');
    // لا علامة مكسورة تصل القارئ
    expect(renderInline(out, true)).toContain('<strong>قوي</strong>');
  });

  it('التظليل يُزال كما يُزال اللون', () => {
    expect(clear('{h:#EFEAE2|مظلّل}', 0, 5)).toBe('مظلّل');
  });

  /* «الافتراضي» خيارٌ في كل قائمة لون على حدة — naf-terms.md §١٤ —
     فقائمة اللون تعيد اللون وحده وقائمة التظليل التظليلَ وحده. */
  it('«الافتراضي» في قائمة اللون لا يمسّ التظليل', () => {
    const src = '{c:#937133|ملوّن} و{h:#EFEAE2|مظلّل}';
    const out = clearColorIn(src, P(src), 0, 12, 'c');
    expect(out).toContain('{h:#EFEAE2|مظلّل}');
    expect(out).not.toContain('{c:');
  });

  it('«الافتراضي» في قائمة التظليل لا يمسّ اللون', () => {
    const src = '{c:#937133|ملوّن} و{h:#EFEAE2|مظلّل}';
    const out = clearColorIn(src, P(src), 0, 12, 'h');
    expect(out).toContain('{c:#937133|ملوّن}');
    expect(out).not.toContain('{h:');
  });

  /* العلامات لا تتداخل في المخزَّن — المصيّر يرفض القوس في المتن —
     فكلمةٌ مظلّلة داخل فقرةٍ ملوّنة تأتي مسطّحةً في ثلاث علامات. */
  it('يُزيل التظليل عن كلمةٍ داخل فقرةٍ ملوّنة ويبقي لونها', () => {
    const flat = '{c:#937133|قبل }{h:#EFEAE2|وسط}{c:#937133| بعد}';
    const out = clearColorIn(flat, P(flat), 4, 7, 'h');
    expect(P(out).clean).toBe(P(flat).clean);
    expect(P(out).styles[4].bg).toBeUndefined();
    expect(P(out).styles[0].color).toBe('#937133');
  });
});
