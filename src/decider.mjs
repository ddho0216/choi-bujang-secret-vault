// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
// 요청은 docs/DECIDER_REQUEST.md 의 이름만 읽습니다(request.role, identity, device, geo 같은 값은 읽지 않습니다).
//
// 6단계 device_registered: 등록한 기기만 들어옵니다. deviceRegistered 가 true 일 때만 통과시키고,
//   false 이거나 값이 없거나 true 가 아니면 deny 와 이유 코드 device_not_registered 로 거부합니다.
// 7단계 step_up_required: 평소와 다른 시각, 처음 보는 네트워크, 갑자기 몰린 사건이 한꺼번에 있으면
//   deny 가 아니라 step_up(추가 본인 확인)으로 보냅니다. 다시 확인한 요청은 통과시킵니다.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required']);

// 7단계 입력 검사: 접속 정보(request.signals)는 엔진이 검증해 넘긴 것만 믿습니다.
// 믿는 출처는 심판의 가상 사건에 엔진이 붙이는 'judge_fixture' 하나입니다. 실제 경로의 'none'이나
// 알 수 없는 출처는 근거로 쓰지 않습니다. 브라우저가 보낸 헤더·위치(request.headers, geo, clientIp 등)는
// 읽지 않으므로 위조한 값이 접속 정보로 승격될 길이 없습니다.
// 값이 없거나 모양이 다르면 null 로 두고 정상값(usual, local, 낮 시각)으로 채우지 않습니다.
const TRUSTED_SIGNAL_SOURCE = 'judge_fixture';
const NETWORKS = new Set(['usual', 'unusual']);
const REGIONS = new Set(['local', 'foreign']);
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function readSignals(request) {
  const signals = request?.signals;
  if (!isPlainObject(signals) || signals.source !== TRUSTED_SIGNAL_SOURCE) {
    return Object.freeze({ trusted: false, source: 'untrusted', region: null, network: null, hour: null });
  }
  return Object.freeze({
    trusted: true,
    source: TRUSTED_SIGNAL_SOURCE,
    region: REGIONS.has(signals.region) ? signals.region : null,
    network: NETWORKS.has(signals.network) ? signals.network : null,
    hour: Number.isInteger(signals.hour) && signals.hour >= 0 && signals.hour <= 23 ? signals.hour : null,
  });
}

// 기준값은 수업용 가정입니다. 실제 사용자의 평소 시각·네트워크 기록이 아닙니다.
const UNUSUAL_HOUR = hour => hour <= 5 || hour >= 23; // 심야 23시~5시
const BURST_WINDOW_SECONDS = 300; // 최근 5분
const BURST_THRESHOLD = 10; // 이 안의 사건 건수 합이 10 이상이면 갑자기 몰린 것
const STEP_UP_MAX_AGE_SECONDS = 900; // 계약: 다시 확인한 나이는 0~900초

// 엔진이 준 최근 사건(최대 12건) 가운데 최근 5분 안의 건수를 더합니다. 모양이 다른 항목은 건너뜁니다.
function recentBurstCount(request) {
  const events = Array.isArray(request?.recentEvents) ? request.recentEvents.slice(0, 12) : [];
  let total = 0;
  for (const event of events) {
    if (!isPlainObject(event)) continue;
    const { ageSeconds, count } = event;
    if (Number.isInteger(ageSeconds) && ageSeconds >= 0 && ageSeconds <= BURST_WINDOW_SECONDS
        && Number.isInteger(count) && count > 0) total += count;
  }
  return total;
}

// 다시 확인했다고 믿는 것은 계약에 맞는 모양일 때뿐입니다: verified 가 true 이고 나이가 0~900 사이 정수.
function verifiedStepUp(request) {
  const stepUp = request?.stepUp;
  return isPlainObject(stepUp) && stepUp.verified === true
    && Number.isInteger(stepUp.authAgeSeconds)
    && stepUp.authAgeSeconds >= 0 && stepUp.authAgeSeconds <= STEP_UP_MAX_AGE_SECONDS;
}

// 복합 이상: 세 가지가 모두 맞을 때만. 지역은 쓰지 않습니다(지역 하나만으로 막지 않기 위해).
function isCompositeAnomaly(request) {
  const signals = readSignals(request);
  return signals.trusted
    && signals.hour !== null && UNUSUAL_HOUR(signals.hour)
    && signals.network === 'unusual'
    && recentBurstCount(request) >= BURST_THRESHOLD;
}

const respond = (request, decision, reasonCode, ruleIds) => ({
  schema: 'aleph.decision.v1',
  requestId: request?.requestId,
  decision,
  reasonCode,
  ruleIds,
});

export async function decide(request) {
  // 6단계: 등록하지 않은 기기는 다른 조건을 보기 전에 거부합니다.
  if (request?.deviceRegistered !== true) {
    return respond(request, 'deny', 'device_not_registered', ['device_registered']);
  }
  // 7단계: 복합 이상 사건은 막지 않고 추가 확인을 요청합니다. 계약에 맞게 다시 확인한 요청은 통과합니다.
  if (isCompositeAnomaly(request)) {
    return verifiedStepUp(request)
      ? respond(request, 'allow', 'approved', ['device_registered', 'step_up_required'])
      : respond(request, 'step_up', 'step_up_required', ['step_up_required']);
  }
  return respond(request, 'allow', 'approved', ['device_registered']);
}
