// احتساب المؤشرات على قاعدةٍ حقيقية بالمخطّط الفعلي.
//
// الحساب هنا كلُّه SQL وجمعٌ في الذاكرة، وأخطاؤه لا تُرمى ولا تُسجَّل: قسمةٌ
// على مقامٍ خاطئ تعطي رقماً معقولاً يدخل اللوحة ويُبنى عليه قرار. فتُثبَّت
// المقامات بأمثلةٍ محسوبة باليد.
//
// و`node:sqlite` هو محرّك D1 نفسه، فما يمرّ هنا يمرّ هناك.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { computeAuto, isReviewDue } from '../src/services/metrics';
import { periodOf } from '../src/services/period';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

/** غلافٌ يعطي `node:sqlite` واجهةَ D1 — نفس الأسماء ونفس شكل النتائج. */
function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...binds);
      return { meta: { changes: r.changes } };
    },
  });
  return { prepare: (sql: string) => stmt(sql) };
}

function build(): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  return db;
}

/** يوليو ٢٠٢٦ — وحدوده UTC هي 2026-06-30T21:00Z .. 2026-07-31T21:00Z */
const JULY = periodOf('monthly', '2026-07-15T00:00:00Z');

let db: any;
let env: any;

function value(key: string, dimValue = ''): number | undefined {
  const row = db
    .prepare(
      `SELECT value FROM metric_values WHERE metric_key = ? AND period = 'monthly' AND period_start = ? AND dim_value = ?`,
    )
    .get(key, JULY.start, dimValue) as { value: number } | undefined;
  return row?.value;
}

beforeEach(() => {
  db = build();
  env = { DB: d1(db) };
});

describe('الطبقة الأولى والثانية — من لقطات التحليلات', () => {
  beforeEach(() => {
    const insert = db.prepare(
      `INSERT INTO analytics_snapshots (id, platform, post_id, reach, impressions, engagement, sent_at, metrics_json, via_platform)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 1)`,
    );
    insert.run('a1', 'linkedin', 1000, 4000, 200, '2026-07-05T10:00:00Z',
      JSON.stringify([{ type: 'clicks', value: 80 }, { type: 'likes', value: 120 }, { type: 'saves', value: 15 }]));
    insert.run('a2', 'x', 500, 1000, 50, '2026-07-20T18:00:00Z',
      JSON.stringify([{ type: 'clicks', value: 20 }, { type: 'reactions', value: 30 }]));
    // خارج الفترة — يجب ألّا يدخل أي رقم
    insert.run('a3', 'x', 9999, 9999, 9999, '2026-08-05T10:00:00Z', '[]');
  });

  it('يجمع الوصول والظهور والتفاعل داخل الفترة وحدها', async () => {
    await computeAuto(env, JULY);
    expect(value('reach')).toBe(1500);
    expect(value('impressions')).toBe(5000);
    expect(value('engagement')).toBe(250);
  });

  it('ينسب التكرار إلى الوصول والتفاعل إليه كذلك', async () => {
    await computeAuto(env, JULY);
    expect(value('frequency')).toBeCloseTo(5000 / 1500, 2);       // 3.33
    expect(value('engagement_rate_reach')).toBeCloseTo(250 / 1500 * 100, 2); // 16.67
  });

  it('ينسب النقر إلى الظهور لا إلى الوصول', async () => {
    await computeAuto(env, JULY);
    expect(value('ctr')).toBeCloseTo(100 / 5000 * 100, 2); // 2%
  });

  it('يجمع الإعجاب والتفاعلات في مؤشرٍ واحد ويفصل الحفظ عنه', async () => {
    await computeAuto(env, JULY);
    expect(value('likes')).toBe(150); // 120 + 30
    expect(value('saves')).toBe(15);
  });

  it('يترك المؤشر بلا صفٍّ حين لا مصدر له — لا يكتب صفراً', async () => {
    await computeAuto(env, JULY);
    // لا مشاركات في أي لقطة، ولا نسبة إكمال
    expect(value('shares')).toBeUndefined();
    expect(value('completion_rate')).toBeUndefined();
  });

  it('يعدّ كل الظهور عضويّاً ما لم يُشترَ', async () => {
    await computeAuto(env, JULY);
    expect(value('organic_paid_split')).toBe(100);

    db.prepare(
      `INSERT INTO ad_spend (id, period_start, period_end, platform, amount, impressions, clicks)
       VALUES ('sp1', '2026-07-01', '2026-07-31', 'linkedin', 2000, 1000, 100)`,
    ).run();
    await computeAuto(env, JULY);
    expect(value('organic_paid_split')).toBe(80); // (5000-1000)/5000
  });
});

