import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthApi } from '../src/auth-api.mjs';

const TOKEN = 'aaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc';

// 실제 Supabase 대신, 호출 인자를 기록하고 정해 둔 응답을 돌려주는 가짜 클라이언트.
function fakeClients({ signIn, signOut } = {}) {
  const calls = { signIn: [], signOut: [] };
  return {
    calls,
    api: createAuthApi({
      newAnonClient: () => ({
        auth: {
          signInWithPassword: async args => {
            calls.signIn.push(args);
            return signIn ? signIn(args) : {
              data: { session: { access_token: TOKEN, refresh_token: 'refresh-secret', expires_at: 1900000000 },
                user: { email: args.email } },
              error: null,
            };
          },
        },
      }),
      adminClient: () => ({
        auth: { admin: { signOut: async (...args) => { calls.signOut.push(args); return signOut ? signOut() : { error: null }; } } },
      }),
    }),
  };
}

function call(handler, { method = 'POST', body, authorization } = {}) {
  const response = {
    headers: {}, status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(payload) { this.payload = payload; return this; },
  };
  return handler({ method, body, headers: { authorization } }, response).then(() => response);
}

test('로그인 성공: 토큰·만료·이메일만 돌려주고 refresh_token과 비밀번호는 응답에 없다', async () => {
  const { api, calls } = fakeClients();
  const response = await call(api.login, { body: { email: ' a@example.com ', password: 'pw-for-test' } });
  assert.equal(response.code, 200);
  assert.deepEqual(response.payload, { access_token: TOKEN, expires_at: 1900000000, email: 'a@example.com' });
  assert.equal(JSON.stringify(response.payload).includes('refresh'), false);
  assert.equal(JSON.stringify(response.payload).includes('pw-for-test'), false);
  assert.deepEqual(calls.signIn, [{ email: 'a@example.com', password: 'pw-for-test' }], '이메일 공백만 다듬어 공식 SDK로 넘긴다');
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('로그인 실패: 이유를 그대로 돌려주고 토큰은 없다', async () => {
  const { api } = fakeClients({ signIn: async () => ({ data: { session: null, user: null },
    error: { status: 400, message: 'Invalid login credentials' } }) });
  const response = await call(api.login, { body: { email: 'a@example.com', password: 'wrong' } });
  assert.equal(response.code, 401);
  assert.deepEqual(response.payload, { error: 'LOGIN_FAILED', message: 'Invalid login credentials' });
});

test('요청 한도·서버 오류는 상태를 구분하고, 예외는 502로 막는다', async () => {
  const limited = fakeClients({ signIn: async () => ({ data: {}, error: { status: 429, message: 'rate limit' } }) });
  assert.equal((await call(limited.api.login, { body: { email: 'a@example.com', password: 'x' } })).code, 429);
  const down = fakeClients({ signIn: async () => ({ data: {}, error: { status: 503, message: 'down' } }) });
  assert.equal((await call(down.api.login, { body: { email: 'a@example.com', password: 'x' } })).code, 502);
  const thrown = fakeClients({ signIn: async () => { throw new Error('network'); } });
  const response = await call(thrown.api.login, { body: { email: 'a@example.com', password: 'x' } });
  assert.equal(response.code, 502);
  assert.deepEqual(response.payload, { error: 'AUTH_UNAVAILABLE' });
});

test('잘못된 입력과 POST가 아닌 요청은 거부된다', async () => {
  const { api, calls } = fakeClients();
  for (const body of [undefined, null, {}, { email: 'a@example.com' }, { email: '', password: 'x' },
    { email: 'a@example.com', password: '' }, { email: 5, password: 'x' },
    { email: `${'a'.repeat(250)}@example.com`, password: 'x' }, { email: 'a@example.com', password: 'x'.repeat(1025) }]) {
    assert.equal((await call(api.login, { body })).code, 400, JSON.stringify(body)?.slice(0, 40));
  }
  assert.equal((await call(api.login, { method: 'GET' })).code, 405);
  assert.equal((await call(api.logout, { method: 'GET' })).code, 405);
  assert.equal(calls.signIn.length, 0, '잘못된 요청은 Supabase까지 가지 않는다');
});

test('로그아웃: 이 세션만 끊고, 토큰이 없으면 401', async () => {
  const { api, calls } = fakeClients();
  const response = await call(api.logout, { authorization: `Bearer ${TOKEN}` });
  assert.deepEqual([response.code, response.payload], [200, { ok: true, revoked: true }]);
  assert.deepEqual(calls.signOut, [[TOKEN, 'local']]);
  assert.equal((await call(api.logout, {})).code, 401);
  assert.equal((await call(api.logout, { authorization: 'Bearer not-a-jwt' })).code, 401);
  assert.equal(calls.signOut.length, 1);
  const stale = fakeClients({ signOut: async () => ({ error: { message: 'invalid JWT' } }) });
  const done = await call(stale.api.logout, { authorization: `Bearer ${TOKEN}` });
  assert.deepEqual([done.code, done.payload], [200, { ok: true, revoked: false }], '이미 무효인 토큰도 로그아웃은 성공으로 본다');
});
