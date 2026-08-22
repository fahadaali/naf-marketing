/* الدوالّ الخالصة في مفردات الحملة.

   `parsePlatforms` حارسٌ وُضع لعيبٍ وقع فعلاً: الصفحة القديمة كانت تنادي
   `JSON.parse` على عمود المنصات مرّتين داخل التصيير بلا حارس، فصفٌّ واحد
   مشوَّه يُبيّض الشاشة كلها. وهذا الاختبار يمنع عودته.

   وسابقةُ استيراد `web/` من هنا قائمة في markSource وmarkHighlight. */

import { describe, it, expect } from 'vitest';
import {
  CAMPAIGN_STATUSES, CAMPAIGN_STATUS_BADGE, CAMPAIGN_STATUS_LABELS,
  daysRemaining, parsePlatforms,
} from '../web/src/campaigns';

describe('parsePlatforms', () => {
  it('يقرأ المصفوفة السليمة', () => {
    expect(parsePlatforms('["linkedin","x"]')).toEqual(['linkedin', 'x']);
  });

  it('لا يرمي على JSON مشوّه — يعود فارغاً', () => {
    expect(parsePlatforms('THIS IS NOT JSON')).toEqual([]);
    expect(parsePlatforms('{')).toEqual([]);
    expect(parsePlatforms('[1,2')).toEqual([]);
  });

  it('الفراغ والغياب فارغان لا رمي', () => {
    expect(parsePlatforms(null)).toEqual([]);
    expect(parsePlatforms(undefined)).toEqual([]);
    expect(parsePlatforms('')).toEqual([]);
  });

  it('ما ليس مصفوفةً يعود فارغاً', () => {
    expect(parsePlatforms('{"a":1}')).toEqual([]);
    expect(parsePlatforms('"linkedin"')).toEqual([]);
    expect(parsePlatforms('42')).toEqual([]);
  });

  it('يُسقط العناصر غير النصّية ولا يمرّرها إلى المكوّن', () => {
    expect(parsePlatforms('["linkedin",null,7,{"a":1},"x"]')).toEqual(['linkedin', 'x']);
  });
});

describe('daysRemaining', () => {
  const now = new Date('2026-08-22T12:00:00Z');

  /* اليوم الجاري يُعدّ يوماً باقياً: من ظهر الثاني والعشرين إلى آخر
     الخامس والعشرين أربعةٌ — ثلاثةٌ كاملة وما بقي من اليوم. */
  it('يعدّ ما بقي من المدّة ويحسب اليوم الجاري', () => {
    expect(daysRemaining('2026-08-25', now)).toBe(4);
    expect(daysRemaining('2026-08-23', now)).toBe(2);
  });

  it('حملةٌ تنتهي اليوم تُقرأ «يوم» لا «صفر»', () => {
    expect(daysRemaining('2026-08-22', now)).toBe(1);
  });

  it('يعود سالباً لمدّةٍ انقضت — والشاشة تقرؤها «انتهت المدة»', () => {
    expect(daysRemaining('2026-08-20', now)).toBeLessThan(0);
  });

  /* لا صفر ولا سالب لحملةٍ بلا نهاية: `null` تعني «لا سطر يُعرض».
     وصفرٌ في خانة المتبقّي يُقرأ «تنتهي اليوم» وهو معنًى آخر. */
  it('بلا تاريخ انتهاء يعود null لا صفراً', () => {
    expect(daysRemaining(null, now)).toBeNull();
    expect(daysRemaining(undefined, now)).toBeNull();
    expect(daysRemaining('', now)).toBeNull();
  });

  it('تاريخٌ غير صالح يعود null لا NaN', () => {
    expect(daysRemaining('ليس تاريخاً', now)).toBeNull();
  });
});

describe('مفردات الحالة', () => {
  it('الحالات الأربع لا خامسة، بترتيب مسار الحملة', () => {
    expect(CAMPAIGN_STATUSES).toEqual(['planned', 'active', 'completed', 'archived']);
  });

  it('لكل حالةٍ تسميةٌ ورمز شارة', () => {
    for (const s of CAMPAIGN_STATUSES) {
      expect(CAMPAIGN_STATUS_LABELS[s], s).toBeTruthy();
      expect(CAMPAIGN_STATUS_BADGE[s], s).toBeTruthy();
    }
  });

  /* «مكتملة» blue لا green: الاكتمال انقضاءُ مدّةٍ لا حكمٌ بالنجاح،
     والحكم يقوله «ضمن المستهدف» في شريط الأداء وحده. */
  it('«مكتملة» لا تأخذ لون النجاح', () => {
    expect(CAMPAIGN_STATUS_BADGE.completed).toBe('blue');
    expect(CAMPAIGN_STATUS_BADGE.active).toBe('green');
  });

  it('التسميات مؤنّثة كما سُجّلت — الموصوف مؤنّث', () => {
    expect(CAMPAIGN_STATUS_LABELS.archived).toBe('مؤرشفة');
    expect(CAMPAIGN_STATUS_LABELS.active).toBe('نشطة');
  });
});
