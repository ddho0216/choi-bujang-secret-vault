import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { policyHash, PolicyError, SNAPSHOT_SCHEMA } from './policy-snapshot.mjs';

// 안전 정책 사본(policy/safe-policy.json)과 해시(policy/safe-policy.sha256), 시험 정책(policy/drill/test-policy.json)을 읽고 씁니다.
// 쓰기는 이 폴더 안으로만 하고, 운영 정책 파일(src/decider.mjs, aleph.config.json)은 쓰지 않습니다.
export const COPY_NAME = 'safe-policy.json';
export const HASH_NAME = 'safe-policy.sha256';
export const DRILL_DIR = 'drill';
export const TEST_NAME = 'test-policy.json';

const readText = async (path, code, message) => {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new PolicyError(code, message);
    throw error;
  }
};

// 검증한 사본을 읽습니다. 사본이나 해시가 없거나 내용이 해시와 맞지 않으면 PolicyError 로 중단합니다.
export async function readVerifiedCopy(dir) {
  const copyText = await readText(join(dir, COPY_NAME), 'copy_missing', `안전 정책 사본이 없습니다: ${COPY_NAME}`);
  const hashText = await readText(join(dir, HASH_NAME), 'hash_missing', `사본 해시 파일이 없습니다: ${HASH_NAME}`);
  let policy;
  try {
    policy = JSON.parse(copyText);
  } catch {
    throw new PolicyError('invalid_json', `안전 정책 사본을 읽을 수 없습니다(JSON 아님): ${COPY_NAME}`);
  }
  if (!policy || policy.schema !== SNAPSHOT_SCHEMA) throw new PolicyError('invalid_schema', '안전 정책 사본의 형식이 아닙니다.');
  const expected = /^[0-9a-f]{64}/u.exec(hashText.trim())?.[0];
  if (!expected) throw new PolicyError('hash_invalid', `해시 파일 형식이 맞지 않습니다: ${HASH_NAME}`);
  const actual = policyHash(policy);
  if (actual !== expected) {
    throw new PolicyError('hash_mismatch', `사본의 해시가 맞지 않습니다. 기록 ${expected.slice(0, 12)}… · 지금 내용 ${actual.slice(0, 12)}…`);
  }
  return { policy, hash: actual, version: policy.version };
}

export async function writeVerifiedCopy(dir, snapshot) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, COPY_NAME), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  const hash = policyHash(snapshot);
  await writeFile(join(dir, HASH_NAME), `${hash}  ${COPY_NAME}\n`, 'utf8');
  return hash;
}

export async function readTestPolicy(dir) {
  const text = await readText(join(dir, DRILL_DIR, TEST_NAME), 'test_missing', `시험 정책이 없습니다. 먼저 침공 흉내(npm run policy:drill)를 하세요: ${DRILL_DIR}/${TEST_NAME}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new PolicyError('invalid_json', `시험 정책을 읽을 수 없습니다(JSON 아님): ${DRILL_DIR}/${TEST_NAME}`);
  }
}

export async function writeTestPolicy(dir, policy) {
  await mkdir(join(dir, DRILL_DIR), { recursive: true });
  await writeFile(join(dir, DRILL_DIR, TEST_NAME), `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
}