describe('الطبقة الرابعة — مسار البيع من مرآة إدارة المكتب', () => {
  beforeEach(() => {
    const lead = db.prepare(
      `INSERT INTO crm_leads (id, full_name, phone, email, source, status, expected_value, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-08-01T00:00:00Z')`,
    );
    lead.run('l1', 'أ', '0501111111', 'a@x.sa', 'موقع إلكتروني', 'تم التواصل', 50000, '2026-07-02T08:00:00Z');
    lead.run('l2', 'ب', '0502222222', 'b@x.sa', 'إحالة من عميل', 'بانتظار توقيع', 90000, '2026-07-06T08:00:00Z');
    lead.run('l3', 'ج', '0503333333', '', 'إعلان', 'مهتم', null, '2026-07-09T08:00:00Z');
    lead.run('l4', 'د', '0504444444', 'd@x.sa', 'إعلان', 'غير مناسب', null, '2026-07-11T08:00:00Z');
    // مكرّرٌ بالجوال — يدخل نسبة التكرار
    lead.run('l5', 'هـ', '0501111111', '', null, 'مهتم', null, '2026-07-14T08:00:00Z');
  });

  it('يفصل المؤهل تسويقياً عن المؤهل للبيع بحسب الإعدادات', async () => {
    await computeAuto(env, JULY);
    expect(value('leads')).toBe(5);
    expect(value('mql')).toBe(2);  // «تم التواصل» و«بانتظار توقيع»
    expect(value('sql')).toBe(1);  // «بانتظار توقيع» وحدها
    expect(value('lead_quality_ratio')).toBe(40);
  });

  it('يوزّع المحتملين على مصادرهم ويسمّي ما لا مصدر له', async () => {
    await computeAuto(env, JULY);
    expect(value('leads_by_source', 'إعلان')).toBe(2);
    expect(value('leads_by_source', 'غير معروف')).toBe(1);
    expect(value('mql_by_source', 'إحالة من عميل')).toBe(1);
  });

  it('يحسب نسبة الإحالات — القناة الأعلى تحويلاً في القطاع', async () => {
    await computeAuto(env, JULY);
    expect(value('referral_rate')).toBe(20); // واحد من خمسة
  });

  it('يقيس اكتمال البيانات بالثلاثة التي يذكرها الدليل', async () => {
    await computeAuto(env, JULY);
    // المكتمل: مصدر + جهة اتصال + تصنيف. الخامس بلا مصدر فيسقط.
    expect(value('data_completeness')).toBe(80);
  });

  it('يعدّ السجلّ المكرّر مرّةً واحدة لا مرّتين', async () => {
    await computeAuto(env, JULY);
    expect(value('duplicate_rate')).toBe(20); // الخامس وحده مكرّر
  });
});

