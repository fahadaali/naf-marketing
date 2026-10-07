// مدقّقات خطة المحتوى في الخادم — الشكل ونوعه، واليوم، والمنصات، والنصوص.

import { describe, it, expect } from 'vitest';
import {
  FORMAT_TYPE, isFormat, resolveFormat, isYmd, cleanDay, cleanPlatforms, cleanText, isIdeaRow,
} from '../src/services/planning';

describe('FORMAT_TYPE', () => {
  it('لكل شكلٍ نوعٌ من الثلاثة — فلا تتغيّر المؤشرات التي تجمع بالنوع', () => {
    for (const [format, type] of Object.entries(FORMAT_TYPE)) {
      expect(['text', 'image', 'video'], format).toContain(type);
    }
  });

  it('الأنواع الثلاثة أشكالٌ بأنفسها — عليها تُملأ الصفوف القائمة في 0033', () => {
    for (const t of ['text', 'image', 'video'] as const) expect(FORMAT_TYPE[t]).toBe(t);
  });

  it('isFormat لا تقبل خصائص الكائن الموروثة', () => {
    expect(isFormat('carousel')).toBe(true);
    expect(isFormat('toString')).toBe(false);
    expect(isFormat(undefined)).toBe(false);
  });
});

describe('resolveFormat', () => {
  it('الشكل يقرّر النوع', () => {
    expect(resolveFormat({ format: 'carousel' })).toEqual({ format: 'carousel', content_type: 'image' });
    expect(resolveFormat({ format: 'article', content_type: 'video' })).toEqual({ format: 'article', content_type: 'text' });
  });

  it('النوع وحده يُبقي الشكل الحاليّ إن وافقه', () => {
    expect(resolveFormat({ content_type: 'image' }, 'carousel')).toEqual({ format: 'carousel', content_type: 'image' });
  });

  it('والنوع المخالف للشكل الحاليّ يعيده إلى شكله الأساسيّ', () => {
    expect(resolveFormat({ content_type: 'video' }, 'carousel')).toEqual({ format: 'video', content_type: 'video' });
  });

  it('غير الصالح لا يمسّ شيئاً', () => {
    expect(resolveFormat({ format: 'reel', content_type: 'gif' }, 'story')).toBeNull();
    expect(resolveFormat({})).toBeNull();
  });
});

describe('اليوم المستهدف', () => {
  it('isYmd تقبل يوماً صحيحاً وترفض ما يُطوى', () => {
    expect(isYmd('2026-10-31')).toBe(true);
    expect(isYmd('2028-02-29')).toBe(true);
    expect(isYmd('2026-02-30')).toBe(false);
    expect(isYmd('2026-13-01')).toBe(false);
    expect(isYmd('2026/10/31')).toBe(false);
    expect(isYmd('2026-10-31T09:00')).toBe(false);
  });

  it('cleanDay: الفارغ يمسح، وغير الصالح يُهمل', () => {
    expect(cleanDay('2026-11-02')).toBe('2026-11-02');
    expect(cleanDay(null)).toBeNull();
    expect(cleanDay('')).toBeNull();
    expect(cleanDay('غداً')).toBeUndefined();
    expect(cleanDay(20261102)).toBeUndefined();
  });
});

describe('cleanPlatforms', () => {
  it('مفاتيح بلا تكرار، JSON', () => {
    expect(cleanPlatforms(['linkedin', 'x', 'linkedin'])).toBe('["linkedin","x"]');
  });

  it('ما ليس مفتاحاً يُسقط، والقائمة الفارغة تمسح', () => {
    expect(cleanPlatforms(['LinkedIn', '', 'x y', 7])).toBeNull();
    expect(cleanPlatforms([])).toBeNull();
    expect(cleanPlatforms(null)).toBeNull();
  });

  it('غير المصفوفة تُهمل', () => {
    expect(cleanPlatforms('linkedin')).toBeUndefined();
    expect(cleanPlatforms(undefined)).toBeUndefined();
  });
});

describe('cleanText', () => {
  it('يُشذَّب ويُقصّ إلى حدّه، والفارغ يمسح', () => {
    expect(cleanText('  توعية قانونية  ', 80)).toBe('توعية قانونية');
    expect(cleanText('أ'.repeat(90), 80)).toHaveLength(80);
    expect(cleanText('   ', 80)).toBeNull();
    expect(cleanText(null, 80)).toBeNull();
    expect(cleanText(5, 80)).toBeUndefined();
  });
});

describe('isIdeaRow', () => {
  it('«فكرة» مسودةٌ بلا نصّ، وما عداها ليس فكرة', () => {
    expect(isIdeaRow({ status: 'draft', body: '' })).toBe(true);
    expect(isIdeaRow({ status: 'draft', body: null })).toBe(true);
    expect(isIdeaRow({ status: 'draft', body: '<p>نص</p>' })).toBe(false);
    expect(isIdeaRow({ status: 'rejected', body: '' })).toBe(false);
  });
});
