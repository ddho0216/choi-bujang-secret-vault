import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { decide, RULE_IDS } from '../src/decider.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { normal, suspicious } = fixtureRequests();
const RESPONSE_KEYS = 'decision,reasonCode,requestId,ruleIds,schema';

// 판정 요청: service·method·path·route 만 바꿔 가며 본다. 기기는 등록되어 있고 평소 접속이다.
const request = (method, path, { service, route, ...extra } = {}) => {
  const resource = path.replace(/^\/api/u, '').split('/')[1];
  const template = path.replace(/^\/api/u, '').split('/').length > 2 ? `/${resource}/:id` : `/${resource}`;
  return { ...normal, requestId: randomUUID(), method, path, service: service ?? resource, route: route ?? `${method} ${template}`, ...extra };
};
const run = async input => {
  const response = await decide(input);
  assert.equal(Object.keys(response).sort().join(','), RESPONSE_KEYS);
  assert.equal(response.requestId, input.requestId);
  assert.ok(response.ruleIds.length > 0 && response.ruleIds.every(id => RULE_IDS.includes(id)), JSON.stringify(response.ruleIds));
  return response;
};
const verdict = async input => { const r = await run(input); return `${r.decision}/${r.reasonCode}`; };
const ALLOW = 'allow/approved';
const DENY = 'deny/resource_not_allowed';

test('메모: 자료 ID 하나를 고르는 경로는 허용(읽기·수정·삭제), 전체 목록과 추가는 거부', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal(await verdict(request(method, '/notes/demo')), ALLOW, method);
  assert.equal(await verdict(request('GET', '/notes')), DENY, '전체 목록');
  assert.equal(await verdict(request('POST', '/notes')), DENY, '추가(ID 없는 경로)');
  for (const method of ['PATCH', 'HEAD', 'OPTIONS', 'POST']) assert.equal(await verdict(request(method, '/notes/demo')), DENY, `${method} /notes/:id`);
  const own = await run(request('GET', '/notes/demo'));
  assert.deepEqual([own.decision, own.ruleIds], ['allow', ['device_registered', 'resource_zone']]);
});

test('자료 ID 형식은 좁히지 않는다: UUID 가 아니어도 허용한다', async () => {
  for (const id of ['demo', '123', 'not-a-uuid', 'note-01', '한글', 'export', randomUUID(), 'x'.repeat(200)]) {
    assert.equal(await verdict(request('GET', `/notes/${id}`)), ALLOW, id);
  }
});

test('반 공지: 읽기만 허용하고 쓰기는 누구에게나 거부한다', async () => {
  assert.equal(await verdict(request('GET', '/notices')), ALLOW);
  assert.equal(await verdict(request('GET', '/notices/n-1')), ALLOW);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(await verdict(request(method, '/notices')), DENY, `${method} /notices`);
    assert.equal(await verdict(request(method, '/notices/n-1')), DENY, `${method} /notices/:id`);
  }
  // 역할을 담아 보내도 판정기는 읽지 않는다(판정 요청에는 역할이 없다).
  assert.equal(await verdict(request('PUT', '/notices/n-1', { role: 'instructor', identity: { instructor: true }, device: { approval: true } })), DENY);
});

test('강사 자료: 판정기에서는 어떤 요청도 거부한다', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['/instructor', '/instructor/m-1', '/instructor/m-1/files/a']) {
      assert.equal(await verdict(request(method, path, { route: `${method} ${path}` })), DENY, `${method} ${path}`);
    }
  }
  const confirmed = request('GET', '/instructor/m-1', { route: 'GET /instructor/:id', stepUp: { verified: true, authAgeSeconds: 10 } });
  assert.equal(await verdict(confirmed), DENY, '다시 확인한 요청이어도 거부');
});

test('알 수 없는 경로·서비스·모양은 거부한다', async () => {
  for (const path of ['/unknown', '/unknown/x', '/admin/notices', '/notes/', '/notes//x', '/notes/..', '/notes/./x', '/NOTES/x', '/notes/a/b', '/notes/a/export', '/']) {
    assert.equal(await verdict(request('GET', path, { service: 'notes', route: 'GET /notes/:id' })), DENY, path);
  }
  assert.equal(await verdict({ ...request('GET', '/notes/demo'), path: undefined }), DENY, '경로 없음');
  assert.equal(await verdict({ ...request('GET', '/notes/demo'), service: 'other' }), DENY, '서비스가 구역과 다름');
  assert.equal(await verdict({ ...request('GET', '/notes/demo'), service: 'notices' }), DENY, '다른 구역의 서비스 이름');
  assert.equal(await verdict({ ...request('GET', '/notes/demo'), route: undefined }), DENY, 'route 없음');
  assert.equal(await verdict({ ...request('GET', '/notes/demo'), route: 'GET /notes' }), DENY, 'route 와 경로 모양이 다름');
  assert.equal(await verdict({ ...request('GET', '/notes/demo'), route: 'POST /notes/:id' }), DENY, 'route 의 메서드가 다름');
  assert.equal(await verdict({ ...request('GET', '/notes/demo'), method: 'get', route: 'get /notes/:id' }), DENY, '메서드는 대문자만');
  assert.equal(await verdict({ ...request('GET', '/notes/demo'), method: undefined }), DENY, '메서드 없음');
});

