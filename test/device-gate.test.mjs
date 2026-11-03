import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeviceCheck, deviceHash } from '../src/device-check.mjs';
import { createNotesApi } from '../src/notes-api.mjs';

const A = { userId: '11111111-1111-4111-8111-111111111111' };
const B = { userId: '22222222-2222-4222-8222-222222222222' };
const NOTE_ID = '33333333-3333-4333-8333-333333333333';
const DEVICE_A = 'a'.repeat(64);
const DEVICE_B = 'b'.repeat(64);
const T0 = Date.parse('2026-11-05T00:00:00.000Z');
const SECRET = '비밀 본문 SHOULD-NOT-LEAK';

// 표 이름별 메모리 가짜. 어떤 표를 읽었는지 기록해, 거부했을 때 메모 표를 건드리지 않았는지 본다.
function fakeSupabase({ devices = [], lookupError = false } = {}) {
  const touched = [];
  const notes = [{ id: NOTE_ID, owner_id: A.userId, title: '제목', content: SECRET, created_at: 1 }];
  const query = (name, rows, state) => {
    const hit = () => rows.filter(row => state.filters.every(([c, v]) => row[c] === v));
    const q = {
      select() { return q; }, order() { return q; },
      eq(column, value) { state.filters.push([column, value]); return q; },
      maybeSingle() { return Promise.resolve(lookupError && name === 'device_approvals' ? { data: null, error: { code: 'x' } } : { data: hit()[0] ?? null, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: hit(), error: null }).then(resolve, reject); },
    };
    return q;
  };
  return {
    touched, notes,
    from(name) {
      touched.push(name);
      const rows = name === 'notes' ? notes : devices;
      return {
        select: () => query(name, rows, { filters: [] }),
        update: () => query(name, rows, { filters: [] }),
        delete: () => query(name, rows, { filters: [] }),
        insert: async () => ({ error: null }),
      };
    },
  };
}

const deviceRow = (user, id, status = 'approved', createdAt = new Date(T0).toISOString()) => ({ id: `d-${id.slice(0, 3)}`, user_id: user.userId, device_hash: deviceHash(id), status, created_at: createdAt });
let currentUser = A;
const verifier = async authorization => (authorization === 'Bearer test' ? currentUser : null);

function setup(options = {}, { withCheck = true } = {}) {
  const supabase = fakeSupabase(options);
  const logs = [];
  const api = createNotesApi({ verifier, supabase, log: entry => logs.push(entry),
    ...(withCheck ? { deviceCheck: createDeviceCheck({ supabase, now: () => T0 + 1000 }) } : {}) });
  const call = (method, { id, body, cookie, user = A, signedIn = true } = {}) => {
    currentUser = user;
    const response = { headers: {}, status(code) { this.code = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(payload) { this.payload = payload; return this; } };
    const request = { method, body, headers: { authorization: signedIn ? 'Bearer test' : undefined, cookie: cookie ? `vault-device=${cookie}` : undefined } };
    return api(request, response, id).then(() => response);
  };
  return { supabase, logs, call };
}

test('승인된 기기에서는 기존처럼 메모를 읽고 쓴다', async () => {
  const { call } = setup({ devices: [deviceRow(A, DEVICE_A)] });
  assert.deepEqual((await call('GET', { cookie: DEVICE_A })).payload, [{ id: NOTE_ID, title: '제목', body: SECRET }]);
  assert.equal((await call('GET', { id: NOTE_ID, cookie: DEVICE_A })).code, 200);
  assert.equal((await call('PUT', { id: NOTE_ID, cookie: DEVICE_A, body: { title: 't', body: 'b' } })).code, 200);
});

test('승인 전(기기 값 없음·대기·만료·취소)에는 자료 없이 거부하고 메모 표를 읽지 않는다', async () => {
  const cases = {
    '기기 값 없음': { devices: [], cookie: null },
    '기록 없는 기기 값': { devices: [], cookie: DEVICE_A },
    '승인 대기': { devices: [deviceRow(A, DEVICE_A, 'pending')], cookie: DEVICE_A },
    '만료된 대기': { devices: [deviceRow(A, DEVICE_A, 'pending', new Date(T0 - 16 * 60 * 1000).toISOString())], cookie: DEVICE_A },
    '취소됨': { devices: [deviceRow(A, DEVICE_A, 'revoked')], cookie: DEVICE_A },
  };
  for (const [name, { devices, cookie }] of Object.entries(cases)) {
    for (const [method, id, body] of [['GET'], ['POST', undefined, { title: 't', body: 'b' }], ['GET', NOTE_ID], ['PUT', NOTE_ID, { title: 't', body: 'b' }], ['DELETE', NOTE_ID]]) {
      const { supabase, call } = setup({ devices });
      const response = await call(method, { id, body, cookie });
      assert.equal(response.code, 403, `${name} ${method} ${id ?? ''}`);
      assert.deepEqual(response.payload, { error: 'DEVICE_NOT_APPROVED' });
      assert.ok(!JSON.stringify(response).includes(SECRET), '응답에 메모 내용이 없다');
      assert.ok(!supabase.touched.includes('notes'), `${name}: 메모 표를 읽지 않았다`);
      assert.equal(supabase.notes.length, 1, '아무것도 바뀌지 않았다');
    }
  }
});

test('다른 계정이 승인한 기기 값으로는 통과하지 못한다', async () => {
  const { call, supabase } = setup({ devices: [deviceRow(A, DEVICE_A)] });
  const response = await call('GET', { cookie: DEVICE_A, user: B });
  assert.equal(response.code, 403);
  assert.ok(!supabase.touched.includes('notes'));
});

test('기기 확인에 실패하거나 확인 방법이 없으면 거부한다(확인할 수 없으면 거부)', async () => {
  const broken = setup({ devices: [deviceRow(A, DEVICE_A)], lookupError: true });
  const failed = await broken.call('GET', { cookie: DEVICE_A });
  assert.equal(failed.code, 403);
  assert.ok(!broken.supabase.touched.includes('notes'));
  assert.equal(broken.logs.at(-1).reason, 'device_check_failed');

  const none = setup({ devices: [deviceRow(A, DEVICE_A)] }, { withCheck: false });
  assert.equal((await none.call('GET', { cookie: DEVICE_A })).code, 403, 'deviceCheck 를 주지 않으면 거부');
  assert.ok(!none.supabase.touched.includes('notes'));
});

test('로그인하지 않았으면 기기 확인보다 먼저 401 이고, 거부 기록에는 기기 값을 남기지 않는다', async () => {
  const { call, logs, supabase } = setup({ devices: [deviceRow(A, DEVICE_A)] });
  assert.equal((await call('GET', { signedIn: false, cookie: DEVICE_A })).code, 401);
  assert.deepEqual(supabase.touched, [], '로그인 없이는 어떤 표도 읽지 않는다');
  await call('GET', { cookie: DEVICE_B });
  assert.ok(logs.length >= 2);
  assert.ok(!JSON.stringify(logs).includes(DEVICE_A) && !JSON.stringify(logs).includes(DEVICE_B));
});
