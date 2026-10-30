// 알림과 차단(무차별 로그인): 로직은 xdr/respond-core.mjs 와 같이 쓰고, 이 모듈의 판단과 파일 위치만 넣는다.
// decide.mjs 는 판단만 돌려주고, 파일 쓰기와 규칙 기록은 이 파일만 한다.
// 이 저장소의 src/decider.mjs 는 시작 틀이라 규칙 파일을 읽지 않고 판정 요청에 출발 주소가 없어, 판정기에 연결하지 않았다.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';
import { planResponse as corePlan, respondToAlerts as coreRespond } from '../respond-core.mjs';

export { blockableAddress, DENY_TTL_MINUTES, isDenied } from '../respond-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MODULE_KEY = 'brute-force';
export const FIXTURE_PATH = join(ROOT, 'xdr', 'fixtures', 'brute-force.json');
export const ALERTS_LOG_PATH = join(ROOT, 'xdr', 'alerts.log');
export const DENY_RULES_PATH = join(HERE, 'deny-rules.json');

export const planResponse = entries => corePlan(entries, { moduleKey: MODULE_KEY });

export function respondToAlerts({ alerts, alertsLogPath = ALERTS_LOG_PATH, denyRulesPath = DENY_RULES_PATH } = {}) {
  return coreRespond({ alerts, decide, moduleKey: MODULE_KEY, alertsLogPath, denyRulesPath });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
    const out = await respondToAlerts({ alerts: fixture.alerts });
    console.log(`거부 규칙 ${out.rules.length}개 · 알림 ${out.logLines}줄(새로 쌓음 ${out.logged}줄) · 차단 보류 ${out.held}건`);
    console.log('ZTNA 판정기에는 연결하지 않았습니다(규칙 파일을 읽지 않고, 판정 요청에 출발 주소가 없음).');
  } catch (error) {
    console.error(error instanceof Error ? error.message : '실행 오류');
    process.exitCode = 1;
  }
}
