import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from '../src/decider.mjs';
import { detect } from '../src/detect.mjs';
import { SUPABASE_PUBLISHABLE_KEY } from '../src/supabase-public.mjs';

// 12단계: 1~11단계의 정상·금지 요청을 한 표로 만든다. 표의 열: 단계, 구분, 요청, 기대 결과, 실제 결과, 요청 ID, 확인 시각, 상태.
// - 실측(배포): 배포 주소에 실제로 보낸 요청의 응답이다. 요청 ID 는 응답 머리 x-vercel-id(호스팅 서비스가 붙인 값)이다.
// - 실측(로컬): 이 컴퓨터에서 판정기·탐지 함수를 직접 부른 결과다. 요청 ID 는 판정 요청에 넣은 UUID 이다. 심판의 판정이 아니다.
// - 미실행: 로그인 토큰이나 심판·엔진이 있어야 해서 이 절차가 실행하지 않은 것. 통과로 세지 않는다.
// - 사용자 보고: 사용자가 직접 실행해 알려 준 결과다(캡처 없음). 이 절차가 다시 확인한 것이 아니다.
// 토큰·비밀번호·메모 본문은 다루지 않는다.
const root = resolve(import.meta.dirname, '..');
const KEY_PATTERN = /sb_publishable_|sb_secret_|eyJ[A-Za-z0-9_-]{12,}\.eyJ/u;
const isJson = response => (response.headers.get('content-type') ?? '').includes('json');

