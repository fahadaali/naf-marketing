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
import { basecampRoutes } from './routes/basecamp';
import { commentRoutes } from './routes/comments';
import { notificationRoutes } from './routes/notifications';
import { templateRoutes } from './routes/templates';
import { searchRoutes } from './routes/search';
import { auditRoutes } from './routes/audit';
import { handleScheduled } from './cron';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

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
api.route('/basecamp', basecampRoutes);
api.route('/comments', commentRoutes);
api.route('/notifications', notificationRoutes);
api.route('/templates', templateRoutes);
api.route('/search', searchRoutes);
api.route('/audit', auditRoutes);

api.get('/health', (c) => c.json({ ok: true, app: c.env.APP_NAME || 'naf-marketing' }));

app.route('/api', api);

// كل ما عدا /api يُخدَم من أصول React (SPA). not_found_handling = single-page-application
app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(handleScheduled(event, env));
  },
};
