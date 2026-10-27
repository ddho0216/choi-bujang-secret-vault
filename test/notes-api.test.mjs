import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotesApi } from '../src/notes-api.mjs';

const A = { userId: '11111111-1111-4111-8111-111111111111' };
const B = { userId: '22222222-2222-4222-8222-222222222222' };

// 실제 Supabase 대신 메모리에 저장하는 가짜 표. 질의 모양(select/insert/update/delete)만 흉내 낸다.
function fakeSupabase() {
  const rows = [];
  const query = (state) => {
    const q = {
      select(columns) { state.select = columns; return q; },
      eq(column, value) { state.filters.push([column, value]); return q; },
      order() { return q; },
      maybeSingle() { return Promise.resolve({ data: run(state)[0] ?? null, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: run(state), error: state.error ?? null }).then(resolve, reject); },
    };
    return q;
  };
  const matches = (state) => rows.filter(row => state.filters.every(([c, v]) => row[c] === v));
  const run = (state) => {
    if (state.kind === 'select') return matches(state);
    if (state.kind === 'update') { const hit = matches(state); hit.forEach(r => Object.assign(r, state.values)); return hit; }
    const hit = matches(state);
    hit.forEach(r => rows.splice(rows.indexOf(r), 1));
    return hit;
  };
  return {
    rows,
    from() {
      return {
        select: columns => query({ kind: 'select', filters: [], select: columns }),
        update: values => query({ kind: 'update', filters: [], values }),
        delete: () => query({ kind: 'delete', filters: [] }),
        insert: async row => {
          if (rows.some(r => r.id === row.id)) return { error: { code: '23505' } };
          rows.push({ ...row, created_at: rows.length });
          return { error: null };
        },
      };
    },
  };
}

function call(api, method, { id, body, user = A } = {}) {
  const response = {
    headers: {}, status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(payload) { this.payload = payload; return this; },
  };
  const request = { method, body, headers: { authorization: user ? 'Bearer test' : undefined } };
  return api(request, response, id).then(() => response);
}

const verifier = async (authorization) => (authorization === 'Bearer test' ? currentUser : null);
let currentUser = A;

test('로그인하지 않은 요청은 모든 메서드에서 401로 거부된다', async () => {
  const api = createNotesApi({ verifier, supabase: fakeSupabase() });
  for (const [method, id] of [['GET'], ['POST'], ['GET', 'x'], ['PUT', 'x'], ['DELETE', 'x']]) {
    const response = await call(api, method, { id, user: null, body: { title: 't', body: 'b' } });
    assert.equal(response.code, 401, `${method} ${id ?? ''}`);
  }
});

test('A가 메모를 추가·조회·수정·삭제하고, 지운 뒤 GET은 404', async () => {
  const supabase = fakeSupabase();
  const api = createNotesApi({ verifier, supabase });
  currentUser = A;
  const created = await call(api, 'POST', { body: { title: '제목', body: '본문' } });
  assert.equal(created.code, 201);
  const { id } = created.payload;
  assert.match(id, /^[0-9a-f-]{36}$/u);
  assert.equal(supabase.rows[0].owner_id, A.userId, '서버가 확인한 사용자 ID가 owner_id로 저장된다');

  assert.deepEqual((await call(api, 'GET', { id })).payload, { id, title: '제목', body: '본문' });
  assert.deepEqual((await call(api, 'GET')).payload, [{ id, title: '제목', body: '본문' }]);

  const updated = await call(api, 'PUT', { id, body: { title: '새 제목', body: '새 본문' } });
  assert.deepEqual(updated.payload, { id, title: '새 제목', body: '새 본문' });

  assert.equal((await call(api, 'DELETE', { id })).code, 200);
  assert.equal((await call(api, 'GET', { id })).code, 404);
  assert.equal((await call(api, 'PUT', { id, body: { title: 't', body: 'b' } })).code, 404);
});

