// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SUPABASE_PUBLISHABLE_KEY as PUBLISHABLE_KEY } from './supabase-public.mjs';

export async function runAttackChecks(config) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(config.step)) {
    throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  }
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  const anonymousGet = (path) => fetch(new URL(path, app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  const readJson = async (response) => {
    if (!response.ok) return null;
    try {
      return await response.json();
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
      return null;
    }
  };

  const response = await anonymousGet('/data.json');
  const data = await readJson(response);
  const visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
    && data.notes.length > 0;
  if (config.step === 1) {
    return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
      observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
  }

  if (config.step >= 3) {
    // 3단계~: 로그인 없는 요청은 서버가 거부해야 한다. 실제로 보낸 요청의 응답 코드만 기록한다.
    const anonymous = (path, init = {}) => fetch(new URL(path, app), {
      redirect: 'error', signal: AbortSignal.timeout(10000), ...init,
    });
    const jsonHeaders = { 'Content-Type': 'application/json' };
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const list = await anonymous('/api/notes');
    const create = await anonymous('/api/notes', { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ title: 'anonymous', body: 'anonymous' }) });
    const update = await anonymous(`/api/notes/${fakeId}`, { method: 'PUT', headers: jsonHeaders,
      body: JSON.stringify({ title: 'anonymous', body: 'anonymous' }) });
    const remove = await anonymous(`/api/notes/${fakeId}`, { method: 'DELETE' });
    const listBody = await readJson(list);
    const result = (response) => (response.status === 401 ? '거부됨 (HTTP 401)' : `거부되지 않음 (HTTP ${response.status})`);
    const attempts = [
      { attackId: 'anonymous_static_data_read', expected: '/data.json에서 가상 메모가 보이지 않아야 함',
        observed: visible ? '비로그인 요청에서 /data.json에 가상 메모가 아직 보임'
          : `비로그인 요청에서 /data.json에 메모가 보이지 않음 (HTTP ${response.status})` },
      { attackId: 'anonymous_list_read', expected: '로그인 없이 목록을 읽을 수 없어야 함',
        observed: `비로그인 GET /api/notes ${result(list)}${Array.isArray(listBody) ? ', 목록이 돌아옴' : ''}` },
      { attackId: 'anonymous_note_create', expected: '로그인 없이 메모를 추가할 수 없어야 함',
        observed: `비로그인 POST /api/notes ${result(create)}` },
      { attackId: 'anonymous_note_update_delete', expected: '로그인 없이 메모를 수정·삭제할 수 없어야 함',
        observed: `비로그인 PUT /api/notes/:id ${result(update)}, 비로그인 DELETE /api/notes/:id ${result(remove)}` },
    ];
    if (config.step === 3) return attempts;

    // 4단계~: 직접 Data API는 anon(공개용) 키로만 확인한다. 읽기와, 아무 행도 가리키지 않는 삭제를 보낸다.
    // 5단계부터는 aleph.config.json의 originalApiUrl(쿼리 없는 원본 자료 경로)을 그대로 쓴다.
    const dataApi = new URL(config.originalApiUrl ?? new URL('/rest/v1/notes', new URL(config.identityProvider.issuer).origin));
    const anonHeaders = { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${PUBLISHABLE_KEY}` };
    const direct = (method, search) => fetch(Object.assign(new URL(dataApi), { search }), {
      method, headers: anonHeaders, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    const directRead = await direct('GET', '?select=id');
    const directRows = await readJson(directRead);
    const directDelete = await direct('DELETE', `?id=eq.${fakeId}`);
    const denied = (res) => ([401, 403].includes(res.status) ? `거부됨 (HTTP ${res.status})` : `거부되지 않음 (HTTP ${res.status})`);
    // 5단계~: 화면 응답에 Supabase 공개 키가 없어야 한다(로그인은 서버 함수가 대신한다).
    const screen = await anonymous('/');
    const screenText = screen.ok ? await screen.text() : '';
    const keyPattern = /sb_publishable_|sb_secret_|eyJ[A-Za-z0-9_-]{12,}.eyJ/u;
    attempts.push(
      { attackId: 'anon_data_api_read', expected: '공개 키(anon)로 Data API에서 메모를 읽을 수 없어야 함',
        observed: `anon 키로 GET /rest/v1/notes ${denied(directRead)}${Array.isArray(directRows) ? `, 행 ${directRows.length}건이 돌아옴` : ''}` },
      { attackId: 'anon_data_api_delete', expected: '공개 키(anon)로 Data API에서 메모를 지울 수 없어야 함',
        observed: `anon 키로 DELETE /rest/v1/notes ${denied(directDelete)}` },
      { attackId: 'cross_owner_access', expected: 'B가 A의 메모를 읽기·수정·삭제하면 거부되어야 함',
        observed: '미실행: 로그인 토큰이 필요해 이 점검에서는 요청하지 않음. 로컬 시험(가짜 표)으로만 확인함' },
    );
    if (config.step >= 5) {
      attempts.push({ attackId: 'screen_has_no_public_key', expected: '첫 화면 응답에 Supabase 공개 키가 없어야 함',
        observed: !screen.ok ? `첫 화면을 읽지 못함 (HTTP ${screen.status})`
          : keyPattern.test(screenText) ? '첫 화면 응답에 키 문자열이 보임' : '첫 화면 응답에 키 문자열이 보이지 않음' });
    }
    if (config.step >= 6) {
      // 6단계: 판정기(src/decider.mjs)를 이 컴퓨터에서 직접 불러 가상 요청을 넣어 본다.
      // 네트워크 요청이 아니고 심판의 판정도 아니다. 미등록 기기 공격은 심판이 확인한다.
      const { decide } = await import('./decider.mjs');
      // 판정 요청은 서비스·메서드·경로·경로 모양을 항상 담는다. 점검 요청은 자기 메모 한 건 읽기 모양으로 보낸다.
      const memoRead = { service: 'notes', method: 'GET', path: '/notes/demo', route: 'GET /notes/:id' };
      const registered = await decide({ requestId: randomUUID(), deviceRegistered: true, ...memoRead });
      const unregistered = await decide({ requestId: randomUUID(), deviceRegistered: false, ...memoRead });
      attempts.push(
        { attackId: 'device_rule_local', expected: '등록 기기의 가상 요청은 allow, 미등록 기기의 가상 요청은 deny와 device_not_registered',
          observed: `로컬 판정기 호출: 등록 기기 → ${registered.decision}/${registered.reasonCode}, 미등록 기기 → ${unregistered.decision}/${unregistered.reasonCode} (심판의 판정이 아님)` },
      );
      if (config.step >= 7) {
        // 7단계: 가상 사건을 판정기에 넣어 본다(로컬 호출이며 심판의 판정이 아니다).
        const stepUp = { verified: false, authAgeSeconds: null };
        const unusual = { ...memoRead, deviceRegistered: true, signals: { source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3 },
          recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }], stepUp };
        const usual = { ...memoRead, deviceRegistered: true, signals: { source: 'judge_fixture', region: 'local', network: 'usual', hour: 14 },
          recentEvents: [], stepUp };
        const flagged = await decide({ requestId: randomUUID(), ...unusual });
        const confirmed = await decide({ requestId: randomUUID(), ...unusual, stepUp: { verified: true, authAgeSeconds: 60 } });
        const ordinary = await decide({ requestId: randomUUID(), ...usual });
        const forged = await decide({ requestId: randomUUID(), ...unusual, headers: { 'x-network': 'usual', 'x-hour': '14' }, geo: { region: 'local' } });
        const shown = response => `${response.decision}/${response.reasonCode}`;
        attempts.push(
          { attackId: 'step_up_cases_local', expected: '복합 이상 가상 사건은 step_up과 step_up_required, 정상 가상 사건은 allow, 다시 확인한 복합 이상은 allow, 위조 헤더를 덧붙인 복합 이상은 그대로 step_up',
            observed: `로컬 판정기 호출: 복합 이상 → ${shown(flagged)}, 정상 → ${shown(ordinary)}, 다시 확인한 복합 이상 → ${shown(confirmed)}, 위조 헤더를 덧붙인 복합 이상 → ${shown(forged)} (심판의 판정이 아님)` },
          { attackId: 'relogin_block_not_run', expected: '확인 전 자료를 막고 새 로그인 뒤 요청을 다시 판정',
            observed: '미실행: 엔진이 같은 로그인으로 다시 로그인한 시각을 검증하는 계약을 이 저장소에서 찾지 못했고, 자료실 서버가 판정기를 호출하지 않음' },
        );
      }
      if (config.step >= 8) {
        // 8단계: 로그인 없이 다른 구역을 직접 부르면 JSON 으로 거부되어야 한다(실제 요청).
        const isJson = res => (res.headers.get('content-type') ?? '').includes('json');
        const instructorApi = await anonymous('/api/instructor/x');
        const noticeWriteApi = await anonymous('/api/notices/x', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ title: 'anonymous' }) });
        const refused = res => (res.status === 401 && isJson(res) ? `거부됨 (HTTP 401, JSON)` : `거부되지 않음 (HTTP ${res.status}${isJson(res) ? ', JSON' : ', JSON 아님'})`);
        // 판정기에 가상 요청을 넣어 구역 규칙을 본다(로컬 호출이며 심판의 판정이 아니다).
        const base = { deviceRegistered: true, signals: { source: 'judge_fixture', region: 'local', network: 'usual', hour: 14 },
          recentEvents: [], stepUp: { verified: false, authAgeSeconds: null } };
        const zone = (method, path, service, route) => decide({ requestId: randomUUID(), ...base, method, path, service, route });
        const memoReadResult = await zone('GET', '/notes/demo', 'notes', 'GET /notes/:id');
        const memoList = await zone('GET', '/notes', 'notes', 'GET /notes');
        const noticeWrite = await zone('POST', '/notices', 'notices', 'POST /notices');
        const instructorRead = await zone('GET', '/instructor/x', 'instructor', 'GET /instructor/:id');
        const shown = response => `${response.decision}/${response.reasonCode}`;
        attempts.push(
          { attackId: 'anonymous_other_zone_api', expected: '로그인 없이 강사 자료 경로를 부르거나 반 공지를 쓰려 하면 401 JSON 으로 거부',
            observed: `비로그인 GET /api/instructor/x ${refused(instructorApi)}, 비로그인 PUT /api/notices/x ${refused(noticeWriteApi)}` },
          { attackId: 'zone_rules_local', expected: '자기 메모 한 건 읽기는 allow, 메모 전체 목록·반 공지 쓰기·강사 자료는 deny와 resource_not_allowed',
            observed: `로컬 판정기 호출: GET /notes/:id → ${shown(memoReadResult)}, GET /notes → ${shown(memoList)}, POST /notices → ${shown(noticeWrite)}, GET /instructor/:id → ${shown(instructorRead)} (심판의 판정이 아님)` },
          { attackId: 'other_zone_authenticated_api', expected: '로그인한 사용자가 다른 구역 자료를 직접 API 로 요청하면 거부',
            observed: '미실행: 로그인 토큰이 필요해 이 점검에서는 요청하지 않음. 로컬 시험(가짜 표)으로만 확인함' },
        );
      }
      if (config.step >= 9) {
        // 9단계: 가상 조회 사건을 탐지 함수에 넣어 본다(로컬 호출이며 심판의 판정도, 실제 접속 회수도 아니다).
        const { detect } = await import('./detect.mjs');
        const START = Date.UTC(2026, 9, 1);
        const reads = (count, sub = 'learner_fixture') => Array.from({ length: count }, (_, index) => ({
          at: new Date(START + index * 2000).toISOString(), method: 'GET', identity: { sub } }));
        const seen = result => (result.action === 'observe' ? 'observe' : `${result.action}/${result.reasonCode}`);
        const two = [...reads(100), ...reads(100, 'other_fixture')];
        attempts.push(
          { attackId: 'burst_read_local', expected: '10분 안 120건은 observe, 121건·200건은 propose_revocation과 burst_read, 두 사용자 각 100건은 observe',
            observed: `로컬 탐지 호출: 120건 → ${seen(detect(reads(120)))}, 121건 → ${seen(detect(reads(121)))}, 200건 → ${seen(detect(reads(200)))}, 두 사용자 각 100건 → ${seen(detect(two))} (가상 사건이며 심판의 판정이 아님)` },
          { attackId: 'revocation_not_run', expected: '운영 반 엔진이 검증한 사건을 전달하고 회수 제안을 집행',
            observed: '미실행: 운영 반 엔진의 사건 전달과 접속 회수는 연결·시험하지 않음. detect()는 회수 제안을 돌려줄 뿐 접속을 끊지 않음' },
        );
      }
      if (config.step >= 10) {
        // 10단계: 검증한 안전 정책 사본을 읽고, 임시 시험 정책(메모리 안)에서 침공 흉내와 복원을 해 본다. 파일은 쓰지 않는다.
        const { readVerifiedCopy } = await import('./policy-files.mjs');
        const { applyRestore, createTestPolicy, policyHash, runDemo, simulateTamper } = await import('./policy-snapshot.mjs');
        const root = new URL('../policy', import.meta.url);
        let observed;
        try {
          const { policy: verified, hash } = await readVerifiedCopy(fileURLToPath(root));
          const at = '2026-10-01T00:00:00.000Z';
          const tampered = simulateTamper(createTestPolicy(verified, { at }), { at });
          const { next } = applyRestore({ verified, test: tampered, at });
          const blocked = results => results.filter(item => item.name.startsWith('B의')).every(item => !item.allow);
          const normal = results => results.filter(item => item.name.startsWith('A의')).every(item => item.allow);
          observed = `로컬 계산: 검증한 사본 해시 통과(${hash.slice(0, 12)}…), 침공 흉내 중 B의 A 자료 요청 ${blocked(runDemo(tampered)) ? '거부됨' : '허용됨'}, 복원 후 B의 A 자료 요청 ${blocked(runDemo(next)) ? '다시 거부됨' : '여전히 허용됨'}, A 정상 요청 ${normal(runDemo(next)) ? '유지됨' : '막힘'}, 복원 후 정책 해시 ${policyHash(next.services.notes) === policyHash(verified.services.notes) ? '메모 규칙이 사본과 같음' : '다름'} (실제 운영 정책·심판 판정이 아님)`;
        } catch (error) {
          observed = `검증한 사본을 확인하지 못함: ${error?.message ?? error}`;
        }
        attempts.push(
          { attackId: 'policy_restore_local', expected: '검증한 안전 정책 사본의 해시가 맞고, 규칙을 바꾼 시험 정책을 복원하면 B의 A 자료 요청은 다시 거부되고 A의 정상 요청은 유지', observed },
          { attackId: 'memo_restore_live_user_run', expected: 'B의 메모 한 건을 배포된 POST /api/restore/notes 로 되살리고 B의 로그인으로 확인',
            observed: '이 점검은 요청하지 않음(로그인 토큰 필요). 사용자가 B로 직접 실행해 알려 준 결과: 복원 restored true, 같은 요청 반복 409, B가 읽기 200. A의 요청 404는 미실행' },
        );
      }
      if (config.step >= 11) {
        // 11단계: 로그인 없이 기기 승인 경로를 부르면 거부되어야 하고, 앱 설정(manifest)에는 키·토큰이 없어야 한다(실제 요청).
        const isJson = res => (res.headers.get('content-type') ?? '').includes('json');
        const deviceStatus = await anonymous('/api/device');
        const deviceRequest = await anonymous('/api/device', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: 'request' }) });
        const manifest = await anonymous('/manifest.webmanifest');
        const manifestText = manifest.ok ? await manifest.text() : '';
        let manifestName = null;
        try { manifestName = JSON.parse(manifestText)?.name ?? null; } catch { /* 형식이 맞지 않으면 이름 없음으로 본다 */ }
        const refusedDevice = res => (res.status === 401 && isJson(res) ? '거부됨 (HTTP 401, JSON)' : `거부되지 않음 (HTTP ${res.status}${isJson(res) ? ', JSON' : ', JSON 아님'})`);
        attempts.push(
          { attackId: 'anonymous_device_api', expected: '로그인 없이 기기 승인 경로를 읽거나 승인 요청을 보내면 401 JSON 으로 거부, 앱 설정(manifest)에는 키 문자열이 없어야 함',
            observed: `비로그인 GET /api/device ${refusedDevice(deviceStatus)}, 비로그인 POST /api/device ${refusedDevice(deviceRequest)}, manifest ${manifest.ok && manifestName ? 'HTTP 200 이름 있음' : `읽지 못함 (HTTP ${manifest.status})`}, manifest에 키 문자열 ${keyPattern.test(manifestText) ? '보임' : '보이지 않음'}` },
          { attackId: 'device_approval_live_user_run', expected: '로그인한 사용자가 이 기기를 승인 요청하고 비밀번호를 다시 확인해 승인한 뒤 자료실이 열림',
            observed: '이 점검은 요청하지 않음(로그인·비밀번호 필요). 사용자가 직접 실행해 알려 준 결과: 승인됨, 메모 추가 칸과 메모 목록 표시. 새 브라우저 재승인·앱 설치·오프라인 화면은 미실행' },
        );
      }
    }
    return attempts;
  }

  // 2단계: 옛 공개 파일은 사라져야 하고, 서버 함수는 아직 공개라서 읽힐 수 있다.
  const apiResponse = await anonymousGet('/api/notes');
  const apiData = await readJson(apiResponse);
  const apiCount = Array.isArray(apiData?.notes) ? apiData.notes.length : 0;
  return [
    { attackId: 'anonymous_static_data_read', expected: '/data.json에서 가상 메모가 보이지 않아야 함',
      observed: visible ? '비로그인 요청에서 /data.json에 가상 메모가 아직 보임'
        : `비로그인 요청에서 /data.json에 메모가 보이지 않음 (HTTP ${response.status})` },
    { attackId: 'anonymous_api_notes_read', expected: '3단계 이전이라 /api/notes는 로그인 없이 읽히는 약점이 남아 있음',
      observed: apiCount > 0 ? `비로그인 요청에서 /api/notes가 메모 ${apiCount}건을 돌려줌 (약점 남음)`
        : `비로그인 요청에서 /api/notes가 메모를 돌려주지 않음 (HTTP ${apiResponse.status})` },
  ];
}
