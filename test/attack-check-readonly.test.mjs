import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAttackChecks } from '../src/attack-check.mjs';

// 제출 묶음(npm run bundle)은 격리 환경에서 실행되고, 심판이 기록한 실제 요청과 대조된다. 심판의 실행 기록에 남지 않는 요청은
// 증거가 될 수 없어서, 3단계부터 이 점검 코드는 요청을 보내지 않고 모든 점검의 observed 를 'not_run' 으로 남긴다.
// 요청을 보내서 받은 HTTP 상태를 지어내지 않는다. 실제 요청의 결과는 npm run ops:table 로 따로 만든다.
const root = join(import.meta.dirname, '..');

test('제출 점검은 요청을 한 건도 보내지 않고 모든 점검의 observed 가 not_run 이다', async () => {
  const config = JSON.parse(await readFile(join(root, 'aleph.config.json'), 'utf8'));
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; return new Response('x', { status: 200 }); };
  try {
    const attempts = await runAttackChecks(config);
    assert.equal(calls, 0, '요청을 보내지 않는다');
    assert.equal(attempts.length, 20);
    assert.equal(new Set(attempts.map(attempt => attempt.attackId)).size, attempts.length);
    for (const attempt of attempts) {
      assert.deepEqual(Object.keys(attempt).sort(), ['attackId', 'expected', 'observed']);
      assert.equal(attempt.observed, 'not_run', attempt.attackId);
      assert.ok(attempt.expected.trim().length > 0);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('이전 단계 설정(1·2단계)은 그대로 /data.json 을 읽고 실제 상태를 적는다', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('x', { status: 404 });
  try {
    const config = { ...JSON.parse(await readFile(join(root, 'aleph.config.json'), 'utf8')), step: 1 };
    const [attempt] = await runAttackChecks(config);
    assert.equal(attempt.attackId, 'anonymous_note_read');
    assert.match(attempt.observed, /HTTP 404/u);
  } finally {
    globalThis.fetch = original;
  }
});

test('점검 코드가 불러오는 파일은 격리 환경에서 허용된 node 모듈만 쓴다', async () => {
  const allowed = new Set(['node:fs', 'node:path', 'node:url', 'node:child_process', 'node:crypto']);
  const files = ['src/attack-check.mjs', 'src/decider.mjs', 'src/detect.mjs', 'scripts/bundle.mjs'];
  for (const file of files) {
    const text = await readFile(join(root, file), 'utf8');
    const used = [...text.matchAll(/(?:from\s+|import\(\s*)['"](node:[^'"]+)['"]/gu)].map(match => match[1]);
    for (const name of used) assert.ok(allowed.has(name), `${file} 이 ${name} 을 씁니다`);
  }
});
