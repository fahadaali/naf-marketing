import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { getUserFromRequest } from '../auth';
import { permissionMap } from '../permissions';

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/* ═══ لا دخول محلياً في هذه المنصة ═══

   المصادقة كلها في المركز: الباب `‎/go/naf-marketing` هناك، والاستقبال
   `‎/auth/callback` هنا، والخروج `‎/auth/logout` قبل الحارس.

   وما كان في هذا الملف — `‎/login` بكلمة مرور، و`‎/setup` للتهيئة الأولى،
   و`‎/setup-status` الذي يقول أثمّة مستخدمون — كان **طريق دخول ثانياً**
   لا يمرّ بالمركز. الحارس يحمي `‎/api/` فلم يكن الباب مفتوحاً اليوم،
   لكنه كان بابًا كاملاً خلفه: كلمةُ مرور تُقبل، وجلسةٌ تُكتب في جدول
   `sessions` المحلي، وقارئُ المستخدم يقبلها. فيكفي أن يُضاف `‎/api/auth/`
   إلى المسارات العامة يوماً، أو يُنقل المسار خارج البادئة، ليصير الدخول
   ممكناً بلا مرور بالمركز.

   والإيقاف هو بيت القصيد: الرمز يعيش خمس عشرة دقيقة كي يسري الإيقاف
   المركزي خلال ربع ساعة، وجلسةٌ محلية عمرها أربعة عشر يوماً تُبطل ذلك
   كلَّه — يبقى الموقوف مركزياً داخلاً أسبوعين. فأُغلق الباب من أصله.

   والتهيئة الأولى لم تعد تحتاجه: أوّل داخلٍ من المركز يُنشأ سجلّه بالدور
   الافتراضي `writer`، ثم يُرفَع مسؤولاً من القاعدة مرة واحدة —
   `UPDATE users SET role_name='general_manager' WHERE email='…'` */

// المستخدم الحالي + صلاحياته (لتكييف الواجهة — التحقق الفعلي يبقى على الخادم)
authRoutes.get('/me', async (c) => {
  const user = await getUserFromRequest(c.env, c.req.raw);
  if (!user) return c.json({ user: null });
  const permissions = await permissionMap(c.env, user.role_name);
  return c.json({ user, permissions });
});
