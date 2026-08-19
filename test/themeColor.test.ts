// وسما `theme-color` والمانيفست — قيمٌ حرفية مشتقّة من الثيم لا مختارة.
//
// ‏CLAUDE.md §١ يعدّهما الاستثناء الرابع: الوسم لا يحلّ `var()` فيه
// متصفّحٌ واحد، فتُكتب القيمة حرفياً. ولأنها حرفية تُنسى عند تغيّر الثيم،
// فيُحسب هنا ما كان يجب أن تكون عليه ويُقارن.
//
// وكانا غائبين تماماً حين دُقّق المشروع — و`docs/naf-pwa.md` يقول حرفياً
// «بعد وسمَي theme-color القائمين»، أي أن الوثيقة تفترض وجودهما.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/* من oklch إلى sRGB — منقول من `scripts/build-app-icons.mjs`.
   المسار: oklch → OKLab → LMS → sRGB خطّي → sRGB بتصحيح جاما. */
function oklchToHex(lightness: number, chroma: number, hueDegrees: number): string {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];

  const channels = linear.map((v) => {
    const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(Math.max(srgb, 0), 1) * 255)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

/** الفاتحة أوّلاً (تعريف `:root`) ثم الداكنة (كتلة الوضع الداكن). */
function backgrounds(): { light: string; dark: string } {
  const css = readFileSync(join(ROOT, 'web', 'src', 'naf-theme.css'), 'utf8');
  const all = [...css.matchAll(/--background:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g)];
  expect(all.length, 'يجب أن يعرّف الثيم خلفيةً لكل وضع').toBeGreaterThanOrEqual(2);
  const hex = (m: RegExpMatchArray) => oklchToHex(Number(m[1]), Number(m[2]), Number(m[3]));
  return { light: hex(all[0]), dark: hex(all[1]) };
}

describe('لون الشريط ولون الإقلاع', () => {
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'web', 'public', 'manifest.webmanifest'), 'utf8'),
  );

  it('وسمان لا واحد — واحد لكل وضع', () => {
    const tags = [...html.matchAll(/<meta\s+name="theme-color"[^>]*>/g)].map((m) => m[0]);
    expect(tags.length, 'بلا استعلام الوسائط يبقى الشريط فاتحاً حول صفحةٍ داكنة').toBe(2);
    expect(tags.some((t) => t.includes('prefers-color-scheme: light'))).toBe(true);
    expect(tags.some((t) => t.includes('prefers-color-scheme: dark'))).toBe(true);
  });

  it('قيمتاهما هما --background في الوضعين بعد التحويل', () => {
    const { light, dark } = backgrounds();
    const read = (scheme: string) =>
      new RegExp(`<meta\\s+name="theme-color"\\s+content="([^"]+)"\\s+media="\\(prefers-color-scheme: ${scheme}\\)"`)
        .exec(html)?.[1]
        ?.toLowerCase();

    expect(read('light')).toBe(light);
    expect(read('dark')).toBe(dark);
  });

  it('المانيفست يقلع على الفاتحة — لا يقبل استعلام وسائط، فلونٌ واحد', () => {
    const { light } = backgrounds();
    expect(String(manifest.background_color).toLowerCase()).toBe(light);
    expect(String(manifest.theme_color).toLowerCase()).toBe(light);
  });
});