test('/api 가 붙은 경로와 route 도 같은 모양으로 본다', async () => {
  assert.equal(await verdict(request('GET', '/api/notes/demo', { route: 'GET /api/notes/:id' })), ALLOW);
  assert.equal(await verdict(request('GET', '/api/notes/demo', { route: 'GET /notes/:id' })), ALLOW);
  assert.equal(await verdict(request('GET', '/notes/demo', { route: 'GET /api/notes/:id' })), ALLOW);
  assert.equal(await verdict(request('GET', '/api/notes', { route: 'GET /api/notes' })), DENY, '/api 가 있어도 목록은 거부');
});

test('쿼리는 판정에 쓰지 않는다: 길이와 지문이 달라도 같은 판정', async () => {
  const base = request('GET', '/notes/demo');
  for (const extra of [{ queryLength: 0 }, { queryLength: 9999, querySha256: 'f'.repeat(64) }, { queryLength: 3, querySha256: 'a'.repeat(64) }]) {
    assert.equal(await verdict({ ...base, ...extra }), ALLOW);
  }
  assert.equal(await verdict({ ...request('GET', '/notes'), queryLength: 5 }), DENY, '쿼리를 붙여도 목록은 거부');
});

test('이전 규칙은 유지한다: 기기 규칙이 먼저, 구역 거부가 복합 이상보다 먼저', async () => {
  const unregistered = await run(request('GET', '/notes/demo', { deviceRegistered: false }));
  assert.deepEqual([unregistered.decision, unregistered.reasonCode, unregistered.ruleIds], ['deny', 'device_not_registered', ['device_registered']]);
  const unregisteredOtherZone = await run(request('GET', '/instructor/x', { route: 'GET /instructor/:id', deviceRegistered: false }));
  assert.equal(unregisteredOtherZone.reasonCode, 'device_not_registered', '기기 규칙이 구역보다 먼저');
  const flaggedInDeniedZone = await run({ ...suspicious, requestId: randomUUID(), method: 'GET', path: '/notes', service: 'notes', route: 'GET /notes' });
  assert.deepEqual([flaggedInDeniedZone.decision, flaggedInDeniedZone.reasonCode], ['deny', 'resource_not_allowed'], '막힌 구역은 추가 확인으로 보내지 않는다');
  const flagged = await run(suspicious);
  assert.deepEqual([flagged.decision, flagged.reasonCode], ['step_up', 'step_up_required'], '허용 구역의 복합 이상은 step_up');
  const confirmed = await run({ ...suspicious, requestId: randomUUID(), stepUp: { verified: true, authAgeSeconds: 60 } });
  assert.deepEqual([confirmed.decision, confirmed.ruleIds], ['allow', ['device_registered', 'resource_zone', 'step_up_required']]);
});

test('어떤 입력에도 던지지 않고 응답 다섯 항목을 지킨다', async () => {
  for (const input of [undefined, null, 'x', 5, [], {}, { requestId: 'r', deviceRegistered: true }, { requestId: 'r', deviceRegistered: true, path: 5, service: 5, route: 5, method: 5 },
    { requestId: 'r', deviceRegistered: true, path: '/notes/a', service: 'notes', route: ['GET /notes/:id'], method: 'GET' }]) {
    const response = await decide(input);
    assert.equal(Object.keys(response).sort().join(','), RESPONSE_KEYS);
    assert.ok(response.ruleIds.every(id => RULE_IDS.includes(id)));
  }
});

test('aleph.config.json 의 allowedRoutes 는 판정기가 허용하는 경로이고, 판정기와 같은 판정이 나온다', async () => {
  const config = JSON.parse(await readFile(join(root, 'aleph.config.json'), 'utf8'));
  assert.deepEqual(config.allowedRoutes, ['GET /api/notes/:id', 'PUT /api/notes/:id', 'DELETE /api/notes/:id']);
  for (const entry of config.allowedRoutes) {
    const [method, template] = entry.split(' ');
    const input = request(method, template.replace(':id', 'demo'), { route: entry });
    assert.equal(await verdict(input), ALLOW, entry);
  }
  for (const entry of ['GET /api/notes', 'POST /api/notes']) {
    const [method, path] = entry.split(' ');
    assert.equal(await verdict(request(method, path, { route: entry })), DENY, `${entry} 는 판정기가 거부하므로 목록에 없다`);
    assert.equal(config.allowedRoutes.includes(entry), false);
  }
});
