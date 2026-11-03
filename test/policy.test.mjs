import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { decide } from '../src/decider.mjs';
import { createNotesApi } from '../src/notes-api.mjs';
import { COPY_NAME, HASH_NAME, readVerifiedCopy } from '../src/policy-files.mjs';
import {
  buildSnapshot, canonicalJson, createTestPolicy, diffPolicies, evaluate, policyHash, runDemo, simulateTamper, TAMPER_PATH,
} from '../src/policy-snapshot.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const realPolicyDir = join(root, 'policy');
const config = JSON.parse(await readFile(join(root, 'aleph.config.json'), 'utf8'));
const verifiedOnDisk = (await readVerifiedCopy(realPolicyDir)).policy;
const fileHash = async path => createHash('sha256').update(await readFile(path)).digest('hex');

// 임시 폴더에 검증한 사본을 복사해 주고, 끝나면 지웁니다. 실제 policy/ 폴더는 건드리지 않습니다.
async function withPolicyDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'policy-test-'));
  try {
    await cp(join(realPolicyDir, COPY_NAME), join(dir, COPY_NAME));
    await cp(join(realPolicyDir, HASH_NAME), join(dir, HASH_NAME));
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const cli = (dir, ...args) => {
  const result = spawnSync(process.execPath, ['scripts/policy.mjs', ...args], { cwd: root, env: { ...process.env, POLICY_DIR: dir }, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

// ── 제작 1: 안전 정책 사본·해시·침공 흉내·차이 ───────────────────────────────────
test('정렬한 JSON 해시는 키 순서·줄바꿈과 상관없고, 내용이 바뀌면 달라진다', () => {
  assert.equal(canonicalJson({ b: [1, { d: 2, c: 3 }], a: 'x' }), canonicalJson({ a: 'x', b: [1, { c: 3, d: 2 }] }));
  assert.equal(policyHash({ a: 1, b: 2 }), policyHash({ b: 2, a: 1 }));
  assert.notEqual(policyHash({ a: 1 }), policyHash({ a: 2 }));
  assert.notEqual(canonicalJson({ list: [1, 2] }), canonicalJson({ list: [2, 1] }), '배열 순서는 내용이다');
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
});

test('저장소에 올린 검증한 사본은 해시가 맞고 현재 코드·설정과 같다(오래되지 않았다)', async () => {
  const { policy, hash } = await readVerifiedCopy(realPolicyDir);
  assert.equal(hash, policyHash(policy));
  assert.deepEqual(diffPolicies(policy, buildSnapshot({ allowedRoutes: config.allowedRoutes })), [],
    '판정기 규칙·allowedRoutes 를 바꿨다면 npm run policy:make --force 로 사본을 다시 만든다');
  assert.equal(policy.version, 'safe-1');
  assert.deepEqual(policy.allowedRoutes, config.allowedRoutes);
  assert.equal(policy.db.rowLevelSecurity, true);
  assert.deepEqual(policy.db.tableGrants.anon, []);
  assert.deepEqual(policy.db.tableGrants.authenticated, []);
});

test('사본이 없거나 해시가 맞지 않거나 형식이 이상하면 중단한다', async () => {
  await withPolicyDir(async dir => {
    assert.equal((await readVerifiedCopy(dir)).version, 'safe-1');
    // 내용만 바꾼 사본: 해시와 맞지 않는다.
    const copy = JSON.parse(await readFile(join(dir, COPY_NAME), 'utf8'));
    copy.services.notes.ownerCheck = false;
    await writeFile(join(dir, COPY_NAME), JSON.stringify(copy));
    await assert.rejects(readVerifiedCopy(dir), { code: 'hash_mismatch' });
    // 해시만 바꾼 경우.
    await cp(join(realPolicyDir, COPY_NAME), join(dir, COPY_NAME));
    await writeFile(join(dir, HASH_NAME), `${'0'.repeat(64)}  ${COPY_NAME}\n`);
    await assert.rejects(readVerifiedCopy(dir), { code: 'hash_mismatch' });
    await writeFile(join(dir, HASH_NAME), 'not-a-hash\n');
    await assert.rejects(readVerifiedCopy(dir), { code: 'hash_invalid' });
    await rm(join(dir, HASH_NAME));
    await assert.rejects(readVerifiedCopy(dir), { code: 'hash_missing' });
    await cp(join(realPolicyDir, HASH_NAME), join(dir, HASH_NAME));
    await writeFile(join(dir, COPY_NAME), '{not json');
    await assert.rejects(readVerifiedCopy(dir), { code: 'invalid_json' });
    await writeFile(join(dir, COPY_NAME), JSON.stringify({ schema: 'other' }));
    await assert.rejects(readVerifiedCopy(dir), { code: 'invalid_schema' });
    await rm(join(dir, COPY_NAME));
    await assert.rejects(readVerifiedCopy(dir), { code: 'copy_missing' });
  });
});

test('침공 흉내는 시험 정책의 규칙 한 줄만 바꾸고, 차이는 그 한 곳만 보인다', () => {
  const at = '2026-10-01T00:00:00.000Z';
  const test_ = createTestPolicy(verifiedOnDisk, { at });
  assert.deepEqual(diffPolicies(verifiedOnDisk, test_), [], '만든 직후에는 차이가 없다(감사 이력은 비교하지 않는다)');
  const tampered = simulateTamper(test_, { at });
  assert.deepEqual(diffPolicies(verifiedOnDisk, tampered), [{ path: TAMPER_PATH, before: true, after: false }]);
  assert.equal(tampered.audit.length, 2, '감사 이력이 쌓인다');
  assert.equal(verifiedOnDisk.services.notes.ownerCheck, true, '검증한 사본은 그대로다');
  assert.deepEqual(diffPolicies(verifiedOnDisk, { ...verifiedOnDisk }), []);
  const added = structuredClone(tampered);
  added.services.notices.zoneRules.push('POST /notices');
  added.extra = { x: 1 };
  assert.deepEqual(diffPolicies(verifiedOnDisk, added).map(item => item.path), ['extra.x', 'services.notes.ownerCheck', 'services.notices.zoneRules']);
});

test('정책이 바뀌면 같은 요청의 결과가 바뀐다: 검증한 사본은 B 의 A 요청을 거부하고 시험 정책은 허용한다', () => {
  const at = '2026-10-01T00:00:00.000Z';
  const tampered = simulateTamper(createTestPolicy(verifiedOnDisk, { at }), { at });
  const safe = runDemo(verifiedOnDisk);
  assert.ok(safe.every(item => item.ok), JSON.stringify(safe.filter(item => !item.ok)));
  const broken = runDemo(tampered);
  assert.deepEqual(broken.filter(item => !item.ok).map(item => item.name), ['B의 A 메모 읽기', 'B의 A 메모 수정', 'B의 A 메모 삭제']);
  assert.ok(broken.filter(item => item.name.startsWith('A의')).every(item => item.allow), 'A 의 정상 요청은 침공 중에도 된다');
  // 소유자 검사 값이 이상하면(없거나 문자열) 검사를 건너뛰지 않는다.
  for (const ownerCheck of [undefined, 'false', 0, null]) {
    const odd = structuredClone(verifiedOnDisk);
    odd.services.notes.ownerCheck = ownerCheck;
    assert.equal(evaluate(odd, { method: 'GET', path: '/api/notes/x', actor: 'b', owner: 'a' }).allow, false, String(ownerCheck));
  }
});

test('정책 계산기는 실제 판정기·메모 API 와 같은 결과를 낸다(가짜가 아니다)', async () => {
  const { normal } = fixtureRequests();
  const shapes = [['GET', '/notes/x', true], ['PUT', '/notes/x', true], ['DELETE', '/notes/x', true], ['POST', '/notes/x', false], ['PATCH', '/notes/x', false],
    ['GET', '/notes', false], ['POST', '/notes', false], ['GET', '/notices', true], ['GET', '/notices/n', true], ['POST', '/notices', false],
    ['PUT', '/notices/n', false], ['DELETE', '/notices/n', false], ['GET', '/instructor', false], ['GET', '/instructor/m', false], ['PUT', '/instructor/m', false]];
  for (const [method, path, allow] of shapes) {
    const template = path.replace(/^\/(\w+)\/[^/]+$/u, '/$1/:id');
    const response = await decide({ ...normal, requestId: randomUUID(), method, path, service: path.split('/')[1], route: `${method} ${template}` });
    assert.equal(response.decision === 'allow', allow, `판정기: ${method} ${path}`);
    assert.equal(evaluate(verifiedOnDisk, { method, path, actor: 'a', owner: 'a' }).allow, allow, `정책 계산기: ${method} ${path}`);
  }
  // 소유자 검사: 메모 API 는 남의 메모를 404 로 거부하고 자기 메모는 200 으로 준다.
  const rows = [{ id: '123e4567-e89b-12d3-a456-426614174000', owner_id: 'user-a', title: 't', content: 'c' }];
  const query = state => {
    const q = { select() { return q; }, eq(column, value) { state.push([column, value]); return q; },
      maybeSingle: () => Promise.resolve({ data: rows.find(row => state.every(([c, v]) => row[c] === v)) ?? null, error: null }) };
    return q;
  };
  const supabase = { from: () => ({ select: () => query([]) }) };
  const asUser = id => createNotesApi({ log: () => {}, deviceCheck: async () => 'approved', supabase, verifier: async () => ({ userId: id }) });
  const get = async userId => {
    const response = { setHeader() {}, status(code) { this.code = code; return this; }, json() { return this; } };
    await asUser(userId)({ method: 'GET', headers: {} }, response, rows[0].id);
    return response.code;
  };
  assert.equal(await get('user-a'), 200);
  assert.equal(await get('user-b'), 404);
  assert.equal(evaluate(verifiedOnDisk, { method: 'GET', path: `/api/notes/${rows[0].id}`, actor: 'user-a', owner: 'user-a' }).allow, true);
  assert.equal(evaluate(verifiedOnDisk, { method: 'GET', path: `/api/notes/${rows[0].id}`, actor: 'user-b', owner: 'user-a' }).allow, false);
});

test('도구: 침공 흉내와 차이 보여 주기는 임시 폴더에서만 쓰고, 운영 정책 파일은 건드리지 않는다', async () => {
  const guarded = [join(root, 'src', 'decider.mjs'), join(root, 'aleph.config.json'), join(realPolicyDir, COPY_NAME), join(realPolicyDir, HASH_NAME)];
  const before = await Promise.all(guarded.map(fileHash));
  await withPolicyDir(async dir => {
    const verify = cli(dir, 'verify');
    assert.equal(verify.code, 0);
    assert.match(verify.out, /사본 검증 통과: 버전 safe-1/u);
    assert.match(verify.out, /현재 코드·설정과 같음/u);
    const drill = cli(dir, 'drill');
    assert.equal(drill.code, 0, drill.err);
    assert.match(drill.out, /차이 \(1곳\)/u);
    assert.match(drill.out, /services\.notes\.ownerCheck: true → false/u);
    assert.match(drill.out, /허용 · B의 A 메모 읽기 {3}← 기대와 다름/u);
    const again = cli(dir, 'drill');
    assert.equal(again.code, 1, '시험 정책이 이미 있으면 감사 이력을 지우지 않도록 멈춘다');
    assert.match(again.out, /--reset/u);
    assert.equal(cli(dir, 'drill', '--reset').code, 0);
    const checkSafe = cli(dir, 'check');
    assert.equal(checkSafe.code, 0);
    assert.match(checkSafe.out, /거부 · B의 A 메모 읽기 \(not_owner\)/u);
    assert.equal(cli(dir, 'check', '--test').code, 1, '침공 중인 시험 정책은 기대와 다른 줄이 있어 실패로 끝난다');
    const unknown = cli(dir, 'nope');
    assert.equal(unknown.code, 1);
    await rm(join(dir, COPY_NAME));
    const missing = cli(dir, 'drill');
    assert.equal(missing.code, 1, '사본이 없으면 중단한다');
    assert.match(missing.out, /중단: 안전 정책 사본이 없습니다/u);
  });
  assert.deepEqual(await Promise.all(guarded.map(fileHash)), before, '운영 정책 파일과 검증한 사본은 그대로');
});

test('도구: make 는 검증한 사본을 조용히 덮어쓰지 않는다', async () => {
  await withPolicyDir(async dir => {
    const same = cli(dir, 'make');
    assert.equal(same.code, 0);
    assert.match(same.out, /이미 현재 코드와 같습니다/u);
    // 사본을 일부러 오래된 것처럼 만든다(해시도 같이 맞춘다).
    const old = structuredClone(verifiedOnDisk);
    old.version = 'safe-0';
    old.allowedRoutes = ['GET /api/notes/:id'];
    await writeFile(join(dir, COPY_NAME), JSON.stringify(old));
    await writeFile(join(dir, HASH_NAME), `${policyHash(old)}  ${COPY_NAME}\n`);
    const refused = cli(dir, 'make');
    assert.equal(refused.code, 1);
    assert.match(refused.out, /덮어쓰지 않았습니다/u);
    assert.equal((await readVerifiedCopy(dir)).version, 'safe-0', '그대로 남아 있다');
    assert.equal(cli(dir, 'make', '--force').code, 0);
    assert.equal((await readVerifiedCopy(dir)).version, 'safe-1');
  });
});

// ── 제작 2: 검증한 버전으로 시험 정책을 되돌리는 절차 ─────────────────────────────
import { applyRestore, planRestore } from '../src/policy-snapshot.mjs';
import { readTestPolicy, writeTestPolicy } from '../src/policy-files.mjs';

const AT = '2026-10-01T00:00:00.000Z';
const freshTampered = () => simulateTamper(createTestPolicy(verifiedOnDisk, { at: AT }), { at: AT });

test('복원 계획은 복원할 버전과 바뀔 항목을 실행 전에 보여 준다', () => {
  const plan = planRestore({ verified: verifiedOnDisk, test: freshTampered() });
  assert.equal(plan.version, 'safe-1');
  assert.equal(plan.hash, policyHash(verifiedOnDisk));
  assert.equal(plan.scope, 'services.notes');
  assert.deepEqual(plan.willChange, [{ path: TAMPER_PATH, before: true, after: false }]);
  assert.deepEqual(plan.preserved, []);
  assert.equal(plan.auditEntries, 2);
});

test('복원하면 그 서비스의 규칙만 되돌아오고, 다른 서비스 규칙과 범위 밖 차이와 감사 이력은 보존된다', () => {
  const test_ = freshTampered();
  test_.services.notices.zoneRules.push('GET /notices/:id/comments'); // 다른 서비스의 규칙은 따로 바뀐 상태
  test_.db.rowLevelSecurity = false;                                     // 범위 밖 차이
  const plan = planRestore({ verified: verifiedOnDisk, test: test_ });
  assert.deepEqual(plan.willChange.map(item => item.path), [TAMPER_PATH]);
  assert.deepEqual(plan.preserved.map(item => item.path), ['db.rowLevelSecurity', 'services.notices.zoneRules']);
  const { next } = applyRestore({ verified: verifiedOnDisk, test: test_, at: AT });
  assert.deepEqual(next.services.notes, verifiedOnDisk.services.notes, '메모 서비스 규칙이 검증한 사본과 같아졌다');
  assert.deepEqual(next.services.notices.zoneRules, test_.services.notices.zoneRules, '다른 서비스 규칙은 그대로');
  assert.equal(next.db.rowLevelSecurity, false, '범위 밖 차이는 건드리지 않는다');
  assert.deepEqual(next.audit.slice(0, 2), test_.audit, '이전 감사 이력은 그대로 남는다');
  assert.equal(next.audit.length, 3);
  assert.deepEqual(next.audit[2], { at: AT, event: 'restore', version: 'safe-1', hash: policyHash(verifiedOnDisk), scope: 'services.notes', changed: [TAMPER_PATH] });
  assert.equal(test_.services.notes.ownerCheck, false, '입력 시험 정책 객체는 바뀌지 않는다');
  assert.deepEqual(diffPolicies(verifiedOnDisk, next).map(item => item.path), ['db.rowLevelSecurity', 'services.notices.zoneRules']);
});

test('복원 뒤 B 의 A 자료 요청은 다시 거부되고, A 의 정상 요청은 침공 전·중·후 내내 유지된다', () => {
  const tampered = freshTampered();
  const { next } = applyRestore({ verified: verifiedOnDisk, test: tampered, at: AT });
  const stages = { 침공중: runDemo(tampered), 복원후: runDemo(next), 사본: runDemo(verifiedOnDisk) };
  for (const [stage, results] of Object.entries(stages)) {
    assert.ok(results.filter(item => item.name.startsWith('A의')).every(item => item.allow), `${stage}: A 의 정상 요청`);
  }
  assert.ok(stages.침공중.filter(item => item.name.startsWith('B의')).every(item => item.allow), '침공 중에는 B 가 A 자료를 본다');
  assert.ok(stages.복원후.every(item => item.ok), JSON.stringify(stages.복원후.filter(item => !item.ok)));
  assert.deepEqual(stages.복원후.map(item => item.allow), stages.사본.map(item => item.allow), '복원한 정책은 검증한 사본과 같은 판단을 한다');
});

test('복원할 것이 없거나 모르는 서비스거나 시험 정책이 이상하면 멈춘다', () => {
  const clean = createTestPolicy(verifiedOnDisk, { at: AT });
  assert.throws(() => applyRestore({ verified: verifiedOnDisk, test: clean, at: AT }), { code: 'nothing_to_restore' });
  const { next } = applyRestore({ verified: verifiedOnDisk, test: freshTampered(), at: AT });
  assert.throws(() => applyRestore({ verified: verifiedOnDisk, test: next, at: AT }), { code: 'nothing_to_restore' }, '두 번째 복원은 할 것이 없다');
  assert.throws(() => planRestore({ verified: verifiedOnDisk, test: clean, service: 'nope' }), { code: 'unknown_service' });
  assert.throws(() => planRestore({ verified: verifiedOnDisk, test: {} }), { code: 'invalid_test_policy' });
  assert.throws(() => planRestore({ verified: verifiedOnDisk, test: null }), { code: 'invalid_test_policy' });
});

test('도구: 복원은 미리보기가 기본이고 --apply 를 붙여야 쓰며, 사본이 이상하면 시험 정책을 읽기 전에 중단한다', async () => {
  const guarded = [join(root, 'src', 'decider.mjs'), join(root, 'aleph.config.json'), join(realPolicyDir, COPY_NAME), join(realPolicyDir, HASH_NAME)];
  const before = await Promise.all(guarded.map(fileHash));
  await withPolicyDir(async dir => {
    const noDrill = cli(dir, 'restore');
    assert.equal(noDrill.code, 1);
    assert.match(noDrill.out, /시험 정책이 없습니다/u);
    assert.equal(cli(dir, 'drill').code, 0);
    const testPath = join(dir, 'drill', 'test-policy.json');
    const tamperedHash = await fileHash(testPath);

    const preview = cli(dir, 'restore');
    assert.equal(preview.code, 0, preview.err);
    assert.match(preview.out, /\[1\] 복원할 버전: safe-1 · 해시 [0-9a-f]{12}…/u);
    assert.match(preview.out, /\[2\] 복원 범위: services\.notes/u);
    assert.match(preview.out, /바뀔 항목 \(1곳, 현재 → 복원 후\)/u);
    assert.match(preview.out, /services\.notes\.ownerCheck: false → true/u);
    assert.match(preview.out, /감사 이력 2건/u);
    assert.match(preview.out, /실행하지 않았습니다\(미리보기\)/u);
    assert.equal(await fileHash(testPath), tamperedHash, '미리보기는 아무것도 쓰지 않는다');

    const applied = cli(dir, 'restore', '--apply');
    assert.equal(applied.code, 0, applied.out + applied.err);
    assert.match(applied.out, /감사 이력은 2건 → 3건/u);
    assert.match(applied.out, /거부 · B의 A 메모 읽기 \(not_owner\)/u);
    assert.match(applied.out, /허용 · A의 자기 메모 읽기/u);
    const restored = await readTestPolicy(dir);
    assert.deepEqual(restored.services.notes, verifiedOnDisk.services.notes);
    assert.equal(restored.audit.length, 3);
    assert.equal(cli(dir, 'check', '--test').code, 0, '복원한 시험 정책은 확인표를 모두 통과한다');
    const second = cli(dir, 'restore', '--apply');
    assert.equal(second.code, 0);
    assert.match(second.out, /복원할 것이 없습니다/u);
    assert.equal((await readTestPolicy(dir)).audit.length, 3, '할 것이 없으면 이력도 늘리지 않는다');

    const unknownService = cli(dir, 'restore', '--service=nope');
    assert.equal(unknownService.code, 1);
    assert.match(unknownService.out, /검증한 사본에 없는 서비스입니다/u);

    // 사본의 해시가 맞지 않으면 시험 정책을 읽기 전에 중단한다.
    await writeTestPolicy(dir, freshTampered());
    const copy = JSON.parse(await readFile(join(dir, COPY_NAME), 'utf8'));
    copy.services.notes.ownerCheck = false;
    await writeFile(join(dir, COPY_NAME), JSON.stringify(copy));
    const blocked = cli(dir, 'restore', '--apply');
    assert.equal(blocked.code, 1);
    assert.match(blocked.out, /중단: 사본의 해시가 맞지 않습니다/u);
    assert.equal((await readTestPolicy(dir)).services.notes.ownerCheck, false, '중단했으니 시험 정책은 그대로');
  });
  assert.deepEqual(await Promise.all(guarded.map(fileHash)), before, '운영 정책 파일과 검증한 사본은 그대로');
});