describe('الطبقة الخامسة — التكلفة تشمل أربعة بنود لا بنداً', () => {
  beforeEach(() => {
    db.prepare(
      `INSERT INTO crm_leads (id, source, status, created_at, synced_at)
       VALUES ('l1','إعلان','تم التواصل','2026-07-02T08:00:00Z','2026-08-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO crm_clients (id, full_name, status, join_date, created_at, synced_at)
       VALUES ('c1','ش','current','2026-07-10','2026-07-10T00:00:00Z','2026-08-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO crm_cases (id, client_id, status, outcome, fee_amount, collected_amount, created_at, synced_at)
       VALUES ('k1','c1','completed','won', 120000, 60000, '2026-07-15T00:00:00Z','2026-08-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO ad_spend (id, period_start, period_end, platform, amount, impressions, clicks)
       VALUES ('sp1','2026-07-01','2026-07-31','linkedin', 10000, 200000, 2000)`,
    ).run();
  });

  it('يحسب تكلفة الألف ظهور وتكلفة النقرة من الإنفاق وحده', async () => {
    await computeAuto(env, JULY);
    expect(value('cpm')).toBe(50);  // 10000/200000*1000
    expect(value('cpc')).toBe(5);   // 10000/2000
  });

  it('يضمّ أجور الفريق والأدوات ووقت الشركاء إلى تكلفة الاكتساب', async () => {
    await computeAuto(env, JULY);
    // بالإعلان وحده: 10000 على عميلٍ واحد
    expect(value('cac')).toBe(10000);

    const put = db.prepare(
      `INSERT INTO metric_values (id, metric_key, period, period_start, period_end, value, source)
       VALUES (?, ?, 'monthly', ?, ?, ?, 'manual')`,
    );
    put.run('m1', 'team_cost', JULY.start, JULY.end, 30000);
    put.run('m2', 'tools_cost', JULY.start, JULY.end, 5000);
    put.run('m3', 'partner_time_cost', JULY.start, JULY.end, 15000);

    await computeAuto(env, JULY);
    expect(value('cac')).toBe(60000);            // 10000+30000+5000+15000
    expect(value('cpl')).toBe(60000);            // على محتملٍ واحد
    expect(value('cpql')).toBe(60000);           // وعلى مؤهّلٍ واحد
    expect(value('spend_of_revenue')).toBe(100); // 60000 من 60000 محصّلة
  });

  it('ينسب العائد على الإنفاق الإعلاني إلى الإعلان لا إلى التكلفة كلها', async () => {
    await computeAuto(env, JULY);
    expect(value('roas')).toBe(6); // 60000 محصّلة / 10000 إعلان
  });

  it('يحسب معدل الإغلاق على ما حُسم وحده', async () => {
    db.prepare(
      `INSERT INTO crm_cases (id, client_id, status, outcome, created_at, synced_at)
       VALUES ('k2','c1','in-progress', NULL, '2026-07-20T00:00:00Z','2026-08-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO crm_cases (id, client_id, status, outcome, created_at, synced_at)
       VALUES ('k3','c1','completed','lost','2026-07-22T00:00:00Z','2026-08-01T00:00:00Z')`,
    ).run();
    await computeAuto(env, JULY);
    // اثنتان حُسمتا: واحدة ربحاً — والجارية لا تدخل المقام
    expect(value('win_rate')).toBe(50);
  });
});

describe('الطبقة الثامنة — البريد', () => {
  it('يفصل النقر إلى الفتح عن النقر إلى الإرسال', async () => {
    db.prepare(
      `INSERT INTO newsletters (id, title, slug, status, sent_at)
       VALUES ('n1','نشرة','n-1','sent','2026-07-05T09:00:00Z')`,
    ).run();
    const sub = db.prepare(
      `INSERT INTO subscribers (id, email, status, token, created_at) VALUES (?, ?, 'active', ?, '2026-05-01T00:00:00Z')`,
    );
    const send = db.prepare(
      `INSERT INTO newsletter_sends (id, newsletter_id, subscriber_id, status, opened_at, clicked_at, sent_at)
       VALUES (?, 'n1', ?, 'sent', ?, ?, '2026-07-05T09:00:00Z')`,
    );
    for (let i = 1; i <= 10; i++) {
      sub.run(`s${i}`, `s${i}@x.sa`, `tok${i}`);
      // خمسةٌ فتحوا، اثنان منهم نقروا
      send.run(`d${i}`, `s${i}`, i <= 5 ? '2026-07-05T10:00:00Z' : null, i <= 2 ? '2026-07-05T11:00:00Z' : null);
    }

    await computeAuto(env, JULY);
    expect(value('email_open_rate')).toBe(50);   // 5 من 10
    expect(value('email_click_rate')).toBe(20);  // 2 من 10
    expect(value('email_ctor')).toBe(40);        // 2 من 5 — جودة المحتوى لا العنوان
  });
});

