import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRestore, buildSnapshot, createTestPolicy, diffPolicies, planRestore, policyHash, PolicyError, runDemo, simulateTamper,
} from '../src/policy-snapshot.mjs';
import { readTestPolicy, readVerifiedCopy, writeTestPolicy, writeVerifiedCopy } from '../src/policy-files.mjs';

// 안전 정책 사본·해시·침공 흉내·확인. 운영 정책 파일(src/decider.mjs, aleph.config.json)은 읽기만 하고 쓰지 않습니다.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// 시험에서 임시 폴더로 바꿀 수 있게 POLICY_DIR 로 폴더 위치를 정할 수 있습니다(운영 정책 파일 위치는 바뀌지 않습니다).
export const policyDir = process.env.POLICY_DIR ? resolve(process.env.POLICY_DIR) : join(root, 'policy');

const short = hash => `${hash.slice(0, 12)}…`;
const show = value => (value === undefined ? '(없음)' : JSON.stringify(value));
const print = line => process.stdout.write(`${line}\n`);

async function currentSnapshot() {
  const config = JSON.parse(await readFile(join(root, 'aleph.config.json'), 'utf8'));
  return buildSnapshot({ allowedRoutes: config.allowedRoutes });
}

function printDiff(diff) {
  for (const item of diff) print(`    ${item.path}: ${show(item.before)} → ${show(item.after)}`);
}

function printDemo(policy) {
  for (const item of runDemo(policy)) {
    print(`    ${item.allow ? '허용' : '거부'} · ${item.name}${item.allow ? '' : ` (${item.reason})`}${item.ok ? '' : '   ← 기대와 다름'}`);
  }
}

export async function make({ force = false } = {}) {
  const snapshot = await currentSnapshot();
  let existing = null;
  try {
    existing = (await readVerifiedCopy(policyDir)).policy;
  } catch (error) {
    if (!(error instanceof PolicyError) || !['copy_missing', 'hash_missing'].includes(error.code)) throw error;
  }
  if (existing) {
    const diff = diffPolicies(existing, snapshot);
    if (diff.length === 0) {
      print(`검증한 사본이 이미 현재 코드와 같습니다: 버전 ${existing.version} · 해시 ${short(policyHash(existing))}`);
      return;
    }
    if (!force) {
      print(`중단: 검증한 사본을 덮어쓰지 않았습니다. 현재 코드와 ${diff.length}곳이 다릅니다. 의도한 변경이면 --force 를 붙이세요.`);
      printDiff(diff);
      process.exitCode = 1;
      return;
    }
  }
  const hash = await writeVerifiedCopy(policyDir, snapshot);
  print(`안전 정책 사본을 만들었습니다: 버전 ${snapshot.version} · 해시 ${hash}`);
  print('  사본: policy/safe-policy.json');
  print('  해시: policy/safe-policy.sha256 (정렬한 JSON 내용의 SHA-256)');
}

export async function verify() {
  const { policy, hash, version } = await readVerifiedCopy(policyDir);
  const drift = diffPolicies(policy, await currentSnapshot());
  print(`사본 검증 통과: 버전 ${version} · 해시 ${short(hash)}`);
  if (drift.length === 0) {
    print('  현재 코드·설정과 같음');
  } else {
    print(`  주의: 현재 코드·설정과 ${drift.length}곳이 다릅니다(사본은 그대로 믿을 수 있지만 오래됐을 수 있음).`);
    printDiff(drift);
  }
}

