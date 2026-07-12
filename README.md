# منصة ناف للتسويق — NAF Law Marketing Management Platform

منصة ويب داخلية لإدارة الأعمال التسويقية لشركة ناف للاستشارات القانونية (الرياض): إنشاء المحتوى وتوليده، الحملات، الجدولة والنشر، التحليلات، ونظام أدوار وموافقات تسلسلي — بواجهة عربية RTL بالكامل على بنية Cloudflare.

## البنية التقنية

| الطبقة | التقنية |
|---|---|
| الواجهة | React + Vite (عربي RTL) — تُخدَم كأصول ثابتة من الـ Worker |
| الخادم/API | Cloudflare Workers + Hono |
| قاعدة البيانات | Cloudflare D1 (SQLite) |
| تخزين الوسائط | Cloudflare R2 |
| المصادقة | جلسات في D1 + تجزئة PBKDF2 (WebCrypto) |
| المهام المجدولة | Cloudflare Cron Triggers |
| المفاتيح السرية | Cloudflare Secrets (Claude، مزوّد النشر) — لا تصل المتصفح |

## المزايا

- **إنشاء المحتوى** من ثلاثة مصادر: يدوي، توليد بالذكاء الاصطناعي (Claude)، وتحويل خبر RSS إلى مسودة.
- **محرر نصوص غني** عربي RTL يوحّد المصادر الثلاثة، مع نسخ مخصّصة لكل منصة (variants).
- **دورة اعتماد تسلسلية**: مسودة ← مراجعة التسويق ← اعتماد المدير العام ← مجدول ← منشور، مع سجل موافقات كامل وإمكانية الرفض بسبب إلزامي.
- **الحملات** بعرضين: تقويمي ولوحة Kanban.
- **الجدولة والنشر التلقائي** عبر Cron بتوقيت الرياض (AST)، ومهام idempotent لا تُكرّر النشر.
- **طبقة نشر مجرّدة** محايدة للمزوّد (Mock/Ayrshare/Zernio/Late) خلف واجهة `PublishingProvider`.
- **داشبورد تحليلات موحّد** مع فلاتر (زمن، منصة، حملة) وحالة خط الإنتاج.
- **أدوار وصلاحيات** مخزّنة في قاعدة البيانات، يعدّلها المدير العام من الواجهة ويسري الأثر فوراً.

## الإعداد المحلي (macOS)

المتطلبات: Node.js 18+، حساب Cloudflare، Wrangler.

```bash
# 1) تثبيت الاعتماديات
npm install
npm --prefix web install

# 2) إنشاء موارد Cloudflare
npx wrangler d1 create naf_marketing        # انسخ database_id إلى wrangler.toml
npx wrangler r2 bucket create naf-marketing-media

# 3) تطبيق مخطط قاعدة البيانات محلياً
npm run db:migrate:local

# 4) المفاتيح السرية للتطوير
cp .dev.vars.example .dev.vars               # ثم عدّل القيم

# 5) التشغيل (الواجهة + الـ API معاً)
npm run dev
# الواجهة: http://localhost:5173  |  الـ API: http://localhost:8787
```

عند أول دخول: تُنشأ شاشة **التهيئة الأولى** لإنشاء حساب المدير العام.

## النشر على الإنتاج

```bash
# المفاتيح السرية عبر Secrets (لا تُخزَّن في الكود إطلاقاً)
npx wrangler secret put CLAUDE_API_KEY
npx wrangler secret put PROVIDER_API_KEY
npx wrangler secret put AUTH_SECRET

# تطبيق الهجرات على قاعدة الإنتاج
npm run db:migrate:remote

# بناء الواجهة ونشر الـ Worker (يخدم الواجهة والـ API والـ Cron)
npm run deploy
```

الربط بـ GitHub: عند ربط المستودع بـ Cloudflare، كل `push` إلى الفرع الرئيسي ينشر تلقائياً.

## المهام المجدولة (Cron)

| الجدول | المهمة |
|---|---|
| `*/5 * * * *` | نشر المحتوى المجدول المستحق (idempotent) |
| `17 * * * *` | جلب عناصر RSS الجديدة + سحب لقطات التحليلات |

## بنية المشروع

```
src/                 # خادم Workers (Hono)
  routes/            # نقاط API: auth, users, permissions, settings, posts, campaigns, schedules, media, rss, analytics
  services/          # claude, rss, publish, analytics, workflow
  adapters/          # طبقة النشر المجرّدة (provider interface + mock + ayrshare)
  cron.ts            # معالج المهام المجدولة
migrations/          # مخطط D1 + بذور الصلاحيات والإعدادات
web/                 # واجهة React (Vite) — عربي RTL
```

## الأمان

- كل المفاتيح عبر Cloudflare Secrets فقط، ولا تصل الواجهة إطلاقاً؛ كل نداءات Claude/المزوّد تمر عبر Workers.
- التحقق من الصلاحيات على الخادم لكل عملية حساسة (لا يُعتمد على إخفاء الأزرار).
- كلمات المرور مُجزّأة عبر PBKDF2‑SHA256.
- الإعدادات ترفض تخزين أي مفتاح سري.

## ملاحظات

- ألوان العلامة قيم افتراضية في `web/src/styles.css` (متغيّرات CSS) — استبدلها بألوان ناف النهائية.
- مزوّد النشر الافتراضي `mock` لتجربة كل التدفّق دون تكلفة؛ بدّله من الإعدادات عند تفعيل مزوّد حقيقي (تنبيه: Late لا يدعم Snapchat).