export async function buildRows({ baseUrl, originalApiUrl, fetchImpl = fetch, now = () => new Date(), newId = randomUUID }) {
  const rows = [];
  const stamp = () => now().toISOString();
  const row = (stage, kind, request, expected, actual, requestId, status, match) =>
    rows.push({ stage, kind, request, expected, actual, requestId: requestId ?? '—', checkedAt: stamp(), status, match });

  // 배포 주소에 실제로 보내는 요청. 응답이 기대와 같을 때만 '일치'로 적는다.
  async function http(stage, kind, label, path, { method = 'GET', body, headers = {}, url = null, expect, expected }) {
    try {
      const response = await fetchImpl(url ?? new URL(path, baseUrl), {
        method, redirect: 'manual', cache: 'no-store', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      const actual = `HTTP ${response.status}${isJson(response) ? ' JSON' : ''}`;
      const ok = expect({ response, text });
      row(stage, kind, label, expected, actual, response.headers.get('x-vercel-id'), '실측(배포)', ok ? '일치' : '불일치');
    } catch (error) {
      row(stage, kind, label, expected, `요청 실패(${error?.name ?? 'Error'})`, null, '실측(배포)', '불일치');
    }
  }
  const status = code => ({ response }) => response.status === code;
  const refused401 = ({ response }) => response.status === 401 && isJson(response);

  await http('1·2', '정상', 'GET / (첫 화면)', '/', { expected: 'HTTP 200', expect: status(200) });
  await http('1·2', '금지', 'GET /data.json (옛 공개 자료)', '/data.json', { expected: 'HTTP 404', expect: status(404) });
  await http('3', '금지', '비로그인 GET /api/notes', '/api/notes', { expected: 'HTTP 401 JSON', expect: refused401 });
  await http('3', '금지', '비로그인 POST /api/notes', '/api/notes', { method: 'POST', body: { title: 'x', body: 'x' }, expected: 'HTTP 401 JSON', expect: refused401 });
  await http('3', '금지', '비로그인 PUT /api/notes/:id', '/api/notes/00000000-0000-4000-8000-000000000000', { method: 'PUT', body: { title: 'x', body: 'x' }, expected: 'HTTP 401 JSON', expect: refused401 });
  await http('3', '금지', '비로그인 DELETE /api/notes/:id', '/api/notes/00000000-0000-4000-8000-000000000000', { method: 'DELETE', expected: 'HTTP 401 JSON', expect: refused401 });
  await http('5', '정상', 'GET / 응답에 키 문자열이 없는지', '/', { expected: '키 문자열 없음(HTTP 200)', expect: ({ response, text }) => response.status === 200 && !KEY_PATTERN.test(text) });
  if (originalApiUrl) {
    await http('4·5', '금지', '공개용(anon) 키로 Data API 직접 읽기', null, {
      url: originalApiUrl, headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` },
      expected: '거부(HTTP 401 또는 403)', expect: ({ response }) => response.status === 401 || response.status === 403,
    });
  }
  await http('8', '금지', '비로그인 GET /api/instructor/x', '/api/instructor/x', { expected: 'HTTP 401 JSON', expect: refused401 });
  await http('8', '금지', '비로그인 PUT /api/notices/x', '/api/notices/x', { method: 'PUT', body: { title: 'x' }, expected: 'HTTP 401 JSON', expect: refused401 });
  await http('10', '금지', '비로그인 POST /api/restore/notes', '/api/restore/notes', { method: 'POST', body: { id: '00000000-0000-4000-8000-000000000000' }, expected: 'HTTP 401 JSON', expect: refused401 });
  await http('11', '정상', 'GET /manifest.webmanifest', '/manifest.webmanifest', { expected: 'HTTP 200(앱 이름 있음)', expect: ({ response, text }) => { try { return response.status === 200 && Boolean(JSON.parse(text).name); } catch { return false; } } });
  await http('11', '금지', '비로그인 GET /api/device', '/api/device', { expected: 'HTTP 401 JSON', expect: refused401 });
  await http('12', '금지', '비로그인 GET /api/device?view=ops (작전실 요약)', '/api/device?view=ops', { expected: 'HTTP 401 JSON', expect: refused401 });
  await http('12', '정상', 'GET /ops.html (작전실 화면 파일)', '/ops.html', { expected: 'HTTP 200', expect: status(200) });

  // 판정기·탐지 함수를 이 컴퓨터에서 직접 부른다(요청 ID 는 판정 요청의 UUID).
  async function local(stage, kind, label, expected, call, check) {
    const requestId = newId();
    const result = await call(requestId);
    const shown = result.decision ? `${result.decision}/${result.reasonCode}` : (result.action === 'observe' ? 'observe' : `${result.action}/${result.reasonCode}`);
    row(stage, kind, label, expected, shown, requestId, '실측(로컬)', check(result) ? '일치' : '불일치');
  }
  const memoRead = { service: 'notes', method: 'GET', path: '/notes/demo', route: 'GET /notes/:id' };
  const usual = { signals: { source: 'judge_fixture', region: 'local', network: 'usual', hour: 14 }, recentEvents: [], stepUp: { verified: false, authAgeSeconds: null } };
  const unusual = { signals: { source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3 }, recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }], stepUp: { verified: false, authAgeSeconds: null } };
  const ask = (extra) => requestId => decide({ requestId, deviceRegistered: true, ...memoRead, ...usual, ...extra });
  await local('6', '정상', '판정기: 등록 기기의 자기 메모 읽기', 'allow/approved', ask({}), r => r.decision === 'allow');
  await local('6', '금지', '판정기: 미등록 기기', 'deny/device_not_registered', ask({ deviceRegistered: false }), r => r.decision === 'deny' && r.reasonCode === 'device_not_registered');
  await local('7', '금지', '판정기: 복합 이상 사건(재확인 없음)', 'step_up/step_up_required', ask(unusual), r => r.decision === 'step_up');
  await local('7', '정상', '판정기: 다시 확인한 복합 이상 사건', 'allow/approved', ask({ ...unusual, stepUp: { verified: true, authAgeSeconds: 60 } }), r => r.decision === 'allow');
  await local('8', '금지', '판정기: 메모 전체 목록', 'deny/resource_not_allowed', ask({ path: '/notes', route: 'GET /notes' }), r => r.decision === 'deny' && r.reasonCode === 'resource_not_allowed');
  await local('8', '금지', '판정기: 반 공지 쓰기', 'deny/resource_not_allowed', ask({ service: 'notices', method: 'POST', path: '/notices', route: 'POST /notices' }), r => r.decision === 'deny');
  await local('8', '금지', '판정기: 강사 자료 읽기', 'deny/resource_not_allowed', ask({ service: 'instructor', path: '/instructor/x', route: 'GET /instructor/:id' }), r => r.decision === 'deny');
  const reads = count => Array.from({ length: count }, (_, index) => ({ at: new Date(Date.UTC(2026, 9, 1) + index * 2000).toISOString(), method: 'GET', identity: { sub: 'learner_fixture' } }));
  await local('9', '정상', '탐지: 10분 안 GET 120건', 'observe', async () => detect(reads(120)), r => r.action === 'observe');
  await local('9', '금지', '탐지: 10분 안 GET 121건', 'propose_revocation/burst_read', async () => detect(reads(121)), r => r.action === 'propose_revocation' && r.reasonCode === 'burst_read');

  // 실행하지 않은 것과 사용자가 알려 준 것. 통과로 세지 않는다.
  const notRun = (stage, kind, label, expected, why) => row(stage, kind, label, expected, `미실행: ${why}`, null, '미실행', '—');
  const reported = (stage, kind, label, expected, actual) => row(stage, kind, label, expected, actual, null, '사용자 보고', '—');
  notRun('3·4', '정상', '로그인한 A 의 메모 읽기·추가·수정·삭제', 'HTTP 200/201', '로그인 토큰이 필요해 이 절차는 요청하지 않음');
  notRun('4', '금지', 'B 가 A 의 메모 읽기·수정·삭제', 'HTTP 404', '로그인 토큰이 필요해 이 절차는 요청하지 않음(가짜 표 시험으로만 확인)');
  notRun('8', '금지', '로그인한 사용자의 다른 구역 직접 요청', '거부', '로그인 토큰이 필요해 이 절차는 요청하지 않음');
  reported('10', '정상', 'B 의 메모 한 건 복원(POST /api/restore/notes)', '복원 성공, 재요청 409, B 읽기 200', '복원 restored true, 재요청 409, B 읽기 200(캡처 없음)');
  notRun('10', '금지', 'A 가 B 의 백업 복원 요청', 'HTTP 404', '로그인 토큰이 필요해 실행하지 않음');
  reported('11', '정상', '기기 승인 후 메모 표시', '승인됨, 메모 표시', '승인됨, 메모 추가 칸과 메모 목록 표시(캡처 없음)');
  notRun('11', '금지', '새 브라우저에서 같은 계정으로 로그인', '다시 승인 필요', '확인하지 않음');
  notRun('12', '정상', '로그인한 사용자의 작전실 요약', 'HTTP 200, 실측·미실행 구분', '로그인 토큰이 필요해 이 절차는 요청하지 않음(가짜 표 시험으로만 확인)');
  notRun('심판', '금지', '심판의 41종 공격 방어 시험', '모두 방어', '이 저장소에서 실행하지 않음. 심판이 실행하는 시험이며 임의로 통과 처리하지 않음');
  return rows;
}

const cell = text => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
export function toMarkdown(rows, { baseUrl }) {
  const head = '| 단계 | 구분 | 요청 | 기대 결과 | 실제 결과 | 요청 ID | 확인 시각 | 상태 | 일치 |\n|---|---|---|---|---|---|---|---|---|';
  const body = rows.map(r => `| ${[r.stage, r.kind, r.request, r.expected, r.actual, r.requestId, r.checkedAt, r.status, r.match].map(cell).join(' | ')} |`);
  const counted = status => rows.filter(r => r.status === status).length;
  const mismatches = rows.filter(r => r.match === '불일치').length;
  const summary = `실측(배포) ${counted('실측(배포)')}건, 실측(로컬) ${counted('실측(로컬)')}건, 사용자 보고 ${counted('사용자 보고')}건, 미실행 ${counted('미실행')}건. 기대와 다른 실측 ${mismatches}건.`;
  return `# 정상·금지 요청 실측 표\n\n대상: ${baseUrl}\n\n${head}\n${body.join('\n')}\n\n${summary}\n`;
}

async function main() {
  const config = JSON.parse(await readFile(join(root, 'aleph.config.json'), 'utf8'));
  const baseUrl = process.env.OPS_BASE_URL ?? config.publicAppUrl;
  const rows = await buildRows({ baseUrl, originalApiUrl: config.originalApiUrl });
  const markdown = toMarkdown(rows, { baseUrl });
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', 'ops-table.md'), markdown, 'utf8');
  process.stdout.write(markdown);
  process.stdout.write('\n저장: artifacts/ops-table.md (Git 제외). 미실행 항목은 통과가 아닙니다.\n');
  if (rows.some(r => r.match === '불일치')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
