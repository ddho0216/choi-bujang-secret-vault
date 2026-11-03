import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRestoreApi, memoContentHash, RESTORE_TEST_MEMO } from '../src/restore-api.mjs';

const A = { userId: '11111111-1111-4111-8111-111111111111' };
const B = { userId: '22222222-2222-4222-8222-222222222222' };
const ID = RESTORE_TEST_MEMO.id;

// 실제 Supabase 대신 표 이름별로 메모리에 저장하는 가짜. 질의 모양만 흉내 낸다.
function fakeSupabase(tables) {
  const query = (rows, state) => {
    const matches = () => rows.filter(row => state.filters.every(([c, v]) => row[c] === v));
    const q = {
      select() { return q; },
      eq(column, value) { state.filters.push([column, value]); return q; },
      maybeSingle() { return Promise.resolve({ data: matches()[0] ?? null, error: null }); },
      then(resolve, reject) {
        const hit = matches();
        if (state.kind === 'delete') hit.forEach(row => rows.splice(rows.indexOf(row), 1));
        return Promise.resolve({ data: hit, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return {
    from(name) {
      const rows = tables[name];
      return {
        select: () => query(rows, { kind: 'select', filters: [] }),
        delete: () => query(rows, { kind: 'delete', filters: [] }),
        insert: async row => {
          if (rows.some(r => r.id === row.id)) return { error: { code: '23505' } };
          rows.push({ ...row });
          return { error: null };
        },
      };
    },
  };
}

const backupOf = (owner, memo = RESTORE_TEST_MEMO) => ({ id: memo.id, owner_id: owner.userId, title: memo.title, content: memo.content, content_hash: memoContentHash(memo) });
const noteOf = (owner, id, title = '다른 메모') => ({ id, owner_id: owner.userId, title, content: '본문' });

let currentUser = B;
const verifier = async authorization => (authorization === 'Bearer test' ? currentUser : null);
function setup({ notes = [], backups = [backupOf(B)] } = {}) {
  const tables = { notes, notes_backup: backups };
  const logs = [];
  return { tables, logs, api: createRestoreApi({ verifier, supabase: fakeSupabase(tables), log: entry => logs.push(entry) }) };
}
function call(api, method, body, { user = B, signedIn = true } = {}) {
  currentUser = user;
  const response = {
    headers: {}, status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(payload) { this.payload = payload; return this; },
  };
  return api({ method, body, headers: { authorization: signedIn ? 'Bearer test' : undefined } }, response).then(() => response);
}

test('본인 메모 한 건만 되살리고, 다른 메모는 그대로 두며, 해시를 다시 확인한다', async () => {
  const other = noteOf(B, '99999999-9999-4999-8999-999999999999');
  const mine = noteOf(A, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A의 메모');
  const { api, tables, logs } = setup({ notes: [other, mine], backups: [backupOf(B), backupOf(A, { ...RESTORE_TEST_MEMO, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })] });
  const response = await call(api, 'POST', { id: ID });
  assert.equal(response.code, 201);
  assert.deepEqual(response.payload, { id: ID, restored: true, contentHash: memoContentHash(RESTORE_TEST_MEMO) });
  assert.equal(response.headers['X-Resource-Id'], `memo:${ID}`);
  assert.equal(tables.notes.length, 3);
  assert.deepEqual(tables.notes.find(row => row.id === ID), { id: ID, owner_id: B.userId, title: RESTORE_TEST_MEMO.title, content: RESTORE_TEST_MEMO.content });
  assert.deepEqual(tables.notes.filter(row => row.id !== ID), [other, mine], '다른 메모는 그대로');
  assert.equal(tables.notes_backup.length, 2, '백업은 지우지 않는다');
  assert.equal(logs.at(-1).event, 'restore');
  assert.ok(!JSON.stringify(logs).includes(RESTORE_TEST_MEMO.content), '로그에 본문을 남기지 않는다');
});

test('로그인하지 않았거나 POST 가 아니면 거부한다', async () => {
  const { api, tables } = setup();
  assert.equal((await call(api, 'POST', { id: ID }, { signedIn: false })).code, 401);
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await call(api, method, { id: ID })).code, 405, method);
  assert.equal(tables.notes.length, 0);
});

test('남의 백업은 없는 백업과 똑같이 404 이고 아무것도 넣지 않는다', async () => {
  const { api, tables } = setup({ backups: [backupOf(B)] });
  const stranger = await call(api, 'POST', { id: ID }, { user: A });
  assert.equal(stranger.code, 404);
  assert.deepEqual(stranger.payload, (await call(api, 'POST', { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, { user: A })).payload);
  assert.equal(tables.notes.length, 0);
});

test('역할·소유자 표시나 이상한 ID 는 거부한다', async () => {
  const { api, tables } = setup();
  for (const extra of [{ role: 'instructor' }, { isAdmin: true }, { owner_id: A.userId }, { ownerId: B.userId }]) {
    assert.equal((await call(api, 'POST', { id: ID, ...extra })).code, 403, JSON.stringify(extra));
  }
  for (const body of [{}, { id: 5 }, { id: 'not-a-uuid' }, { id: `${ID}/../x` }, null, 'x']) {
    assert.equal((await call(api, 'POST', body)).code, 400, JSON.stringify(body));
  }
  assert.equal(tables.notes.length, 0);
});

test('같은 ID 의 메모가 이미 있으면 덮어쓰지 않고 409 로 멈춘다', async () => {
  const existing = { id: ID, owner_id: B.userId, title: '바뀐 제목', content: '바뀐 본문' };
  const { api, tables } = setup({ notes: [existing] });
  const response = await call(api, 'POST', { id: ID });
  assert.equal(response.code, 409);
  assert.equal(response.payload.error, 'ALREADY_EXISTS');
  assert.deepEqual(tables.notes, [{ ...existing }], '기존 메모는 그대로');
});

test('백업 내용이 해시와 다르면(변조·손상) 복원하지 않는다', async () => {
  const bad = { ...backupOf(B), content: '몰래 바뀐 본문' };
  const { api, tables } = setup({ backups: [bad] });
  const response = await call(api, 'POST', { id: ID });
  assert.equal(response.code, 409);
  assert.equal(response.payload.error, 'BACKUP_CORRUPT');
  assert.equal(tables.notes.length, 0);
});

test('해시는 id·제목·본문이 달라지면 달라진다', () => {
  const base = memoContentHash(RESTORE_TEST_MEMO);
  assert.match(base, /^[0-9a-f]{64}$/u);
  for (const change of [{ id: 'x' }, { title: 'x' }, { content: 'x' }]) assert.notEqual(memoContentHash({ ...RESTORE_TEST_MEMO, ...change }), base);
});