describe('الطبقة العاشرة — التشغيل', () => {
  it('ينسب الالتزام بالخطة إلى المجدول لا إلى المنشور', async () => {
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role_name) VALUES ('u1','ف','f@naf.sa','h','general_manager')`,
    ).run();
    db.prepare(
      `INSERT INTO content_posts (id, title, author_id, status) VALUES ('p1','عنوان','u1','published')`,
    ).run();
    const sch = db.prepare(
      `INSERT INTO schedules (id, post_id, platform, scheduled_at, status) VALUES (?, 'p1', 'x', ?, ?)`,
    );
    sch.run('sc1', '2026-07-05T09:00:00Z', 'published');
    sch.run('sc2', '2026-07-06T09:00:00Z', 'published');
    sch.run('sc3', '2026-07-07T09:00:00Z', 'pending');
    sch.run('sc4', '2026-07-08T09:00:00Z', 'failed');

    await computeAuto(env, JULY);
    expect(value('calendar_adherence')).toBe(50); // 2 من 4 استُحقّت
  });

  it('يحسب زمن الاستجابة الأول على ما رُدّ عليه، ونسبة الردّ على الكلّ', async () => {
    const c = db.prepare(
      `INSERT INTO platform_comments (id, platform, provider_comment_id, kind, body, reply_body, replied_at, created_at)
       VALUES (?, 'x', ?, ?, ?, ?, ?, ?)`,
    );
    c.run('c1', 'p1', 'comment', 'كم سعر الاستشارة؟', 'أهلاً', '2026-07-05T10:30:00Z', '2026-07-05T10:00:00Z');
    c.run('c2', 'p2', 'dm', 'أحتاج محامي شركات', 'تفضّل', '2026-07-06T12:00:00Z', '2026-07-06T10:00:00Z');
    c.run('c3', 'p3', 'comment', 'جزاكم الله خيراً', null, null, '2026-07-07T10:00:00Z');
    c.run('c4', 'p4', 'comment', 'ما شاء الله', null, null, '2026-07-08T10:00:00Z');

    await computeAuto(env, JULY);
    expect(value('first_response_minutes')).toBe(75); // (30 + 120) / 2
    expect(value('first_reply_rate')).toBe(50);       // 2 من 4
    // النوعيّان: سؤالٌ صريح وطلبُ خدمة — لا تعليقا المجاملة
    expect(value('qualitative_comments')).toBe(2);
    expect(value('direct_conversations')).toBe(1);
  });
});

describe('المراحل الستّ ومعدل الإغلاق بتعريف الدليل', () => {
  beforeEach(() => {
    const lead = db.prepare(
      `INSERT INTO crm_leads (id, source, status, phone, created_at, synced_at)
       VALUES (?, 'إعلان', ?, ?, ?, '2026-08-01T00:00:00Z')`,
    );
    // عشرون محتملاً، عشرةٌ منهم مؤهلون
    for (let i = 1; i <= 20; i++) {
      lead.run(`l${i}`, i <= 10 ? 'تم التواصل' : 'مهتم', `05010000${String(i).padStart(2, '0')}`, '2026-07-05T08:00:00Z');
    }
    db.prepare(
      `INSERT INTO crm_clients (id, status, join_date, created_at, synced_at)
       VALUES ('c1','current','2026-07-10','2026-07-10T00:00:00Z','2026-08-01T00:00:00Z')`,
    ).run();
    // عقدان في الفترة
    const kase = db.prepare(
      `INSERT INTO crm_cases (id, client_id, case_type, status, outcome, fee_amount, created_at, synced_at)
       VALUES (?, 'c1', ?, 'completed', ?, 100000, ?, '2026-08-01T00:00:00Z')`,
    );
    kase.run('k1', 'قضية تجارية', 'won', '2026-07-15T00:00:00Z');
    kase.run('k2', 'قضية عمالية', 'lost', '2026-07-18T00:00:00Z');
  });

  it('يترك المرحلتين غير المقيستين بلا رقم — لا صفراً يُقرأ تسرّباً', async () => {
    await computeAuto(env, JULY);
    expect(value('stage_conversion', 'lead_qualified')).toBe(50); // ١٠ من ٢٠
    expect(value('stage_conversion', 'qualified_contract')).toBe(20); // ٢ من ١٠
    // لا اجتماعات ولا عروض مسجَّلة بعد
    expect(value('stage_conversion', 'qualified_meeting')).toBeUndefined();
    expect(value('stage_conversion', 'meeting_proposal')).toBeUndefined();
    expect(value('stage_conversion', 'proposal_contract')).toBeUndefined();
  });

  it('يكمل المسار متى سُجّلت الاجتماعات والعروض', async () => {
    const put = db.prepare(
      `INSERT INTO metric_values (id, metric_key, period, period_start, period_end, value, source)
       VALUES (?, ?, 'monthly', ?, ?, ?, 'manual')`,
    );
    put.run('m1', 'meetings', JULY.start, JULY.end, 8);
    put.run('m2', 'proposals', JULY.start, JULY.end, 4);

    await computeAuto(env, JULY);
    expect(value('stage_conversion', 'qualified_meeting')).toBe(80); // ٨ من ١٠
    expect(value('stage_conversion', 'meeting_proposal')).toBe(50);  // ٤ من ٨
    expect(value('stage_conversion', 'proposal_contract')).toBe(50); // ٢ من ٤
  });

  it('ينسب معدل الإغلاق إلى العروض متى سُجّلت، وإلى المحسومة متى لم تُسجَّل', async () => {
    // بلا عروض: القضايا الرابحة ÷ المحسومة = ١ من ٢
    await computeAuto(env, JULY);
    expect(value('win_rate')).toBe(50);

    db.prepare(
      `INSERT INTO metric_values (id, metric_key, period, period_start, period_end, value, source)
       VALUES ('m3', 'proposals', 'monthly', ?, ?, 8, 'manual')`,
    ).run(JULY.start, JULY.end);

    // بالعروض: العقود ÷ العروض = ٢ من ٨ — وهو ما ينصّ عليه الدليل
    await computeAuto(env, JULY);
    expect(value('win_rate')).toBe(25);
  });

  it('يفصل زمن دورة البيع لكل نوع خدمة', async () => {
    // محتملان حُوّلا إلى العميل نفسه، وله عقدان بنوعين مختلفين
    db.prepare(
      `UPDATE crm_leads SET converted_client_id = 'c1', is_present = 0 WHERE id IN ('l1','l2')`,
    ).run();
    await computeAuto(env, JULY);
    // العقد التجاري بعد ١٠ أيام من المحتمل، والعمالي بعد ١٣
    expect(value('sales_cycle_days', 'قضية تجارية')).toBeCloseTo(10, 0);
    expect(value('sales_cycle_days', 'قضية عمالية')).toBeCloseTo(13, 0);
    expect(value('sales_cycle_days')).toBeDefined();
  });
});

describe('استحقاق المراجعة', () => {
  it('يستحقّ من لم يُراجع قطُّ، ومن مضت دوريتُه', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    expect(isReviewDue('weekly', null, now)).toBe(true);
    expect(isReviewDue('weekly', '2026-07-30T00:00:00Z', now)).toBe(false);
    expect(isReviewDue('weekly', '2026-07-20T00:00:00Z', now)).toBe(true);
    // الربعيّ لا يستحقّ بعد شهر، ويستحقّ بعد أربعة
    expect(isReviewDue('quarterly', '2026-07-01T00:00:00Z', now)).toBe(false);
    expect(isReviewDue('quarterly', '2026-03-01T00:00:00Z', now)).toBe(true);
  });
});
