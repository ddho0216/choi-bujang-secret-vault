import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRows, toMarkdown } from '../scripts/ops-table.mjs';

const json = (status, body = { error: 'UNAUTHENTICATED' }, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-vercel-id': 'icn1::req-1', ...headers } });
// 기대대로 답하는 가짜 서버(진짜 서버가 아니다): 보호 경로는 401 JSON, 화면·manifest 는 200, /data.json 은 404.
function healthyFetch(url, init = {}) {
  const { pathname } = new URL(url);
  if (pathname === '/') return Promise.resolve(new Response('<html>첫 화면</html>', { status: 200, headers: { 'content-type': 'text/html', 'x-vercel-id': 'icn1::home' } }));
  if (pathname === '/data.json') return Promise.resolve(new Response('not found', { status: 404, headers: { 'x-vercel-id': 'icn1::nf' } }));
  if (pathname === '/manifest.webmanifest') return Promise.resolve(json(200, { name: '앱' }));
  if (pathname === '/ops.html') return Promise.resolve(new Response('<html>작전실</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  if (url.toString().includes('/rest/v1/notes')) return Promise.resolve(json(401, { message: 'permission denied' }));
  return Promise.resolve(json(401));
}
const build = (fetchImpl, extra = {}) => buildRows({ baseUrl: 'https://example.vercel.app', originalApiUrl: 'https://project.supabase.co/rest/v1/notes', fetchImpl,
  now: () => new Date('2026-11-05T00:00:00.000Z'), newId: () => '11111111-1111-4111-8111-111111111111', ...extra });

test('열 여덟 개를 모두 채운 표를 만들고, 실측 행은 기대와 같으면 일치로 적는다', async () => {
  const rows = await build(healthyFetch);
  for (const row of rows) {
    for (const key of ['stage', 'kind', 'request', 'expected', 'actual', 'requestId', 'checkedAt', 'status', 'match']) assert.ok(row[key] !== undefined && row[key] !== '', `${row.request}: ${key}`);
  }
  const measured = rows.filter(row => row.status.startsWith('실측'));
  assert.ok(measured.length >= 24);
  assert.ok(measured.every(row => row.match === '일치'), JSON.stringify(measured.filter(row => row.match !== '일치')));
  assert.ok(rows.every(row => ['정상', '금지'].includes(row.kind)));
  const stages = new Set(rows.flatMap(row => row.stage.split('·')));
  for (const stage of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']) assert.ok(stages.has(stage), `단계 ${stage}`);
});

test('요청 ID 는 배포 요청은 응답 머리의 값, 로컬 호출은 판정 요청 UUID 이다', async () => {
  const rows = await build(healthyFetch);
  assert.equal(rows.find(row => row.request === 'GET / (첫 화면)').requestId, 'icn1::home');
  const local = rows.find(row => row.request.startsWith('판정기: 등록 기기'));
  assert.equal(local.requestId, '11111111-1111-4111-8111-111111111111');
  assert.equal(local.status, '실측(로컬)');
  assert.equal(local.checkedAt, '2026-11-05T00:00:00.000Z');
});

test('실행하지 않은 시험은 미실행으로 남고, 일치로 세지 않으며, 41종 시험을 통과 처리하지 않는다', async () => {
  const rows = await build(healthyFetch);
  const notRun = rows.filter(row => row.status === '미실행');
  assert.ok(notRun.length >= 6);
  assert.ok(notRun.every(row => row.match === '—' && row.actual.startsWith('미실행')));
  const engine = rows.find(row => row.request.includes('41종'));
  assert.equal(engine.status, '미실행');
  assert.ok(!/통과|일치/u.test(`${engine.actual}${engine.match}`.replace('통과 처리하지 않음', '')));
  const reported = rows.filter(row => row.status === '사용자 보고');
  assert.ok(reported.length >= 2 && reported.every(row => row.match === '—'), '사용자 보고는 일치로 세지 않는다');
});

test('금지 요청이 막히지 않으면(200) 불일치로 남는다', async () => {
  const leaky = (url, init) => (new URL(url).pathname === '/api/notes' && (init?.method ?? 'GET') === 'GET' ? Promise.resolve(json(200, [])) : healthyFetch(url, init));
  const rows = await build(leaky);
  const bad = rows.filter(row => row.match === '불일치');
  assert.deepEqual(bad.map(row => row.request), ['비로그인 GET /api/notes']);
  assert.equal(bad[0].actual, 'HTTP 200 JSON');
  assert.match(toMarkdown(rows, { baseUrl: 'x' }), /기대와 다른 실측 1건/u);
});

test('요청이 실패하면 지어낸 값을 쓰지 않고 불일치로 남긴다', async () => {
  const rows = await build(() => Promise.reject(new TypeError('network')));
  const http = rows.filter(row => row.status === '실측(배포)');
  assert.ok(http.length >= 10);
  assert.ok(http.every(row => row.match === '불일치' && row.actual.startsWith('요청 실패') && row.requestId === '—'));
});

test('표에는 토큰·키·메모 본문이 들어 있지 않다', async () => {
  const text = toMarkdown(await build(healthyFetch), { baseUrl: 'https://example.vercel.app' });
  assert.doesNotMatch(text, /sb_publishable_|sb_secret_|eyJ[A-Za-z0-9_-]{12,}\.eyJ|Bearer /u);
  assert.match(text, /\| 단계 \| 구분 \| 요청 \| 기대 결과 \| 실제 결과 \| 요청 ID \| 확인 시각 \| 상태 \|/u);
});
