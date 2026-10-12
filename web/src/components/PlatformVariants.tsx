// «نسخة كل منصة» — النص المخصّص وأول تعليق، ومعاينة ما سيصل كل منصة من
// الوسائط، ورفع بديلٍ لمنصةٍ بعينها.
//
// المعاينة صورة الخادم نفسها (`/api/media/:id/adapted`) لا تقليدٌ لها في
// CSS: ما يُرى هنا هو ما يُنشر. والبطاقة مطويّة ما دام كل شيء يصل كما هو،
// وتنفتح وحدها مرّةً حين تُكيَّف صورةٌ لمنصة أو تحتاج تيك توك مقطعاً — فلا
// يُفاجأ أحدٌ بعد النشر، ولا تزيد الخطوات على من لا يحتاجها.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from '../api';
import { PlatformIcon, platformLabel } from '../platforms';
import { uploadMedia } from '../mediaUpload';
import PlatformOptions, { HAS_OPTIONS, type PlatformOptionsValue } from './PlatformOptions';
import { formatNumber, isolate } from '../lib/format';
import {
  bodyMediaIds, platformMedia, needsAttention, ratioLabel, videoMode,
  type AssetInfo, type MediaSpecs, type Variant,
} from '../mediaPlan';

export type VariantRow = Variant & { body_override?: string | null; first_comment?: string | null; options_json?: string | null };

let specsPromise: Promise<MediaSpecs | null> | null = null;
/** المواصفات لا تتغيّر في الجلسة — تُطلب مرّةً. وتعذّرها يُخفي الشارات ولا يمنع شيئاً. */
export function loadMediaSpecs(): Promise<MediaSpecs | null> {
  specsPromise ??= api.get<MediaSpecs>('/media/specs').catch(() => {
    specsPromise = null;
    return null;
  });
  return specsPromise;
}

/** بيانات الوسائط (النوع والأبعاد) — تُجمع في خريطةٍ واحدة ويُطلب الناقص منها. */
export function useAssetInfo(ids: string[]): Record<string, AssetInfo> {
  const [assets, setAssets] = useState<Record<string, AssetInfo>>({});
  const key = ids.join(',');
  useEffect(() => {
    const missing = ids.filter((id) => !assets[id]);
    if (!missing.length) return;
    const t = window.setTimeout(() => {
      api
        .get<{ media: AssetInfo[] }>(`/media/info?ids=${encodeURIComponent(missing.join(','))}`)
        .then((d) => setAssets((prev) => ({ ...prev, ...Object.fromEntries((d.media || []).map((m) => [m.id, m])) })))
        .catch(() => { /* بلا بيانات تُعرض الوسائط بلا شارات */ });
    }, 300);
    return () => window.clearTimeout(t);
  }, [key]);
  return assets;
}

type Props = {
  postId: string;
  platforms: string[];
  platLabels: Record<string, string>;
  /** متن المحرر الحالي — بما لم يُحفظ بعد، فالمعاينة تتبع ما يُكتب. */
  body: string;
  variants: VariantRow[];
  open: boolean;
  onToggle: (open: boolean) => void;
  onError: (m: string) => void;
  onMsg: (m: string) => void;
};

