import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDeviceApi } from '../src/device-api.mjs';
import { RULE_IDS } from '../src/decider.mjs';
import { createOpsSummary } from '../src/ops-api.mjs';

const A = { userId: '11111111-1111-4111-8111-111111111111' };
const B = { userId: '22222222-2222-4222-8222-222222222222' };
const SECRET_BODY = '비밀 메모 본문 문장 SHOULD-NEVER-APPEAR';
const T0 = Date.parse('2026-11-05T00:00:00.000Z');

// 표 이름별로 메모리에 저장하는 가짜 Supabase. select().eq() 만 흉내 낸다.
function fakeSupabase(tables) {
  return {
    from(name) {
      const rows = tables[name];
      if (!rows) return { select: () => ({ eq: () => Promise.resolve({ data: null, error: { code: '42P01' } }) }) };
      return {
        select: () => {
          const state = { filters: [] };
          const q = {
            eq(column, value) { state.filters.push([column, value]); return q; },
            maybeSingle() { return Promise.resolve({ data: rows.filter(r => state.filters.every(([c, v]) => r[c] === v))[0] ?? null, error: null }); },
            then(resolve, reject) { return Promise.resolve({ data: rows.filter(r => state.filters.every(([c, v]) => r[c] === v)), error: null }).then(resolve, reject); },
          };
          return q;
        },
      };
    },
  };
}
const tables = () => ({
  notes: [
    { id: 'n1', owner_id: A.userId, title: '제목', content: SECRET_BODY },
    { id: 'n2', owner_id: A.userId, title: '제목2', content: SECRET_BODY },
    { id: 'n3', owner_id: B.userId, title: '제목3', content: SECRET_BODY },
  ],
  notes_backup: [{ id: 'b1', owner_id: B.userId, title: 't', content: SECRET_BODY }],
  device_approvals: [],
});

const summaryFor = async (user, deviceStatus = 'approved', t = tables()) => createOpsSummary({
  supabase: fakeSupabase(t), now: () => T0, newRequestId: () => 'req-fixed' })({ request: { headers: { 'x-vercel-id': 'icn1::abc-123' } }, user, deviceStatus });
const byId = summary => Object.fromEntries(summary.items.map(item => [item.id, item]));

test('요약은 실측 항목과 미실행 항목을 구분하고, 요청 ID·확인 시각·플랫폼 요청 ID 를 담는다', async () => {
  const summary = await summaryFor(A);
  assert.equal(summary.schema, 'aleph.ops.summary.v1');
  assert.equal(summary.requestId, 'req-fixed');
  assert.equal(summary.platformRequestId, 'icn1::abc-123');
  assert.equal(summary.checkedAt, '2026-11-05T00:00:00.000Z');
  const items = byId(summary);
  assert.deepEqual(items.decider_rules.value.ruleIds, [...RULE_IDS]);
  assert.equal(items.decider_rules.status, 'verified');
  assert.deepEqual(items.detect_rule.value, { rule: 'burst_read', method: 'GET', windowSeconds: 600, overCount: 120 });
  for (const id of ['detect_events', 'revocation']) {
    assert.equal(items[id].status, 'not_run', id);
    assert.equal(items[id].value, null, `${id} 는 값을 지어내지 않는다`);
    assert.ok(items[id].note.length > 10);
  }
  assert.ok(summary.items.every(item => ['verified', 'not_run'].includes(item.status)));
});

test('복구 버전은 검증한 사본의 버전·해시 앞 12자·현재 코드와의 차이 수이고 지금은 차이가 없다', async () => {
  const { policy_copy: copy } = byId(await summaryFor(A));
  const safe = JSON.parse(await readFile(join(import.meta.dirname, '..', 'policy', 'safe-policy.json'), 'utf8'));
  assert.equal(copy.value.version, safe.version);
  assert.match(copy.value.hash, /^[0-9a-f]{12}$/u);
  assert.equal(copy.value.driftFromCode, 0);
  assert.equal(copy.status, 'verified');
});

test('수치는 로그인한 계정의 행만 센 건수이고, 서버 기록과 같다', async () => {
  const t = tables();
  const a = byId(await summaryFor(A, 'approved', t));
  const b = byId(await summaryFor(B, 'pending', t));
  assert.equal(a.my_notes.value.count, t.notes.filter(row => row.owner_id === A.userId).length);
  assert.equal(b.my_notes.value.count, 1);
  assert.equal(a.my_backups.value.count, 0);
  assert.equal(b.my_backups.value.count, 1);
  assert.deepEqual(a.device.value, { status: 'approved' });
  assert.deepEqual(b.device.value, { status: 'pending' });
});

test('표를 읽지 못하면 0 으로 채우지 않고 미실행으로 표시한다', async () => {
  const t = tables();
  delete t.notes_backup;
  const items = byId(await summaryFor(A, 'none', t));
  assert.equal(items.my_backups.status, 'not_run');
  assert.equal(items.my_backups.value, null);
  assert.equal(items.my_notes.status, 'verified');
});

test('응답에는 메모 제목·본문·소유자 ID·기기 값이 들어 있지 않다', async () => {
  const text = JSON.stringify(await summaryFor(A));
  for (const secret of [SECRET_BODY, '제목', A.userId, B.userId, 'owner_id', 'device_hash', 'access_token']) {
    assert.ok(!text.includes(secret), secret);
  }
});

test('GET /api/device?view=ops 는 로그인이 필요하고, 로그인하면 요약을, view 가 없으면 기존 상태를 돌려준다', async () => {
  const t = tables();
  const ops = createOpsSummary({ supabase: fakeSupabase(t), now: () => T0, newRequestId: () => 'req-fixed' });
  const verifier = async authorization => (authorization === 'Bearer test' ? A : null);
  const api = createDeviceApi({ verifier, supabase: fakeSupabase(t), verifyPassword: async () => null, ops, log: () => {} });
  const call = (authorization, query) => {
    const response = { headers: {}, status(code) { this.code = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(payload) { this.payload = payload; return this; } };
    return api({ method: 'GET', query, headers: { authorization } }, response).then(() => response);
  };
  assert.equal((await call(undefined, { view: 'ops' })).code, 401);
  const summary = await call('Bearer test', { view: 'ops' });
  assert.equal(summary.code, 200);
  assert.equal(summary.payload.schema, 'aleph.ops.summary.v1');
  assert.equal(byId(summary.payload).device.value.status, 'none');
  const plain = await call('Bearer test', {});
  assert.deepEqual(plain.payload, { status: 'none' });
  assert.equal((await call('Bearer test', { view: 'other' })).payload.status, 'none', '모르는 view 는 기존 상태 응답');
});

test('작전실 화면은 서버 응답을 그대로 그리고 메모 본문을 요청하지 않는다', async () => {
  const html = (await readFile(join(import.meta.dirname, '..', 'public', 'ops.html'), 'utf8')).split('\r\n').join('\n');
  assert.match(html, /\/api\/device\?view=ops/u);
  assert.match(html, /실측/u);
  assert.match(html, /미실행/u);
  assert.doesNotMatch(html, /\/api\/notes|innerHTML|localStorage|sessionStorage/u);
  assert.match(html, /\/api\/login/u, '이 화면이 직접 로그인한다(토큰을 저장소에서 가져오지 않는다)');
});
