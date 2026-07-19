import type { Env, Role } from './types';

// التحقق من الصلاحية على مستوى الخادم — القراءة من قاعدة البيانات (مصفوفة قابلة للتعديل)
export async function hasPermission(env: Env, role: Role, permissionKey: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT allowed FROM roles_permissions WHERE role_name = ? AND permission_key = ?',
  )
    .bind(role, permissionKey)
    .first<{ allowed: number }>();
  return !!row && row.allowed === 1;
}

export async function permissionMap(env: Env, role: Role): Promise<Record<string, boolean>> {
  const { results } = await env.DB.prepare(
    'SELECT permission_key, allowed FROM roles_permissions WHERE role_name = ?',
  )
    .bind(role)
    .all<{ permission_key: string; allowed: number }>();
  const map: Record<string, boolean> = {};
  for (const r of results) map[r.permission_key] = r.allowed === 1;
  return map;
}

export async function allPermissions(env: Env): Promise<
  { role_name: string; permission_key: string; allowed: number }[]
> {
  const { results } = await env.DB.prepare(
    'SELECT role_name, permission_key, allowed FROM roles_permissions ORDER BY permission_key, role_name',
  ).all<{ role_name: string; permission_key: string; allowed: number }>();
  return results;
}

// وصف عربي لمفاتيح الصلاحيات (للعرض في الواجهة)
export const PERMISSION_LABELS: Record<string, string> = {
  'draft.edit': 'إنشاء/تحرير المسودات',
  'media.upload': 'رفع الوسائط',
  'ai.generate': 'توليد نص بالذكاء الاصطناعي',
  'content.submit': 'إرسال للمراجعة',
  'content.review': 'مراجعة/رفض/تعديل محتوى الآخرين',
  'content.schedule': 'الجدولة',
  'content.approve_final': 'الاعتماد النهائي والنشر',
  'analytics.view': 'عرض التحليلات',
  'users.manage': 'إدارة المستخدمين',
  'permissions.manage': 'تعديل الصلاحيات',
  'settings.manage': 'إدارة الإعدادات',
  'comments.manage': 'إدارة التعليقات والرسائل المباشرة',
  'audit.view': 'عرض سجل التدقيق',
};