test('클라이언트가 준 id를 쓰고, 중복 id와 잘못된 입력은 거부된다', async () => {
  const api = createNotesApi({ verifier, supabase: fakeSupabase() });
  currentUser = A;
  const id = '33333333-3333-4333-8333-333333333333';
  assert.deepEqual((await call(api, 'POST', { body: { id, title: 't', body: 'b' } })).payload, { id });
  assert.equal((await call(api, 'POST', { body: { id, title: 't', body: 'b' } })).code, 409);
  assert.equal((await call(api, 'POST', { body: { id: 'not-a-uuid', title: 't', body: 'b' } })).code, 400);
  assert.equal((await call(api, 'POST', { body: { title: '', body: 'b' } })).code, 400);
  assert.equal((await call(api, 'POST', { body: { title: 't', body: 5 } })).code, 400);
  assert.equal((await call(api, 'GET', { id: 'not-a-uuid' })).code, 404);
});

test('B는 A의 메모를 읽거나 고치거나 지울 수 없고, A의 메모는 그대로 남는다', async () => {
  const supabase = fakeSupabase();
  const api = createNotesApi({ verifier, supabase });
  currentUser = A;
  const { id } = (await call(api, 'POST', { body: { title: 'A의 메모', body: 'A' } })).payload;

  currentUser = B;
  const read = await call(api, 'GET', { id });
  assert.equal(read.code, 404, 'B의 읽기는 없는 메모와 똑같이 거부된다');
  assert.equal(JSON.stringify(read.payload).includes('A의 메모'), false, '응답에 A의 내용이 새지 않는다');
  assert.equal((await call(api, 'PUT', { id, body: { title: 'B가 고침', body: 'B' } })).code, 404);
  assert.equal((await call(api, 'DELETE', { id })).code, 404);
  assert.deepEqual((await call(api, 'GET')).payload, [], 'B의 목록에는 A의 메모가 없다');

  currentUser = A;
  assert.deepEqual((await call(api, 'GET', { id })).payload, { id, title: 'A의 메모', body: 'A' },
    'B의 시도 뒤에도 A의 메모는 바뀌지 않았다');
});

test('A와 B는 각자 자기 메모의 읽기·추가·수정·삭제를 유지한다', async () => {
  const api = createNotesApi({ verifier, supabase: fakeSupabase() });
  for (const user of [A, B]) {
    currentUser = user;
    const { id } = (await call(api, 'POST', { body: { title: '내 메모', body: '본문' } })).payload;
    assert.equal((await call(api, 'GET', { id })).code, 200);
    assert.equal((await call(api, 'PUT', { id, body: { title: '수정', body: '새 본문' } })).code, 200);
    assert.equal((await call(api, 'GET')).payload.length, 1);
    assert.equal((await call(api, 'DELETE', { id })).code, 200);
    assert.equal((await call(api, 'GET', { id })).code, 404);
  }
});

test('본문의 owner_id는 믿지 않는다: 추가는 확인된 ID로 저장, 수정에서 소유자 변경은 거부', async () => {
  const supabase = fakeSupabase();
  const api = createNotesApi({ verifier, supabase });
  currentUser = A;
  const created = await call(api, 'POST', { body: { title: 't', body: 'b', owner_id: B.userId } });
  assert.equal(created.code, 201);
  assert.equal(supabase.rows[0].owner_id, A.userId, '본문이 B를 말해도 A로 저장된다');
  const { id } = created.payload;

  for (const field of ['owner_id', 'ownerId']) {
    const change = await call(api, 'PUT', { id, body: { title: 'x', body: 'y', [field]: B.userId } });
    assert.equal(change.code, 403, field);
  }
  assert.equal(supabase.rows[0].owner_id, A.userId, '소유자는 바뀌지 않았다');
  assert.equal(supabase.rows[0].title, 't', '거부된 수정은 내용도 바꾸지 않았다');
  const same = await call(api, 'PUT', { id, body: { title: 'x', body: 'y', owner_id: A.userId } });
  assert.equal(same.code, 200, '내 ID를 적는 것은 허용되지만 값은 쓰지 않는다');
});
