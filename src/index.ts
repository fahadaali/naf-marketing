import { Hono } from 'hono';
import type { Env, Variables } from './types';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { permissionRoutes } from './routes/permissions';
import { settingsRoutes } from './routes/settings';
import { postRoutes } from './routes/posts';
import { campaignRoutes } from './routes/campaigns';
import { scheduleRoutes } from './routes/schedules';
import { mediaRoutes } from './routes/media';
import { rssRoutes } from './routes/rss';
import { analyticsRoutes } from './routes/analytics';
import { metricsRoutes } from './routes/metrics';
import { integrationRoutes } from './routes/integrations';
import { basecampRoutes } from './routes/basecamp';
import { commentRoutes } from './routes/comments';
import { notificationRoutes } from './routes/notifications';
import { templateRoutes } from './routes/templates';
import { searchRoutes } from './routes/search';
import { auditRoutes } from './routes/audit';
import { bufferRoutes } from './routes/buffer';
import { socialApiRoutes } from './routes/socialapi';
import { webhookRoutes } from './routes/webhooks';
import { newsletterRoutes } from './routes/newsletters';
import { subscriberRoutes } from './routes/subscribers';
import { publicRoutes } from './routes/publicPages';
import { siteApiRoutes } from './routes/siteApi';
import { siteMediaRoutes } from './routes/siteMedia';
import { emailTrackRoutes } from './routes/emailTracking';
import { handleScheduled } from './cron';
import { ssoGuard, ssoRoutes } from './sso';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// الدخول الموحّد — يسبق كل شيء.
// الحارس يمنع افتراضياً، والمستثنى مكتوب صراحةً في src/sso.ts وحده،
// فأي مسار يُضاف بعد اليوم محمي دون أن يتذكّر أحد حمايته.
app.route('/', ssoRoutes);
app.use('*', ssoGuard);

const api = new Hono<{ Bindings: Env; Variables: Variables }>();
api.route('/auth', authRoutes);
api.route('/users', userRoutes);
api.route('/permissions', permissionRoutes);
api.route('/settings', settingsRoutes);
api.route('/posts', postRoutes);
api.route('/campaigns', campaignRoutes);
api.route('/schedules', scheduleRoutes);
api.route('/media', mediaRoutes);
api.route('/rss', rssRoutes);
api.route('/analytics', analyticsRoutes);
api.route('/metrics', metricsRoutes);
api.route('/integrations', integrationRoutes);
api.route('/basecamp', basecampRoutes);
api.route('/comments', commentRoutes);
api.route('/notifications', notificationRoutes);
api.route('/templates', templateRoutes);
api.route('/search', searchRoutes);
api.route('/audit', auditRoutes);
api.route('/buffer', bufferRoutes);
api.route('/socialapi', socialApiRoutes);
api.route('/webhooks', webhookRoutes);
api.route('/newsletters', newsletterRoutes);
api.route('/subscribers', subscriberRoutes);

/*
 * الموقع الرئيسي. المسار `/api/public` لا اسمٌ من عندنا: الموقع يناديه
 * بهذا الاسم في `lib/newsletter/client.ts` وهو منشورٌ يعمل، فالعقد يُوفَّى
 * لا يُعاد التفاوض عليه.
 */
api.route('/public', siteApiRoutes);

// وسائط المحتوى المنشور: خارج الحارس، لأن جالبها متصفّحٌ وزاحفٌ لا جلسة
api.route('/public-media', siteMediaRoutes);

api.get('/health', (c) => c.json({ ok: true, app: c.env.APP_NAME || 'naf-marketing' }));

/* ═══ آخر ما تحت `/api` — وبدونه يُقرأ كل عطلٍ نجاحاً ═══

   ما لا يطابق مساراً هنا كان يسقط إلى `app.all('*')` أدناه فتُخدَم منه
   صفحة الواجهة **بحالة ٢٠٠**. ثم يسقط `JSON.parse` في `web/src/api.ts`
   فتصير البيانات `{}`، و`res.ok` صحيحة، فلا يُرمى خطأ — فيقرأ المستدعي
   ردّاً فارغاً ناجحاً على مسارٍ لا وجود له.

   ووقع فعلاً: زرّ «مستخدم جديد» كان ينادي `POST /api/users` بعد حذف
   المسار، فتُغلق النافذة كأنّ العضو أُنشئ ولا يُنشأ أحد ولا رسالة.

   وهذا يحرس كل مسارٍ يُعاد تسميته بعد اليوم: يصل ٤٠٤ بجسم JSON عربي،
   ويرميه `request` خطأً تراه الشاشة، بدل صمتٍ يُقرأ نجاحاً. */
api.all('*', (c) => c.json({ error: 'مسار غير معروف' }, 404));

app.route('/api', api);

// الصفحات العامة (مقالات/اشتراك/إلغاء) — تُسجَّل قبل خدمة الواجهة كي تُخدَّم من الخادم.
// المسار قابل للتغيير لاحقاً بربط النطاق دون تعديل الكود.
app.route('/articles', publicRoutes);

// تتبّع البريد (بكسل الفتح وتحويل النقر) — عام، يفتحه عميل البريد
app.route('/e', emailTrackRoutes);

// كل ما عدا /api يُخدَم من أصول React (SPA). not_found_handling = single-page-application
app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  // ننتظر المهام فعلياً بدل ctx.waitUntil: عمر استدعاء Cron هو عمر هذا الوعد،
  // وتركه معلّقاً يعرّض المهام للإلغاء قبل اكتمالها (نشر/إرسال/مزامنة).
  scheduled: async (event: ScheduledController, env: Env, _ctx: ExecutionContext) => {
    await handleScheduled(event, env);
  },
};
