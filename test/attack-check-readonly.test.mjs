import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAttackChecks } from '../src/attack-check.mjs';

// 제출 묶음(npm run bundle)은 격리 환경에서 실행된다. 그 환경에서는 공개 HTTPS 주소로 GET·HEAD 요청만 보낼 수 있고,
// node:fs·node:path·node:url·node:child_process·node:crypto 만 쓸 수 있다. 쓰기 요청이 필요한 점검은 observed 를 'not_run' 으로 둔다.
const root = join(import.meta.dirname, '..');

test('점검 코드는 GET·HEAD 요청만 보낸다(쓰기 요청이 필요한 점검은 not_run)', async () => {
  const config = JSON.parse(await readFile(join(root, 'aleph.config.json'), 'utf8'));
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push(String(init.method ?? 'GET').toUpperCase());
    return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401, headers: { 'content-type': 'application/json' } });
  };
  try {
    const attempts = await runAttackChecks(config);
    assert.ok(seen.length >= 7, '실제 요청을 보낸다');
    assert.ok(seen.every(method => ['GET', 'HEAD'].includes(method)), [...new Set(seen)].join(','));
    // 실제로 보낸 GET 이 있는 점검은 HTTP 상태를 적고, 요청하지 않았거나 로컬 가상 시험뿐인 점검은 정확히 'not_run' 이다.
    const withRequest = ['anonymous_static_data_read', 'anonymous_list_read', 'anon_data_api_read', 'screen_has_no_public_key', 'anonymous_other_zone_api', 'anonymous_device_api', 'anonymous_ops_api'];
    for (const attempt of attempts) {
      if (withRequest.includes(attempt.attackId)) {
        assert.match(attempt.observed, /^GET \S+.* HTTP \d{3}/u, attempt.attackId);
      } else {
        assert.equal(attempt.observed, 'not_run', attempt.attackId);
      }
    }
    assert.equal(attempts.filter(attempt => attempt.observed === 'not_run').length, attempts.length - withRequest.length);
    assert.equal(seen.length, withRequest.length, '점검 항목마다 GET 요청 한 건이 대응한다');
    assert.ok(attempts.length <= 20);
    assert.equal(new Set(attempts.map(attempt => attempt.attackId)).size, attempts.length);
  } finally {
    globalThis.fetch = original;
  }
});

test('점검 코드가 불러오는 파일은 격리 환경에서 허용된 node 모듈만 쓴다', async () => {
  const allowed = new Set(['node:fs', 'node:path', 'node:url', 'node:child_process', 'node:crypto']);
  const files = ['src/attack-check.mjs', 'src/decider.mjs', 'src/detect.mjs', 'src/policy-snapshot.mjs', 'src/supabase-public.mjs', 'scripts/bundle.mjs'];
  for (const file of files) {
    const text = await readFile(join(root, file), 'utf8');
    const used = [...text.matchAll(/(?:from\s+|import\(\s*)['"](node:[^'"]+)['"]/gu)].map(match => match[1]);
    for (const name of used) assert.ok(allowed.has(name), `${file} 이 ${name} 을 씁니다`);
  }
});

test('실제 응답이 있는 점검은 요청 주소 전체와 HTTP 상태를 적고, 요청이 실패하면 상태를 지어내지 않고 not_run 이다', async () => {
  const config = JSON.parse(await readFile(join(root, 'aleph.config.json'), 'utf8'));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('x', { status: 404 });
    const answered = await runAttackChecks(config);
    const list = answered.find(attempt => attempt.attackId === 'anonymous_list_read');
    assert.equal(list.observed, `GET ${new URL('/api/notes', config.publicAppUrl).href} HTTP 404`);
    const dataApi = answered.find(attempt => attempt.attackId === 'anon_data_api_read');
    assert.match(dataApi.observed, /^GET https:\/\/\S+\/rest\/v1\/notes\?select=id HTTP 404$/u);

    globalThis.fetch = async () => { throw new TypeError('network down'); };
    const failed = await runAttackChecks(config);
    assert.ok(failed.every(attempt => attempt.observed === 'not_run'), '요청이 모두 실패하면 모든 점검이 not_run');
  } finally {
    globalThis.fetch = original;
  }
});
