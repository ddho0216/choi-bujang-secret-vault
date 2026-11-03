import { randomUUID } from 'node:crypto';
import config from '../aleph.config.json' with { type: 'json' };
import safePolicy from '../policy/safe-policy.json' with { type: 'json' };
import { RULE_IDS } from './decider.mjs';
import { BURST_READ_RULE } from './detect.mjs';
import { buildSnapshot, diffPolicies, policyHash } from './policy-snapshot.mjs';

// 12단계 탈환 작전실 요약: GET /api/device?view=ops (서버 함수 한도 때문에 기기 승인 함수에 붙였다).
// 각 항목은 status 로 구분한다.
//   verified : 서버가 이번 요청에서 직접 읽거나 계산한 값
//   not_run  : 이 저장소에 연결되어 있지 않거나 실행하지 않은 것(값을 지어내지 않는다)
// 메모 제목·본문·소유자 ID·기기 값은 내려 주지 않는다. 숫자(건수)와 상태 이름만 내려 준다.
const item = (id, label, status, source, value, note) => ({ id, label, status, source, value, ...(note ? { note } : {}) });

export function createOpsSummary({ supabase, now = () => Date.now(), newRequestId = randomUUID }) {
  async function countRows(table, user) {
    const { data, error } = await supabase.from(table).select('id').eq(table === 'device_approvals' ? 'user_id' : 'owner_id', user.userId);
    if (error) return null;
    return (data ?? []).length;
  }

  return async function summary({ request, user, deviceStatus }) {
    const checkedAt = new Date(now()).toISOString();
    const [notes, backups] = [await countRows('notes', user), await countRows('notes_backup', user)];
    const drift = diffPolicies(safePolicy, buildSnapshot({ allowedRoutes: config.allowedRoutes }));
    const counted = (count, what) => (count === null
      ? item(what.id, what.label, 'not_run', what.source, null, '서버가 이 표를 읽지 못해 값을 알 수 없습니다(표가 없거나 연결 오류).')
      : item(what.id, what.label, 'verified', what.source, { count }));
    return {
      schema: 'aleph.ops.summary.v1',
      requestId: newRequestId(),
      platformRequestId: typeof request?.headers?.['x-vercel-id'] === 'string' ? request.headers['x-vercel-id'].slice(0, 120) : null,
      checkedAt,
      items: [
        item('decider_rules', '판정기 규칙', 'verified', 'src/decider.mjs 의 RULE_IDS', { ruleIds: [...RULE_IDS] }),
        item('detect_rule', '탐지 규칙', 'verified', 'src/detect.mjs 의 BURST_READ_RULE', { ...BURST_READ_RULE }),
        item('detect_events', '탐지 사건', 'not_run', '없음', null,
          '자료실 서버는 detect() 를 호출하지 않고 사건 저장소도 없어서 지금까지 탐지된 사건 수를 알 수 없습니다. 운영 반 엔진의 사건 전달은 연결하지 않았습니다.'),
        item('revocation', '회수 상태', 'not_run', '없음', null,
          '접속 회수는 연결하지 않았습니다. detect() 는 회수 제안만 돌려주고 접속을 끊지 않습니다.'),
        item('policy_copy', '복구 버전(안전 정책 사본)', 'verified', 'policy/safe-policy.json',
          { version: safePolicy.version, hash: policyHash(safePolicy).slice(0, 12), driftFromCode: drift.length },
          drift.length === 0 ? '검증한 사본이 현재 코드·설정과 같습니다.' : `현재 코드·설정과 ${drift.length}곳이 다릅니다.`),
        counted(notes, { id: 'my_notes', label: '내 메모 건수', source: 'notes 표(내 계정 행만 센 건수)' }),
        counted(backups, { id: 'my_backups', label: '내 비공개 백업 건수', source: 'notes_backup 표(내 계정 행만 센 건수)' }),
        item('device', '이 기기 승인 상태', 'verified', 'device_approvals 표', { status: deviceStatus }),
      ],
    };
  };
}
