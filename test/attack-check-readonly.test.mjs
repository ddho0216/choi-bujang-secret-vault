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
    assert.ok(seen.length >= 8, '실제 요청을 보낸다');
    assert.ok(seen.every(method => ['GET', 'HEAD'].includes(method)), [...new Set(seen)].join(','));
    const notRun = attempts.filter(attempt => attempt.observed === 'not_run').map(attempt => attempt.attackId);
    assert.deepEqual(notRun.sort(), ['anon_data_api_delete', 'anonymous_note_create', 'anonymous_note_update_delete']);
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
