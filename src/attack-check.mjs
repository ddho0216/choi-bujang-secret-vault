// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
import { SUPABASE_PUBLISHABLE_KEY as PUBLISHABLE_KEY } from './supabase-public.mjs';

export async function runAttackChecks(config) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(config.step)) {
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
    // 3단계~: 제출 환경에서는 공개 HTTPS 주소로 GET 요청만 보낼 수 있다.
    // - 실제로 보낸 GET 이 있는 점검은 그 응답의 HTTP 상태를 observed 에 적는다.
    // - 요청하지 않았거나(쓰기 요청, 로그인 토큰이 필요한 요청) 이 컴퓨터의 로컬 가상 시험뿐인 점검은 observed 를 'not_run' 으로 둔다.
    //   로컬 시험 결과는 README 와 npm run test:* 로 확인하며 이 제출 증거에는 실제 요청처럼 적지 않는다.
    const get = (path, init = {}) => fetch(new URL(path, app), {
      redirect: 'error', signal: AbortSignal.timeout(10000), ...init,
    });
    const notRun = (attackId, expected) => ({ attackId, expected, observed: 'not_run' });
    const status = (res) => `HTTP ${res.status}`;
    const list = await get('/api/notes');
    const attempts = [
      { attackId: 'anonymous_static_data_read', expected: '/data.json에서 가상 메모가 보이지 않아야 함',
        observed: `GET /data.json ${status(response)}${visible ? ', 가상 메모가 보임' : ''}` },
      { attackId: 'anonymous_list_read', expected: '로그인 없이 목록을 읽을 수 없어야 함',
        observed: `GET /api/notes ${status(list)}` },
      notRun('anonymous_note_create', '로그인 없이 메모를 추가할 수 없어야 함'),
      notRun('anonymous_note_update_delete', '로그인 없이 메모를 수정·삭제할 수 없어야 함'),
    ];
    if (config.step === 3) return attempts;

    // 4단계~: 직접 Data API는 anon(공개용) 키로만 확인한다. 5단계부터는 aleph.config.json의 originalApiUrl을 그대로 쓴다.
    const dataApi = new URL(config.originalApiUrl ?? new URL('/rest/v1/notes', new URL(config.identityProvider.issuer).origin));
    const directRead = await fetch(Object.assign(new URL(dataApi), { search: '?select=id' }), {
      method: 'GET', headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${PUBLISHABLE_KEY}` },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    // 5단계~: 화면 응답에 Supabase 공개 키가 없어야 한다(로그인은 서버 함수가 대신한다).
    const screen = await get('/');
    const screenText = screen.ok ? await screen.text() : '';
    const keyPattern = /sb_publishable_|sb_secret_|eyJ[A-Za-z0-9_-]{12,}.eyJ/u;
    attempts.push(
      { attackId: 'anon_data_api_read', expected: '공개 키(anon)로 Data API에서 메모를 읽을 수 없어야 함',
        observed: `GET /rest/v1/notes (anon 키) ${status(directRead)}` },
      notRun('anon_data_api_delete', '공개 키(anon)로 Data API에서 메모를 지울 수 없어야 함'),
      notRun('cross_owner_access', 'B가 A의 메모를 읽기·수정·삭제하면 거부되어야 함'),
    );
    if (config.step >= 5) {
      attempts.push({ attackId: 'screen_has_no_public_key', expected: '첫 화면 응답에 Supabase 공개 키가 없어야 함',
        observed: `GET / ${status(screen)}${screen.ok ? `, 키 문자열 ${keyPattern.test(screenText) ? '보임' : '보이지 않음'}` : ''}` });
    }
    if (config.step >= 6) {
      attempts.push(notRun('device_rule_local', '등록 기기의 가상 요청은 allow, 미등록 기기의 가상 요청은 deny와 device_not_registered'));
    }
    if (config.step >= 7) {
      attempts.push(
        notRun('step_up_cases_local', '복합 이상 가상 사건은 step_up, 정상 사건은 allow, 다시 확인한 복합 이상은 allow'),
        notRun('relogin_block_not_run', '확인 전 자료를 막고 새 로그인 뒤 요청을 다시 판정'),
      );
    }
    if (config.step >= 8) {
      // 8단계: 로그인 없이 다른 구역을 직접 부르면 JSON 으로 거부되어야 한다(실제 요청).
      const instructorApi = await get('/api/instructor/x');
      attempts.push(
        { attackId: 'anonymous_other_zone_api', expected: '로그인 없이 강사 자료 경로를 부르면 401 JSON 으로 거부',
          observed: `GET /api/instructor/x ${status(instructorApi)}` },
        notRun('zone_rules_local', '자기 메모 한 건 읽기는 allow, 메모 전체 목록·반 공지 쓰기·강사 자료는 deny와 resource_not_allowed'),
        notRun('other_zone_authenticated_api', '로그인한 사용자가 다른 구역 자료를 직접 API 로 요청하면 거부'),
      );
    }
    if (config.step >= 9) {
      attempts.push(
        notRun('burst_read_local', '10분 안 120건은 observe, 121건 이상은 propose_revocation과 burst_read'),
        notRun('revocation_not_run', '운영 반 엔진이 검증한 사건을 전달하고 회수 제안을 집행'),
      );
    }
    if (config.step >= 10) {
      attempts.push(notRun('policy_and_memo_restore', '안전 정책 사본 해시 확인과 복원 뒤 B의 A 자료 요청 거부, B의 메모 한 건 복원'));
    }
    if (config.step >= 11) {
      // 11단계: 로그인 없이 기기 승인 경로를 읽으면 거부되어야 한다(실제 요청).
      const deviceApi = await get('/api/device');
      attempts.push({ attackId: 'anonymous_device_api', expected: '로그인 없이 기기 승인 경로를 읽으면 401 JSON 으로 거부',
        observed: `GET /api/device ${status(deviceApi)}` });
    }
    if (config.step >= 12) {
      // 12단계: 로그인 없이 작전실 요약을 읽으면 거부되어야 한다(실제 요청).
      const opsApi = await get('/api/device?view=ops');
      attempts.push(
        { attackId: 'anonymous_ops_api', expected: '로그인 없이 작전실 요약을 부르면 401 JSON 으로 거부',
          observed: `GET /api/device?view=ops ${status(opsApi)}` },
        notRun('ops_live_and_judge_suite_not_run', '로그인한 사용자의 작전실 요약이 실측·미실행을 구분해 보여 주고, 심판의 41종 공격 방어 시험을 통과'),
      );
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