export async function drill({ reset = false } = {}) {
  const { policy: verified, hash, version } = await readVerifiedCopy(policyDir);
  print(`[1] 검증한 사본 확인: 버전 ${version} · 해시 ${short(hash)} (통과)`);
  try {
    await readTestPolicy(policyDir);
    if (!reset) {
      print('중단: 시험 정책이 이미 있습니다(감사 이력을 지우지 않으려고 새로 만들지 않았습니다). 처음부터 다시 하려면 --reset 을 붙이세요.');
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    if (!(error instanceof PolicyError) || error.code !== 'test_missing') throw error;
  }
  const at = new Date().toISOString();
  const tampered = simulateTamper(createTestPolicy(verified, { at }), { at });
  await writeTestPolicy(policyDir, tampered);
  print('[2] 시험 정책을 사본에서 만들었습니다: policy/drill/test-policy.json (운영 정책 파일은 건드리지 않음)');
  print('[3] 침공 흉내: 시험 정책에서 규칙 한 줄만 바꿨습니다.');
  const diff = diffPolicies(verified, tampered);
  print(`[4] 검증한 사본과 시험 정책의 차이 (${diff.length}곳)`);
  printDiff(diff);
  print('[5] 같은 요청을 시험 정책에 넣은 결과');
  printDemo(tampered);
}

// 되돌리기: 기본은 미리보기이고, --apply 를 붙여야 실제로 되돌립니다. 사본이 없거나 해시가 맞지 않으면 시험 정책을 읽기 전에 중단합니다.
export async function restore({ apply = false, service = 'notes' } = {}) {
  const { policy: verified, hash, version } = await readVerifiedCopy(policyDir);
  print(`[1] 복원할 버전: ${version} · 해시 ${short(hash)} (검증한 사본, 통과)`);
  const test = await readTestPolicy(policyDir);
  const plan = planRestore({ verified, test, service });
  print(`[2] 복원 범위: ${plan.scope} (이 서비스의 규칙만 되돌립니다)`);
  print(`    바뀔 항목 (${plan.willChange.length}곳, 현재 → 복원 후)`);
  printDiff(plan.willChange.map(item => ({ path: item.path, before: item.after, after: item.before })));
  print(`    그대로 둘 항목: 범위 밖의 차이 ${plan.preserved.length}곳, 감사 이력 ${plan.auditEntries}건(지우지 않고 복원 기록을 덧붙임)`);
  printDiff(plan.preserved);
  if (plan.willChange.length === 0) {
    print('복원할 것이 없습니다. 이 범위는 이미 검증한 사본과 같습니다.');
    return;
  }
  if (!apply) {
    print('[3] 실행하지 않았습니다(미리보기). 위 내용이 맞으면 --apply 를 붙여 실행하세요.');
    return;
  }
  const { next } = applyRestore({ verified, test, service, at: new Date().toISOString() });
  await writeTestPolicy(policyDir, next);
  print(`[3] 복원했습니다: ${plan.scope} 를 버전 ${version} 으로 되돌렸고, 감사 이력은 ${plan.auditEntries}건 → ${next.audit.length}건이 되었습니다.`);
  print('[4] 같은 요청을 복원한 시험 정책에 다시 넣은 결과');
  printDemo(next);
  if (runDemo(next).some(item => !item.ok)) process.exitCode = 1;
}

export async function check({ target = 'verified' } = {}) {
  const policy = target === 'test' ? await readTestPolicy(policyDir) : (await readVerifiedCopy(policyDir)).policy;
  print(`${target === 'test' ? '시험 정책' : '검증한 사본'}에 같은 요청을 넣은 결과 (정책 해시 ${short(policyHash(policy))})`);
  printDemo(policy);
  if (runDemo(policy).some(item => !item.ok)) process.exitCode = 1;
}

async function main(argv) {
  const [command, ...flags] = argv;
  const has = flag => flags.includes(flag);
  switch (command) {
    case 'make': return make({ force: has('--force') });
    case 'verify': return verify();
    case 'drill': return drill({ reset: has('--reset') });
    case 'check': return check({ target: has('--test') ? 'test' : 'verified' });
    case 'restore': return restore({ apply: has('--apply'), service: flags.find(flag => flag.startsWith('--service='))?.slice(10) || 'notes' });
    default:
      print('사용법: node scripts/policy.mjs <make|verify|drill|restore|check> [--force|--reset|--apply|--service=이름|--test]');
      process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    print(`중단: ${error instanceof PolicyError ? error.message : `예상하지 못한 오류 (${error?.message ?? error})`}`);
    process.exitCode = 1;
  }
}
