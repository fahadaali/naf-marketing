// حسابات Ayrshare المربوطة والويب هوك المسجّلة — بأشكال ردود التوثيق نفسها
// (`GET /user` و`GET /hook/webhook`).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mapAyrshareAccounts, ayrshareAccountPlatform, listAyrshareWebhooks } from '../src/adapters/ayrshare';

afterEach(() => vi.unstubAllGlobals());

const USER = {
  activeSocialAccounts: ['facebook', 'gmb', 'linkedin', 'twitter', 'youtube'],
  displayNames: [
    { displayName: 'NAF', id: '106638152329', messagingActive: true, pageName: 'ناف', platform: 'facebook' },
    { displayName: 'NAF Law', platform: 'gmb', profileUrl: 'https://naflaw.sa' },
    { displayName: 'NAF', id: '72157', platform: 'linkedin', type: 'corporate', username: 'naf' },
    { displayName: 'naf', id: '1194881472', messagingActive: true, platform: 'twitter', username: 'naf' },
    // اسم صاحب حساب جوجل في displayName — والقناة في channelTitle
    { channelId: 'UCx', channelTitle: 'قناة ناف', displayName: 'Fahad', id: '1068', platform: 'youtube' },
  ],
  messagingEnabled: true,
};

describe('حسابات Ayrshare', () => {
  it('مفاتيح منصاتنا من أسمائه — ولينكدإن الصفحة من نوعه', () => {
    expect(ayrshareAccountPlatform({ platform: 'twitter' })).toBe('x');
    expect(ayrshareAccountPlatform({ platform: 'gmb' })).toBe('google');
    expect(ayrshareAccountPlatform({ platform: 'linkedin', type: 'corporate' })).toBe('linkedin_page');
    expect(ayrshareAccountPlatform({ platform: 'linkedin', type: 'personal' })).toBe('linkedin');
  });

  it('الاسم من موضعه في كل منصة، والمراسلة من messagingActive', () => {
    expect(mapAyrshareAccounts(USER)).toEqual([
      { id: '106638152329', platform: 'facebook', name: 'ناف', messaging: true },
      { id: 'gmb', platform: 'google', name: 'NAF Law', messaging: false },
      { id: '72157', platform: 'linkedin_page', name: 'NAF', messaging: false },
      { id: '1194881472', platform: 'x', name: 'naf', messaging: true },
      { id: '1068', platform: 'youtube', name: 'قناة ناف', messaging: false },
    ]);
    // بلا حسابات لا يردّ Ayrshare `displayNames` أصلاً
    expect(mapAyrshareAccounts({})).toEqual([]);
  });

  it('الويب هوك من كائن الأحداث — بلا أوقات التحديث ولا الحقول الأخرى', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      refId: '1c72', status: 'success', updated: '2024-01-11T18:20:51Z',
      scheduled: 'https://m.naflaw.sa/hook', scheduledUpdated: '2023-12-06T01:54:08Z',
      social: 'https://m.naflaw.sa/hook', socialUpdated: '2023-10-26T03:20:46Z',
    })));
    expect(await listAyrshareWebhooks({ key: 'k' })).toEqual([
      { event: 'scheduled', url: 'https://m.naflaw.sa/hook' },
      { event: 'social', url: 'https://m.naflaw.sa/hook' },
    ]);
  });
});
