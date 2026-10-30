// 확인용 읽기 모듈(웹 주입): Wazuh 경보에서 시각·출발 주소·계정·규칙 수준·설명만 뽑는다.
// 원본 경보는 읽기만 하고 고치지 않는다. decide.mjs는 이 파일을 불러오지 않는다(따로 둔다).
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE = join(HERE, '..', 'fixtures', 'web-injection.json');

const MASK = '[가림]';
// 비밀값처럼 보이는 값은 출력하지 않는다: 키=값 꼴, 인증 헤더, 개인키, JWT, 클라우드 키, 긴 토큰 문자열.
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gu,
  /\b(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|authorization|auth)\b\s*[=:]\s*\S+/giu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/gu,
  /\b(?:AKIA|ASIA)[0-9A-Z]{12,}\b/gu,
  /\b(?:sk|sb|ghp|gho|xox[baprs])[-_][A-Za-z0-9_-]{12,}/gu,
  /\b[A-Za-z0-9+/_-]{32,}={0,2}/gu,
];

export function redact(value) {
  if (typeof value !== 'string') return value;
  let text = value;
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, MASK);
  return text;
}

const text = value => (typeof value === 'string' ? redact(value) : null);

// 경보 한 건에서 필요한 다섯 가지만 뽑는다. id는 줄을 원본과 맞춰 보려는 표식이다.
export function pickAlert(alert) {
  const accounts = Array.isArray(alert?.data?.accounts)
    ? alert.data.accounts.map(text).filter(value => value !== null)
    : null;
  return {
    id: text(alert?.id),
    time: text(alert?.timestamp),
    srcip: text(alert?.data?.srcip),
    account: text(alert?.data?.srcuser),
    accountsTried: accounts,
    level: Number.isFinite(alert?.rule?.level) ? alert.rule.level : null,
    description: text(alert?.rule?.description),
  };
}

export async function readAlerts(path = DEFAULT_FIXTURE) {
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || !Array.isArray(fixture.alerts)) {
    throw new Error('경보 묶음 형식이 아닙니다.');
  }
  return { alertCount: fixture.alerts.length, rows: fixture.alerts.map(pickAlert) };
}

export function formatRow(row) {
  const accounts = row.accountsTried ? ` (시도한 계정 ${row.accountsTried.length}개)` : '';
  return `${row.id ?? '-'} | ${row.time ?? '-'} | ${row.srcip ?? '-'} | ${row.account ?? '-'}${accounts} | 수준 ${row.level ?? '-'} | ${row.description ?? '-'}`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const { alertCount, rows } = await readAlerts(process.argv[2] ?? DEFAULT_FIXTURE);
    for (const row of rows) console.log(formatRow(row));
    const same = alertCount === rows.length;
    console.log(`경보 ${alertCount}건 · 뽑은 줄 ${rows.length}줄 · ${same ? '건수가 같습니다' : '건수가 다릅니다'}`);
    if (!same) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : '읽기 오류');
    process.exitCode = 1;
  }
}
