import type { Env } from '../types';
import { newId } from '../util';

// يسجّل إجراءً إدارياً/حساساً في سجل التدقيق — لا يعطّل الطلب الأصلي عند الفشل أبداً
export async function logAudit(
  env: Env,
  actor: { id: string | null; name: string | null },
  action: string,
  entityType?: string,
  entityId?: string,
  details?: string,
): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_log (id, actor_id, actor_name, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(newId('adt'), actor.id, actor.name, action, entityType || null, entityId || null, details || null)
      .run();
  } catch { /* لا تعطّل الإجراء الأصلي عند فشل تسجيل التدقيق */ }
}
