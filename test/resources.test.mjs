import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCE_ZONES, resourceFor } from '../src/decider.mjs';
import { createNotesApi, memoResourceId } from '../src/notes-api.mjs';

// ── 제작 1: 메모·반 공지·강사 자료는 서로 다른 자원 ID 를 가진다 ────────────────
test('메모, 반 공지, 강사 자료는 종류가 앞에 붙은 서로 다른 자원 ID 를 가진다', () => {
  assert.deepEqual(Object.keys(RESOURCE_ZONES), ['memo', 'class_notice', 'instructor_material']);
  const memo = resourceFor('/api/notes/abc');
  const notice = resourceFor('/api/notices/abc');
  const material = resourceFor('/api/instructor/abc');
  assert.deepEqual([memo.resourceId, notice.resourceId, material.resourceId], ['memo:abc', 'class_notice:abc', 'instructor_material:abc']);
  assert.equal(new Set([memo.resourceId, notice.resourceId, material.resourceId]).size, 3, '같은 ID 여도 구역이 다르면 자원 ID 가 다르다');
  assert.deepEqual([memo.zone, notice.zone, material.zone], ['memo', 'class_notice', 'instructor_material']);
});

test('지금 서버가 내주는 모든 경로에 자원 ID 가 있다(목록은 <종류>:*)', () => {
  const served = [['/api/notes', 'memo:*', '/notes'], ['/api/notes/123e4567-e89b-12d3-a456-426614174000', 'memo:123e4567-e89b-12d3-a456-426614174000', '/notes/:id']];
  for (const [path, resourceId, template] of served) {
    const resource = resourceFor(path);
    assert.equal(resource.resourceId, resourceId, path);
    assert.equal(resource.template, template, path);
  }
  assert.equal(resourceFor('/notes/demo').resourceId, 'memo:demo', '/api 가 없는 판정 요청의 경로도 같은 자원이다');
  assert.equal(resourceFor('/notices').resourceId, 'class_notice:*');
  assert.equal(resourceFor('/instructor/a/b/c').resourceId, 'instructor_material:a');
  assert.equal(resourceFor('/instructor/a/b/c').template, '/instructor/:id/*');
});

test('자료 ID 형식은 좁히지 않는다: UUID 가 아니어도 그대로 자원 ID 가 된다', () => {
  for (const id of ['demo', '123', 'note-01', '한글', 'a b', 'export', 'x'.repeat(200)]) {
    assert.equal(resourceFor(`/notes/${id}`).resourceId, `memo:${id}`, id);
  }
});

test('모양이 이상한 경로는 자원으로 보지 않는다', () => {
  for (const path of [undefined, null, 5, '', 'notes', '/', '/api', '/api/', '//notes', '/notes//x', '/notes/', '/notes/..', '/notes/./x',
    '/notes/../x', '/NOTES/x', '/Notes', '/unknown/x', '/api/api/notes', '/notes?x=1', '/notes/a?x=1', '/notes/a#b', '/notes\\x', '/notes/\u0000',
    '/notes/x\n', `/notes/${'x'.repeat(201)}`, `/${'a'.repeat(601)}`]) {
    assert.equal(resourceFor(path), null, JSON.stringify(path));
  }
});

test('서버 API 는 요청마다 X-Resource-Id 를 붙인다(로그인하지 않은 요청과 거부된 요청도)', async () => {
  const verifier = async authorization => (authorization === 'Bearer ok' ? { userId: '11111111-1111-4111-8111-111111111111' } : null);
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }), order: async () => ({ data: [], error: null }) }) }) }) };
  const api = createNotesApi({ log: () => {}, verifier, supabase });
  const call = async (id, authorization) => {
    const response = { headers: {}, status(code) { this.code = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json() { return this; } };
    await api({ method: 'GET', headers: { authorization } }, response, id);
    return response;
  };
  const anonymousList = await call(undefined, undefined);
  assert.deepEqual([anonymousList.code, anonymousList.headers['X-Resource-Id']], [401, 'memo:*']);
  const anonymousItem = await call('abc-1', undefined);
  assert.deepEqual([anonymousItem.code, anonymousItem.headers['X-Resource-Id']], [401, 'memo:abc-1']);
  const missing = await call('123e4567-e89b-12d3-a456-426614174000', 'Bearer ok');
  assert.deepEqual([missing.code, missing.headers['X-Resource-Id']], [404, 'memo:123e4567-e89b-12d3-a456-426614174000']);
  assert.equal((await call('', 'Bearer ok')).headers['X-Resource-Id'], 'memo:invalid', '빈 ID');
  assert.equal(memoResourceId('a/b'), 'memo:invalid', '안전하지 않은 글자는 그대로 내보내지 않는다');
  assert.equal(memoResourceId('x'.repeat(101)), 'memo:invalid');
});
