import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createNotesApi } from '../src/notes-api.mjs';
import { createZonesApi } from '../src/zones-api.mjs';

const A = { userId: '11111111-1111-4111-8111-111111111111' };
const B = { userId: '22222222-2222-4222-8222-222222222222' };
const NOTE_ID = '123e4567-e89b-12d3-a456-426614174000';

let currentUser = A;
const verifier = async authorization => (authorization === 'Bearer ok' ? currentUser : null);

// 실제 Supabase 대신 메모리에 저장하는 가짜 표(소유자 열 포함).
function fakeSupabase() {
  const rows = [];
  const filtered = state => rows.filter(row => state.filters.every(([c, v]) => row[c] === v));
  const query = state => {
    const q = {
      select() { return q; },
      eq(column, value) { state.filters.push([column, value]); return q; },
      order() { return q; },
      maybeSingle() { return Promise.resolve({ data: filtered(state)[0] ?? null, error: null }); },
      then(resolve, reject) {
        const hit = filtered(state);
        if (state.kind === 'update') hit.forEach(row => Object.assign(row, state.values));
        if (state.kind === 'delete') hit.forEach(row => rows.splice(rows.indexOf(row), 1));
        return Promise.resolve({ data: hit, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return {
    rows,
    from: () => ({
      select: () => query({ kind: 'select', filters: [] }),
      update: values => query({ kind: 'update', filters: [], values }),
      delete: () => query({ kind: 'delete', filters: [] }),
      insert: async row => { rows.push({ ...row, created_at: rows.length }); return { error: null }; },
    }),
  };
}

const fakeResponse = () => ({
  headers: {}, status(code) { this.code = code; return this; },
  setHeader(name, value) { this.headers[name] = value; }, json(payload) { this.payload = payload; return this; },
});
const call = async (handle, { method = 'GET', url, body, auth = 'Bearer ok' } = {}, id) => {
  const response = fakeResponse();
  await handle({ method, url, body, headers: { authorization: auth } }, response, id);
  return response;
};

// ── 제작 3: 메모 밖 구역과 알 수 없는 경로는 직접 API 요청에서도 자료가 나오지 않는다 ──────────
const zones = () => {
  const logs = [];
  return { logs, handle: createZonesApi({ verifier, log: entry => logs.push(entry) }) };
};

test('다른 구역(강사 자료)은 모든 메서드에서 403 이고 자료가 없다', async () => {
  const { handle, logs } = zones();
  currentUser = A;
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const url of ['/api/instructor', '/api/instructor/m-1', '/api/instructor/m-1/files/a?x=1']) {
      const response = await call(handle, { method, url, body: { role: 'instructor' } });
      assert.equal(response.code, 403, `${method} ${url}`);
      assert.deepEqual(response.payload, { error: 'FORBIDDEN', reason: 'instructor_only' });
    }
  }
  assert.ok(logs.length === 15 && logs.every(entry => entry.event === 'deny' && entry.reason === 'instructor_only'));
});

test('반 공지: 데이터가 없어 읽기는 404, 쓰기는 누구에게나 403', async () => {
  const { handle } = zones();
  currentUser = A;
  for (const url of ['/api/notices', '/api/notices/n-1']) {
    const read = await call(handle, { url });
    assert.deepEqual([read.code, read.payload], [404, { error: 'NOT_FOUND', reason: 'no_notice_data' }], url);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const write = await call(handle, { method, url, body: { role: 'instructor', isInstructor: true } });
      assert.deepEqual([write.code, write.payload], [403, { error: 'FORBIDDEN', reason: 'notice_write_admin_only' }], `${method} ${url}`);
    }
  }
});

test('알 수 없는 경로와 메모 경로의 이상한 모양은 404 JSON, 로그인하지 않으면 401', async () => {
  const { handle } = zones();
  currentUser = A;
  for (const url of ['/api/unknown', '/api/admin/notices', '/api/notes/a/b', '/api/notes/a/export', '/api/notes/..', '/api/', '/api', '/other']) {
    const response = await call(handle, { url });
    assert.deepEqual([response.code, response.payload.error, response.payload.reason], [404, 'NOT_FOUND', 'unknown_route'], url);
  }
  for (const url of ['/api/instructor/x', '/api/notices', '/api/unknown']) {
    const anonymous = await call(handle, { url, auth: null });
    assert.deepEqual([anonymous.code, anonymous.payload.error], [401, 'UNAUTHENTICATED'], url);
    assert.equal(anonymous.headers['WWW-Authenticate'], 'Bearer');
  }
});

test('모든 응답에 자원 ID 가 붙고, 어떤 응답에도 자료 본문이 없다', async () => {
  const { handle } = zones();
  currentUser = A;
  const cases = [['/api/instructor/m-1', 'instructor_material:m-1'], ['/api/notices', 'class_notice:*'], ['/api/notices/n-1', 'class_notice:n-1'], ['/api/unknown', 'unknown']];
  for (const [url, resourceId] of cases) {
    const response = await call(handle, { url });
    assert.equal(response.headers['X-Resource-Id'], resourceId, url);
    assert.deepEqual(Object.keys(response.payload).sort(), ['error', 'reason']);
  }
});

// ── 메모 API: 본인 정상 요청은 유지되고, 요청 본문의 role 은 믿지 않는다 ───────────────────────
const memo = () => {
  const supabase = fakeSupabase();
  const logs = [];
  return { supabase, logs, handle: createNotesApi({ verifier, supabase, log: entry => logs.push(entry) }) };
};

test('본인 정상 요청은 그대로 된다(읽기·추가·수정·삭제)', async () => {
  const { handle, logs } = memo();
  currentUser = A;
  const created = await call(handle, { method: 'POST', body: { id: NOTE_ID, title: '제목', body: '본문' } });
  assert.deepEqual([created.code, created.payload], [201, { id: NOTE_ID }]);
  assert.deepEqual((await call(handle, {}, NOTE_ID)).payload, { id: NOTE_ID, title: '제목', body: '본문' });
  assert.equal((await call(handle, { method: 'PUT', body: { title: '새 제목', body: '새 본문' } }, NOTE_ID)).code, 200);
  assert.equal((await call(handle, { method: 'GET' })).payload.length, 1);
  assert.equal((await call(handle, { method: 'DELETE' }, NOTE_ID)).code, 200);
  assert.equal(logs.length, 0, '정상 요청은 거부 기록을 남기지 않는다');
});

test('다른 사람의 메모는 직접 API 요청으로도 읽거나 고치거나 지울 수 없고, 사유가 기록된다', async () => {
  const { handle, logs, supabase } = memo();
  currentUser = A;
  await call(handle, { method: 'POST', body: { id: NOTE_ID, title: 'A의 메모', body: 'A만 볼 수 있다' } });
  currentUser = B;
  for (const [method, body] of [['GET'], ['PUT', { title: 'B가 고침', body: 'x' }], ['DELETE']]) {
    const response = await call(handle, { method, body }, NOTE_ID);
    assert.equal(response.code, 404, method);
    assert.equal(JSON.stringify(response.payload).includes('A의 메모'), false, '응답에 A의 내용이 새지 않는다');
  }
  assert.deepEqual((await call(handle, { method: 'GET' })).payload, [], 'B의 목록에는 A의 메모가 없다');
  assert.deepEqual(logs.map(entry => entry.reason), ['not_found_or_not_owner', 'not_found_or_not_owner', 'not_found_or_not_owner']);
  assert.ok(logs.every(entry => entry.event === 'deny' && entry.status === 404 && entry.resource === `memo:${NOTE_ID}`));
  assert.equal(supabase.rows[0].title, 'A의 메모', '메모는 그대로');
});

test('요청 본문의 role·강사 표시는 믿지 않고 403 으로 거부하며 사유를 남긴다', async () => {
  const { handle, logs, supabase } = memo();
  currentUser = A;
  await call(handle, { method: 'POST', body: { id: NOTE_ID, title: '제목', body: '본문' } });
  for (const claim of [{ role: 'instructor' }, { roles: ['instructor'] }, { isInstructor: true }, { is_instructor: true }, { admin: true }, { isAdmin: true }]) {
    const create = await call(handle, { method: 'POST', body: { title: 't', body: 'b', ...claim } });
    assert.deepEqual([create.code, create.payload], [403, { error: 'ROLE_CLAIM_REJECTED' }], JSON.stringify(claim));
    const update = await call(handle, { method: 'PUT', body: { title: 'x', body: 'y', ...claim } }, NOTE_ID);
    assert.deepEqual([update.code, update.payload], [403, { error: 'ROLE_CLAIM_REJECTED' }], JSON.stringify(claim));
  }
  assert.equal(supabase.rows.length, 1, '거부된 추가는 저장되지 않았다');
  assert.equal(supabase.rows[0].title, '제목', '거부된 수정은 내용을 바꾸지 않았다');
  assert.ok(logs.length === 12 && logs.every(entry => entry.reason === 'role_claim_in_body'));
  assert.equal(JSON.stringify(logs).includes('instructor'), false, '요청 본문의 값은 로그에 쓰지 않는다');
});

test('로그인하지 않은 요청과 소유자 변경 시도와 허용하지 않는 메서드도 사유를 남긴다', async () => {
  const { handle, logs } = memo();
  currentUser = A;
  await call(handle, { method: 'POST', body: { id: NOTE_ID, title: '제목', body: '본문' } });
  assert.equal((await call(handle, { auth: null })).code, 401);
  assert.equal((await call(handle, { method: 'PUT', body: { title: 'x', body: 'y', owner_id: B.userId } }, NOTE_ID)).code, 403);
  assert.equal((await call(handle, { method: 'PATCH' }, NOTE_ID)).code, 405);
  assert.equal((await call(handle, { method: 'GET' }, 'not-a-uuid')).code, 404);
  assert.deepEqual(logs.map(entry => entry.reason), ['no_valid_login', 'owner_change', 'method_not_allowed', 'invalid_id']);
  assert.equal(logs.some(entry => 'userId' in entry || 'token' in entry || 'body' in entry), false);
});

test('다른 구역을 JSON 으로 거부하는 서버 함수 파일이 한 단계부터 네 단계까지 있고, 모두 같은 함수를 쓴다', async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const shared = (await import('../src/zones-function.mjs')).default;
  assert.equal(typeof shared, 'function');
  for (const file of ['api/[zone].js', 'api/[zone]/[id].js', 'api/[zone]/[id]/[a].js', 'api/[zone]/[id]/[a]/[b].js']) {
    const loaded = await import(pathToFileURL(join(root, file)).href);
    assert.equal(loaded.default, shared, file);
  }
});
