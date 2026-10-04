// أرقام الإدخال — الوقت يُكتب بالهندية أو الغربية ويُعتمد بالغربية.

import { describe, it, expect } from 'vitest';
import { toLatinDigits, parseTime24 } from '../web/src/lib/digits';

describe('toLatinDigits', () => {
  it('يحوّل الهندية والفارسية إلى الغربية ويُبقي ما عداها', () => {
    expect(toLatinDigits('١٤:٣٠')).toBe('14:30');
    expect(toLatinDigits('۱۴:۳۰')).toBe('14:30');
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toLatinDigits('14:30')).toBe('14:30');
    expect(toLatinDigits('الساعة ٩')).toBe('الساعة 9');
    expect(toLatinDigits('')).toBe('');
  });
});

describe('parseTime24', () => {
  it('يقبل الوقت بالرقمين وبأيّ فاصل', () => {
    expect(parseTime24('١٤:٣٠')).toBe('14:30');
    expect(parseTime24('14:30')).toBe('14:30');
    expect(parseTime24('٩:٥')).toBe('09:05');
    expect(parseTime24('٩٫٣٠')).toBe('09:30');
    expect(parseTime24('9.30')).toBe('09:30');
    expect(parseTime24('١٤٣٠')).toBe('14:30');
    expect(parseTime24('930')).toBe('09:30');
    expect(parseTime24('٩')).toBe('09:00');
    expect(parseTime24(' 0:00 ')).toBe('00:00');
    expect(parseTime24('23:59')).toBe('23:59');
  });

  it('يرفض ما ليس وقتاً بنظام ٢٤ ساعة', () => {
    expect(parseTime24('٢٤:٠٠')).toBeNull();
    expect(parseTime24('12:60')).toBeNull();
    expect(parseTime24('2:30 م')).toBeNull();
    expect(parseTime24('')).toBeNull();
    expect(parseTime24('١٢٣٤٥')).toBeNull();
  });
});
