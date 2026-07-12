-- بذور: مصفوفة الصلاحيات الافتراضية + الإعدادات الأساسية.
-- المدير العام يستطيع تعديل أي خانة لاحقاً من الواجهة (تُحدَّث القيم في roles_permissions).

-- writer = كاتب محتوى | marketing_manager = مدير تسويق | general_manager = مدير عام
INSERT OR IGNORE INTO roles_permissions (role_name, permission_key, allowed) VALUES
  -- إنشاء/تحرير المسودات
  ('writer','draft.edit',1), ('marketing_manager','draft.edit',1), ('general_manager','draft.edit',1),
  -- رفع الوسائط
  ('writer','media.upload',1), ('marketing_manager','media.upload',1), ('general_manager','media.upload',1),
  -- توليد نص بالذكاء الاصطناعي
  ('writer','ai.generate',1), ('marketing_manager','ai.generate',1), ('general_manager','ai.generate',1),
  -- إرسال للمراجعة
  ('writer','content.submit',1), ('marketing_manager','content.submit',1), ('general_manager','content.submit',1),
  -- مراجعة/رفض/تعديل محتوى الآخرين
  ('writer','content.review',0), ('marketing_manager','content.review',1), ('general_manager','content.review',1),
  -- الجدولة
  ('writer','content.schedule',0), ('marketing_manager','content.schedule',1), ('general_manager','content.schedule',1),
  -- الاعتماد النهائي والنشر
  ('writer','content.approve_final',0), ('marketing_manager','content.approve_final',0), ('general_manager','content.approve_final',1),
  -- عرض التحليلات
  ('writer','analytics.view',0), ('marketing_manager','analytics.view',1), ('general_manager','analytics.view',1),
  -- إدارة المستخدمين
  ('writer','users.manage',0), ('marketing_manager','users.manage',0), ('general_manager','users.manage',1),
  -- تعديل الصلاحيات
  ('writer','permissions.manage',0), ('marketing_manager','permissions.manage',0), ('general_manager','permissions.manage',1),
  -- إدارة الإعدادات
  ('writer','settings.manage',0), ('marketing_manager','settings.manage',0), ('general_manager','settings.manage',1);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('enabled_platforms', '["linkedin","x","instagram","snapchat","tiktok"]'),
  ('provider_name', 'mock'),
  ('timezone', 'Asia/Riyadh');
