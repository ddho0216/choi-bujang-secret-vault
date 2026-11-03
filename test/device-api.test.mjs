import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeviceApi, deviceHash } from '../src/device-api.mjs';

const A = { userId: '11111111-1111-4111-8111-111111111111' };
const B = { userId: '22222222-2222-4222-8222-222222222222' };
const T0 = Date.parse('2026-11-01T00:00:00.000Z');

// 실제 Supabase 대신 메모리에 저장하는 가짜 표. 질의 모양(select/insert/update + eq)만 흉내 낸다.
function fakeSupabase(rows) {
  const query = state => {
    const matches = () => rows.filter(row => state.filters.every(([c, v]) => row[c] === v));
    const q = {
      select() { return q; },
      eq(column, value) { state.filters.push([column, value]); return q; },
      maybeSingle() { return Promise.resolve({ data: matches()[0] ?? null, error: null }); },
      then(resolve, reject) {
        const hit = matches();
        if (state.kind === 'update') hit.forEach(row => Object.assign(row, state.values));
        return Promise.resolve({ data: hit, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return {
    from() {
      return {
        select: () => query({ kind: 'select', filters: [] }),
        update: values => query({ kind: 'update', filters: [], values }),
        insert: async row => {
          if (rows.some(r => r.device_hash === row.device_hash)) return { error: { code: '23505' } };
          rows.push({ id: `row-${rows.length}`, ...row });
          return { error: null };
        },
      };
    },
  };
}

// 쿠키 보관함 하나를 가진 가짜 브라우저. Set-Cookie 를 받으면 다음 요청에 쿠키로 돌려준다.
function setup({ rows = [], passwords = {} } = {}) {
  const logs = [];
  let counter = 0;
  let clock = T0;
  const state = { user: A, cookie: null };
  const verifier = async authorization => (authorization === 'Bearer test' ? state.user : null);
  // 가짜 비밀번호 확인: 계정마다 정한 비밀번호와 같을 때만 그 계정 ID 를 돌려준다.
  const verifyPassword = async password => Object.entries(passwords).find(([, value]) => value === password)?.[0] ?? null;
  const api = createDeviceApi({ verifier, supabase: fakeSupabase(rows), verifyPassword, now: () => clock,
    newDeviceId: () => String(++counter).padStart(64, '0'), log: entry => logs.push(entry) });
  const call = (method, body, { signedIn = true, cookie = state.cookie } = {}) => {
    const response = {
      headers: {}, status(code) { this.code = code; return this; },
      setHeader(name, value) { this.headers[name] = value; },
      json(payload) { this.payload = payload; return this; },
    };
    const headers = { authorization: signedIn ? 'Bearer test' : undefined, cookie: cookie ? `vault-device=${cookie}` : undefined };
    return api({ method, body, headers }, response).then(() => {
      const set = response.headers['Set-Cookie'];
      if (set) state.cookie = /vault-device=([0-9a-f]{64})/u.exec(set)[1];
      return response;
    });
  };
  return { rows, logs, state, call, advance: ms => { clock += ms; }, passwords };
}

test('로그인하지 않은 요청은 모든 메서드에서 401 이고 쿠키도 만들지 않는다', async () => {
  const { call, rows } = setup();
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const response = await call(method, { action: 'request' }, { signedIn: false });
    assert.equal(response.code, 401, method);
    assert.equal(response.headers['Set-Cookie'], undefined);
  }
  assert.equal(rows.length, 0);
});

test('승인 전에는 none/pending 이고, 비밀번호를 다시 확인해야만 approved 가 된다', async () => {
  const { call, rows, passwords } = setup();
  passwords[A.userId] = 'pw-of-a';
  assert.deepEqual((await call('GET')).payload, { status: 'none' });

  const requested = await call('POST', { action: 'request' });
  assert.equal(requested.code, 202);
  assert.deepEqual(requested.payload, { status: 'pending' });
  const cookie = requested.headers['Set-Cookie'];
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /Secure/u);
  assert.match(cookie, /SameSite=Strict/u);
  assert.ok(!JSON.stringify(requested.payload).includes('0000000000'), '기기 값은 응답 본문에 싣지 않는다');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].device_hash, deviceHash('1'.padStart(64, '0')), '서버에는 해시만 저장한다');
  assert.ok(!Object.values(rows[0]).includes('1'.padStart(64, '0')), '기기 값 원문은 저장하지 않는다');
  assert.deepEqual((await call('GET')).payload, { status: 'pending' });

  // 버튼만 누르는 승인(비밀번호 없음), 틀린 비밀번호는 승인되지 않는다.
  assert.equal((await call('POST', { action: 'approve' })).code, 400);
  assert.equal((await call('POST', { action: 'approve', password: 'wrong' })).code, 403);
  assert.deepEqual((await call('GET')).payload, { status: 'pending' });

  const approved = await call('POST', { action: 'approve', password: 'pw-of-a' });
  assert.equal(approved.code, 200);
  assert.deepEqual(approved.payload, { status: 'approved' });
  assert.deepEqual((await call('GET')).payload, { status: 'approved' });
  assert.equal(rows[0].status, 'approved');
});

test('다른 계정의 비밀번호로는 승인되지 않는다', async () => {
  const { call, state, passwords } = setup();
  passwords[A.userId] = 'pw-of-a';
  passwords[B.userId] = 'pw-of-b';
  await call('POST', { action: 'request' });
  assert.equal((await call('POST', { action: 'approve', password: 'pw-of-b' })).code, 403, 'A 의 기기를 B 의 비밀번호로 승인할 수 없다');
  assert.deepEqual((await call('GET')).payload, { status: 'pending' });
  state.user = A;
});

test('승인한 기기라도 다른 계정으로 로그인하면 승인되지 않은 기기로 본다', async () => {
  const { call, state, passwords } = setup();
  passwords[A.userId] = 'pw-of-a';
  await call('POST', { action: 'request' });
  await call('POST', { action: 'approve', password: 'pw-of-a' });
  state.user = B;
  assert.deepEqual((await call('GET')).payload, { status: 'none' }, 'B 는 A 가 승인한 기기를 쓸 수 없다');
  assert.equal((await call('POST', { action: 'approve', password: 'pw-of-a' })).code, 404);
});

test('쿠키가 없거나 위조·이상한 값이면 기록이 없는 것으로 본다', async () => {
  const { call, passwords } = setup();
  passwords[A.userId] = 'pw-of-a';
  await call('POST', { action: 'request' });
  await call('POST', { action: 'approve', password: 'pw-of-a' });
  assert.deepEqual((await call('GET', undefined, { cookie: null })).payload, { status: 'none' });
  assert.deepEqual((await call('GET', undefined, { cookie: 'f'.repeat(64) })).payload, { status: 'none' });
  assert.deepEqual((await call('GET', undefined, { cookie: 'not-a-device' })).payload, { status: 'none' });
});

test('승인 요청은 15분이 지나면 만료되어 승인할 수 없다', async () => {
  const { call, advance, passwords } = setup();
  passwords[A.userId] = 'pw-of-a';
  await call('POST', { action: 'request' });
  advance(15 * 60 * 1000 + 1000);
  assert.deepEqual((await call('GET')).payload, { status: 'expired' });
  const late = await call('POST', { action: 'approve', password: 'pw-of-a' });
  assert.equal(late.code, 409);
  assert.equal((await call('GET')).payload.status, 'expired');
});

test('본문에 상태·기기·사용자·역할을 넣으면 403 이고, 모르는 동작은 400 이다', async () => {
  const { call, rows } = setup();
  for (const extra of [{ status: 'approved' }, { deviceId: 'x' }, { userId: B.userId }, { role: 'admin' }, { isAdmin: true }]) {
    assert.equal((await call('POST', { action: 'request', ...extra })).code, 403, JSON.stringify(extra));
  }
  assert.equal((await call('POST', { action: 'nope' })).code, 400);
  assert.equal((await call('POST', 'x')).code, 400);
  assert.equal(rows.length, 0);
  assert.equal((await call('PUT', {})).code, 405);
});

test('승인 대기 요청이 5건을 넘으면 429 로 막는다', async () => {
  const { call, state, rows } = setup();
  for (let index = 0; index < 5; index += 1) {
    state.cookie = null;
    assert.equal((await call('POST', { action: 'request' })).code, 202);
  }
  state.cookie = null;
  assert.equal((await call('POST', { action: 'request' })).code, 429);
  assert.equal(rows.length, 5);
});

test('이미 승인된 기기가 다시 요청해도 새 기록을 만들지 않는다', async () => {
  const { call, rows, passwords } = setup();
  passwords[A.userId] = 'pw-of-a';
  await call('POST', { action: 'request' });
  await call('POST', { action: 'approve', password: 'pw-of-a' });
  const again = await call('POST', { action: 'request' });
  assert.equal(again.code, 200);
  assert.deepEqual(again.payload, { status: 'approved' });
  assert.equal(rows.length, 1);
});

test('로그에 비밀번호·기기 값·토큰을 남기지 않는다', async () => {
  const { call, logs, passwords } = setup();
  passwords[A.userId] = 'pw-of-a';
  await call('POST', { action: 'request' });
  await call('POST', { action: 'approve', password: 'wrong-secret-guess' });
  await call('POST', { action: 'approve', password: 'pw-of-a' });
  const text = JSON.stringify(logs);
  for (const secret of ['pw-of-a', 'wrong-secret-guess', '0000000000', 'Bearer', A.userId]) assert.ok(!text.includes(secret), secret);
  assert.ok(logs.some(entry => entry.event === 'device_approved'));
});
