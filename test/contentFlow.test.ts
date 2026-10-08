// «فكرة» في الواجهة: حالةُ عرضٍ مشتقّة، وأوّل أعمدة اللوحة، ولا تُنقل بسحب.

import { describe, it, expect } from 'vitest';
import { KANBAN_COLS, moveAction, opensScheduling, isBlankHtml } from '../web/src/contentFlow';
import { displayStatus, isIdea, STATUS_LABELS, STATUS_BADGE } from '../web/src/api';

describe('displayStatus', () => {
  it('المسودة بلا نصّ «فكرة»، وبنصٍّ «مسودة»', () => {
    expect(displayStatus({ status: 'draft', body: '' })).toBe('idea');
    expect(displayStatus({ status: 'draft', body: '<p>نص</p>' })).toBe('draft');
  });

  it('ما لا يحمل نصّه من الردود لا يُحكم عليه فكرةً', () => {
    expect(displayStatus({ status: 'draft' })).toBe('draft');
    expect(isIdea({ status: 'draft', body: null })).toBe(false);
  });

  it('المرفوض بلا نصّ ليس فكرة — الفكرة مسودةٌ وحدها', () => {
    expect(displayStatus({ status: 'rejected', body: '' })).toBe('rejected');
  });

  it('«متأخر» باقٍ كما كان', () => {
    expect(displayStatus({ status: 'scheduled', pending_at: '2000-01-01T00:00:00Z', body: '<p>نص</p>' })).toBe('late');
  });

  it('للفكرة تسميتها ولونها المسجّلان', () => {
    expect(STATUS_LABELS.idea).toBe('فكرة');
    expect(STATUS_BADGE.idea).toBe(STATUS_BADGE.draft);
  });
});

describe('لوحة المحتوى', () => {
  it('«فكرة» أوّل الأعمدة، وكل حالةٍ معروضة لها عمود', () => {
    expect(KANBAN_COLS[0].key).toBe('idea');
    const shown = KANBAN_COLS.flatMap((c) => c.statuses);
    for (const s of Object.keys(STATUS_LABELS)) expect(shown).toContain(s);
  });

  it('الفكرة لا تُنقل إلى عمودٍ ولا منه', () => {
    for (const col of KANBAN_COLS) {
      expect(moveAction('idea', col.key)).toBeNull();
      expect(moveAction('draft', 'idea')).toBeNull();
    }
  });

  it('سحب المعتمد إلى «مجدول» يفتح الجدولة، وما لم يُعتمد يبقى ممنوعاً', () => {
    expect(moveAction('approved', 'scheduled')).toBeNull(); // لا انتقال بسحب
    expect(opensScheduling('approved', 'scheduled')).toBe(true);
    for (const from of ['idea', 'draft', 'rejected', 'pending_marketing', 'pending_gm', 'scheduled', 'late', 'published']) {
      expect(opensScheduling(from, 'scheduled')).toBe(false);
    }
    expect(opensScheduling('approved', 'published')).toBe(false);
  });

  it('المسودة تُرسَل للمراجعة كما كانت', () => {
    expect(moveAction('draft', 'pending_marketing')).toBe('submit');
    expect(moveAction('rejected', 'pending_marketing')).toBe('submit');
    expect(moveAction('late', 'published')).toBeNull();
  });
});

describe('isBlankHtml', () => {
  it('الفراغ وما يبدو فارغاً في المحرّر', () => {
    for (const v of ['', null, undefined, '<p><br></p>', '<div><br/></div>', '<p>&nbsp;</p>', '<p>‏​</p>']) {
      expect(isBlankHtml(v)).toBe(true);
    }
  });

  it('كلمةٌ واحدة أو وسيطٌ وحده نصٌّ', () => {
    expect(isBlankHtml('<p>نص</p>')).toBe(false);
    expect(isBlankHtml('<p><img src="/api/media/abc"></p>')).toBe(false);
    expect(isBlankHtml('<div data-media-id="m1"></div>')).toBe(false);
    expect(isBlankHtml('a &amp; b')).toBe(false);
  });
});