export default function PlatformVariants({
  postId, platforms, platLabels, body, variants, open, onToggle, onError, onMsg,
}: Props) {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Record<string, PlatformOptionsValue>>({});
  const [rows, setRows] = useState<Record<string, VariantRow>>({});
  const [saving, setSaving] = useState('');
  const [specs, setSpecs] = useState<MediaSpecs | null>(null);
  const [lengths, setLengths] = useState<Record<string, { length: number; max: number; valid: boolean }>>({});
  const autoOpened = useRef(false);
  // حقل ملفٍ واحد للمنصات كلها — الزرّ يُركَّز بلوحة المفاتيح، والحقل مخفيّ
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef('');

  useEffect(() => {
    loadMediaSpecs().then(setSpecs);
  }, []);

  useEffect(() => {
    const t: Record<string, string> = {};
    const c: Record<string, string> = {};
    const o: Record<string, PlatformOptionsValue> = {};
    const r: Record<string, VariantRow> = {};
    for (const v of variants) {
      if (v.body_override) t[v.platform] = v.body_override;
      if (v.first_comment) c[v.platform] = v.first_comment;
      if (v.options_json) {
        try { o[v.platform] = JSON.parse(v.options_json); } catch { /* بلا خيارات */ }
      }
      r[v.platform] = v;
    }
    setTexts(t);
    setComments(c);
    setOptions(o);
    setRows(r);
  }, [variants]);

  /* طول النص لكل منصة كما تعدّه هي (Ayrshare: الرابط في إكس ٢٣ حرفاً، والرمز
     التعبيري حرفان). يُسأل والبطاقة مفتوحة وحدها، بعد أن يهدأ الكتابة —
     فطلبات المزوّد حصّةٌ يشترك فيها السحب والنشر. وتعذّره يُخفي العدّاد. */
  const lengthKey = JSON.stringify([open, body, texts, platforms]);
  useEffect(() => {
    if (!open || !platforms.length) return;
    const t = window.setTimeout(() => {
      api
        .post<{ lengths: Record<string, { length: number; max: number; valid: boolean }> }>(
          '/ayrshare/post-length', { body, overrides: texts, platforms },
        )
        .then((d) => setLengths(d.lengths || {}))
        .catch(() => setLengths({}));
    }, 1200);
    return () => window.clearTimeout(t);
  }, [lengthKey]);

  const bodyIds = useMemo(() => bodyMediaIds(body), [body]);
  const allIds = useMemo(() => {
    const ids = new Set(bodyIds);
    for (const v of Object.values(rows)) {
      if (v.media_asset_id) ids.add(v.media_asset_id);
      if (v.generated_media_id) ids.add(v.generated_media_id);
    }
    return [...ids];
  }, [bodyIds, rows]);
  const fetched = useAssetInfo(allIds);
  const [uploaded, setUploaded] = useState<Record<string, AssetInfo>>({});
  const assets = useMemo(() => ({ ...fetched, ...uploaded }), [fetched, uploaded]);

  /* ═══ وصف الوسائط ═══
     النص البديل ووسم الذكاء الاصطناعي صفةٌ للوسيط لا للمنصة: يُكتب مرّةً هنا
     ويُرسل مع الصورة إلى كل منصةٍ تقبله. والمقطع المصنوع من صورةٍ لتيك توك
     لا يُوصف وحده — يتبع صورته. */
  const describable = useMemo(() => {
    const ids = new Set(bodyIds);
    for (const v of Object.values(rows)) if (v.media_asset_id) ids.add(v.media_asset_id);
    return [...ids].filter((id) => /^(image|video)\//.test(assets[id]?.mime_type || ''));
  }, [bodyIds, rows, assets]);
  const [alts, setAlts] = useState<Record<string, string>>({});

  async function describe(id: string, patch: { alt_text?: string; ai_generated?: boolean }) {
    onError('');
    try {
      await api.patch(`/media/${id}/describe`, patch);
      setUploaded((prev) => ({
        ...prev,
        [id]: {
          ...assets[id],
          ...('alt_text' in patch ? { alt_text: patch.alt_text?.trim() || null } : {}),
          ...('ai_generated' in patch ? { ai_generated: patch.ai_generated ? 1 : 0 } : {}),
        },
      }));
      onMsg('تم الحفظ');
    } catch (e: any) {
      onError(e.message);
    }
  }

  const plans = useMemo(
    () => Object.fromEntries(platforms.map((p) => [p, platformMedia(specs, p, bodyIds, rows[p], assets)])),
    [platforms, specs, bodyIds, rows, assets],
  );
  const attention = platforms.filter((p) => needsAttention(plans[p]));

  // تنفتح مرّةً واحدة حين يظهر ما يحتاج نظرة — ولا تُفتح رغم من طواها بعدها
  useEffect(() => {
    if (!autoOpened.current && attention.length && !open) {
      autoOpened.current = true;
      onToggle(true);
    }
  }, [attention.length]);

  async function put(platform: string, patch: Partial<VariantRow>) {
    await api.put(`/posts/${postId}/variants/${platform}`, patch);
    setRows((prev) => ({ ...prev, [platform]: { ...(prev[platform] || { platform }), ...patch } }));
  }

  async function saveText(platform: string) {
    setSaving(platform);
    onError('');
    try {
      await put(platform, {
        body_override: texts[platform]?.trim() || null,
        first_comment: comments[platform]?.trim() || null,
        ...(HAS_OPTIONS.has(platform) ? { options: options[platform] || null } : {}),
      });
      onMsg('تم الحفظ');
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving('');
    }
  }

  async function replaceMedia(platform: string, file: File | undefined) {
    if (!file) return;
    setSaving(platform);
    onError('');
    try {
      const d = await uploadMedia<AssetInfo & { mime_type: string }>(file);
      setUploaded((prev) => ({ ...prev, [d.id]: d }));
      await put(platform, { media_asset_id: d.id });
      onMsg('تم الرفع');
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving('');
    }
  }

  async function resetMedia(platform: string) {
    setSaving(platform);
    onError('');
    try {
      await put(platform, { media_asset_id: null });
      onMsg('تم الحفظ');
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving('');
    }
  }

  const custom = Object.values(texts).filter((v) => v?.trim()).length
    + Object.values(rows).filter((v) => v.media_asset_id).length
    + Object.values(rows).filter((v) => v.options_json).length;

  return (
    <div className="card pv-card">
      <button type="button" className="row row-link" aria-expanded={open} onClick={() => onToggle(!open)}>
        <h4 className="pv-title">نسخة كل منصة</h4>
        <div className="spacer" />
        <span className="muted pv-count">
          {attention.length ? `${isolate(attention.length)} تحتاج نظرة · ` : ''}
          {custom || 'لا'} مخصّص · {open ? 'إخفاء' : 'عرض'}
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept="image/*,video/*"
        onChange={(e) => {
          replaceMedia(pickFor.current, e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {open && (
        <div className="pv-body">
          <p className="muted pv-hint">
            اترك النص فارغاً لاستخدام النص الأساسي. «أول تعليق» يُنشر تلقائياً بعد المنشور — مناسب للروابط والوسوم.
            والصورة التي لا تقبل المنصة أبعادها تُوضع في إطارٍ بمقاسها، كما في المعاينة.
          </p>
          {describable.length > 0 && (
            <div className="pv-desc">
              <h5 className="pv-desc-title">وصف الوسائط</h5>
              <p className="muted pv-hint">
                النص البديل يقرؤه قارئ الشاشة لمن لا يرى الصورة، ويُرسل إلى لينكدإن وفيسبوك وإنستغرام وإكس.
                والوسيط المولّد بالذكاء الاصطناعي يُعلَن عنه في المنصات التي تتيح ذلك.
              </p>
              {describable.map((id) => {
                const a = assets[id];
                const image = (a?.mime_type || '').startsWith('image/');
                const saved = a?.alt_text || '';
                const value = alts[id] ?? saved;
                return (
                  <div key={id} className="pv-desc-row">
                    {image
                      ? <img className="pv-desc-thumb" src={`/api/media/${id}`} alt={saved} loading="lazy" />
                      : <video className="pv-desc-thumb" src={`/api/media/${id}`} preload="metadata" muted playsInline />}
                    <div className="pv-desc-fields">
                      {image && (
                        <input
                          className="input"
                          maxLength={1000}
                          placeholder="النص البديل — صف ما في الصورة"
                          aria-label={`النص البديل لـ ${a?.filename || 'الصورة'}`}
                          value={value}
                          onChange={(e) => setAlts((v) => ({ ...v, [id]: e.target.value }))}
                          onBlur={() => { if (value.trim() !== saved) describe(id, { alt_text: value }); }}
                        />
                      )}
                      <label className="pv-desc-ai">
                        <input
                          type="checkbox"
                          className="chk"
                          checked={!!a?.ai_generated}
                          onChange={(e) => describe(id, { ai_generated: e.target.checked })}
                        />
                        مولّد بالذكاء الاصطناعي
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {platforms.map((p) => {
            const plan = plans[p];
            const busy = saving === p;
            return (
              <div key={p} className="pv-platform">
                <div className="row pv-head">
                  <PlatformIcon platform={p} size={16} />
                  <span className="pv-label">{platformLabel(p, platLabels)}</span>
                  <div className="spacer" />
                  <button
                    type="button"
                    className="btn sm ghost"
                    disabled={busy}
                    onClick={() => {
                      pickFor.current = p;
                      fileRef.current?.click();
                    }}
                  >
                    <Upload size={16} /> رفع بديل
                  </button>
                  {plan.source === 'variant' && (
                    <button type="button" className="btn sm ghost" disabled={busy} onClick={() => resetMedia(p)}>
                      إعادة الافتراضي
                    </button>
                  )}
                  <button type="button" className="btn sm ghost" disabled={busy} onClick={() => saveText(p)}>
                    {busy ? 'جارٍ الحفظ…' : 'حفظ'}
                  </button>
                </div>

                {plan.items.length > 0 && (
                  <div className="pv-media">
                    {plan.items.map((it) => {
                      const mime = it.asset?.mime_type || '';
                      const video = mime.startsWith('video/');
                      const mode = video ? videoMode(specs, p, it.asset) : null;
                      const src = it.frame
                        ? `/api/media/${it.id}/adapted?platform=${encodeURIComponent(p)}`
                        : `/api/media/${it.id}`;
                      return (
                        <figure key={it.id} className="pv-item">
                          {video ? (
                            <video className="pv-thumb" src={`/api/media/${it.id}`} preload="metadata" muted playsInline />
                          ) : mime.startsWith('image/') ? (
                            <img className="pv-thumb" src={src} alt={it.asset?.filename || ''} loading="lazy" />
                          ) : (
                            <div className="pv-thumb pv-file">{it.asset?.filename || ''}</div>
                          )}
                          <figcaption className="pv-badges">
                            {it.frame ? (
                              <span className="badge blue">مُكيّفة إلى <bdi>{ratioLabel(it.frame)}</bdi></span>
                            ) : mime.startsWith('image/') && it.asset?.width ? (
                              <span className="badge gray">كما هي</span>
                            ) : null}
                            {mode && <span className="badge blue">{mode}</span>}
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>
                )}
                {plan.needsVideo && (
                  <p className="pv-note">
                    {plan.videoReady
                      ? <span className="badge green">مقطع مولّد من الصورة</span>
                      : <span className="badge amber">يُجهَّز مقطعاً عند النشر</span>}
                    <span className="muted"> تيك توك لا يقبل منشوراً بصورةٍ واحدة، فتُنشر الصورة مقطعاً مدته <bdi>5</bdi> ثوانٍ.</span>
                  </p>
                )}

                <textarea
                  className="input"
                  rows={3}
                  placeholder="(يُستخدم النص الأساسي)"
                  value={texts[p] || ''}
                  onChange={(e) => setTexts((v) => ({ ...v, [p]: e.target.value }))}
                />
                {/* القصة بلا نصّ فلا طول لها، وسلسلة إكس تقسم ما طال */}
                {lengths[p] && !options[p]?.story && (() => {
                  const split = p === 'x' && !!options[p]?.thread;
                  const over = !lengths[p].valid && !split;
                  return (
                    <p className={`pv-length ${over ? 'err' : 'muted'}`}>
                      الطول <bdi>{formatNumber(lengths[p].length)} / {formatNumber(lengths[p].max)}</bdi>
                      {over && ` — أطول من حدّ ${platformLabel(p, platLabels)}`}
                      {split && !lengths[p].valid && ' — يُنشر سلسلة'}
                    </p>
                  );
                })()}
                <input
                  className="input pv-comment"
                  placeholder="أول تعليق (اختياري) — للروابط والوسوم"
                  value={comments[p] || ''}
                  onChange={(e) => setComments((v) => ({ ...v, [p]: e.target.value }))}
                />
                <PlatformOptions
                  key={`${p}:${rows[p]?.options_json || ''}`}
                  platform={p}
                  value={options[p] || {}}
                  onChange={(v) => setOptions((prev) => ({ ...prev, [p]: v }))}
                  onError={onError}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
