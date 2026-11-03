// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
// 요청은 docs/DECIDER_REQUEST.md 의 이름만 읽습니다(역할·identity·device·geo 같은 필드는 읽지 않습니다).
//
// 6단계 device_registered: 등록한 기기만 들어옵니다. deviceRegistered 가 true 일 때만 통과시키고,
//   false 이거나 값이 없거나 true 가 아니면 deny 와 이유 코드 device_not_registered 로 거부합니다.
// 7단계 step_up_required: 평소와 다른 시각, 처음 보는 네트워크, 갑자기 몰린 사건이 한꺼번에 있으면
//   deny 가 아니라 step_up(추가 본인 확인)으로 보냅니다. 다시 확인한 요청은 통과시킵니다.
// 8단계 resource_zone: 자료마다 갈 수 있는 구역을 나눕니다. 허용 목록에 없는 요청은 deny 와 이유 코드 resource_not_allowed 입니다.
export const RULE_IDS = Object.freeze(['device_registered', 'resource_zone', 'step_up_required']);

// 7단계 입력 검사: 접속 정보(request.signals)는 엔진이 검증해 넘긴 것만 믿습니다.
// 믿는 출처는 심판의 가상 사건에 엔진이 붙이는 'judge_fixture' 하나입니다. 실제 경로의 'none'이나
// 알 수 없는 출처는 근거로 쓰지 않습니다. 브라우저가 보낸 헤더·위치(headers, geo, clientIp 등)는
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
const UNUSUAL_FROM_HOUR = 23; // 심야 23시~5시
const UNUSUAL_TO_HOUR = 5;
const UNUSUAL_HOUR = hour => hour <= UNUSUAL_TO_HOUR || hour >= UNUSUAL_FROM_HOUR;
const BURST_WINDOW_SECONDS = 300; // 최근 5분
const BURST_THRESHOLD = 10; // 이 안의 사건 건수 합이 10 이상이면 갑자기 몰린 것
const STEP_UP_MAX_AGE_SECONDS = 900; // 계약: 다시 확인한 나이는 0~900초
// 10단계 안전 정책 사본이 읽는 기준값입니다(판정에는 위 상수를 그대로 씁니다).
export const STEP_UP_POLICY = Object.freeze({
  unusualHours: Object.freeze({ from: UNUSUAL_FROM_HOUR, to: UNUSUAL_TO_HOUR }),
  burstWindowSeconds: BURST_WINDOW_SECONDS,
  burstThreshold: BURST_THRESHOLD,
  verifiedMaxAgeSeconds: STEP_UP_MAX_AGE_SECONDS,
});

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

// 8단계 자원 구역: 자료마다 종류(구역)와 자원 ID를 정합니다. 판정기와 서버 API가 같은 정의를 씁니다.
// 이 자료실에 실제로 있는 자료는 메모뿐입니다. 반 공지와 강사 자료는 구역만 정의했고 데이터는 없습니다.
export const RESOURCE_ZONES = Object.freeze({
  memo: Object.freeze({ kind: 'memo', service: 'notes', root: 'notes' }),
  class_notice: Object.freeze({ kind: 'class_notice', service: 'notices', root: 'notices' }),
  instructor_material: Object.freeze({ kind: 'instructor_material', service: 'instructor', root: 'instructor' }),
});
const ZONE_BY_ROOT = new Map(Object.values(RESOURCE_ZONES).map(zone => [zone.root, zone]));
// 경로 한 칸은 슬래시·역슬래시·물음표·#·제어 문자가 없는 1~200자입니다. 자료 ID 형식(UUID 등)은 좁히지 않습니다.
const PATH_SEGMENT = /^[^\u0000-\u001f\u007f/\\?#]{1,200}$/u;

// 요청 경로를 구역과 자원 ID로 풀어 냅니다. 맨 앞의 /api 는 떼고 보며, 모양이 이상하면 null 입니다.
// 자원 ID는 종류가 앞에 붙습니다: memo:<id>, class_notice:<id>, instructor_material:<id>. 목록 경로는 <종류>:* 입니다.
export function resourceFor(path) {
  if (typeof path !== 'string' || path.length > 600 || path[0] !== '/') return null;
  const segments = path.slice(1).split('/');
  if (segments[0] === 'api') segments.shift();
  if (segments.length === 0 || segments.some(part => part === '.' || part === '..' || !PATH_SEGMENT.test(part))) return null;
  const zone = ZONE_BY_ROOT.get(segments[0]);
  if (!zone) return null;
  const depth = segments.length - 1;
  const id = depth >= 1 ? segments[1] : null;
  return Object.freeze({
    zone: zone.kind,
    service: zone.service,
    resourceId: id === null ? `${zone.kind}:*` : `${zone.kind}:${id}`,
    id,
    depth,
    template: depth === 0 ? `/${zone.root}` : depth === 1 ? `/${zone.root}/:id` : `/${zone.root}/:id/*`,
  });
}

// 구역별로 허용하는 "메서드 + 경로 모양"입니다. 여기에 없는 요청은 모두 거부합니다(알 수 없는 경로 포함).
// - 메모: 자료 ID 하나를 고르는 경로만 허용합니다. 전체 목록·추가 경로(/notes)는 거부합니다.
//   메모 주인 비교는 판정기가 아니라 서버 API 에서 합니다. 자료 ID 형식(UUID 등)은 좁히지 않습니다.
// - 반 공지: 읽기(GET)만 허용합니다. 쓰기(POST·PUT·PATCH·DELETE)는 누구에게나 거부합니다.
//   판정 요청에는 역할이 없어서 강사의 공지 수정은 판정기가 아니라 서버의 관리 경로에서 처리합니다.
// - 강사 자료: 판정기에서는 모두 거부합니다.
// 쿼리는 읽지 않습니다(쿼리로 기능을 고르지 않습니다). :id 와 같은 깊이에 export 같은 기능 경로를 두지 않습니다.
export const ZONE_RULES = Object.freeze({
  memo: Object.freeze(['GET /notes/:id', 'PUT /notes/:id', 'DELETE /notes/:id']),
  class_notice: Object.freeze(['GET /notices', 'GET /notices/:id']),
  instructor_material: Object.freeze([]),
});

// 엔진이 준 route 도 맨 앞의 /api 는 떼고 비교합니다(예: 'GET /api/notes/:id' 와 'GET /notes/:id' 는 같은 모양).
const withoutApiPrefix = route => route.replace(/^([A-Z]+) \/api(?=\/)/u, (_match, method) => `${method} `);

// 실제 경로(path), 서비스(service), 메서드(method), 엔진이 확인한 경로 모양(route)이 모두 같은 구역·같은 모양일 때만 허용합니다.
function zoneAllows(request) {
  const resource = resourceFor(request?.path);
  if (!resource || request.service !== resource.service) return false;
  if (typeof request.method !== 'string' || typeof request.route !== 'string') return false;
  const shape = `${request.method} ${resource.template}`;
  return withoutApiPrefix(request.route) === shape && ZONE_RULES[resource.zone].includes(shape);
}

export async function decide(request) {
  // 6단계: 등록하지 않은 기기는 다른 조건을 보기 전에 거부합니다.
  if (request?.deviceRegistered !== true) {
    return respond(request, 'deny', 'device_not_registered', ['device_registered']);
  }
  // 8단계: 허용 목록에 없는 구역·경로·메서드는 거부합니다. 복합 이상을 따지기 전에 막습니다.
  if (!zoneAllows(request)) {
    return respond(request, 'deny', 'resource_not_allowed', ['resource_zone']);
  }
  // 7단계: 복합 이상 사건은 막지 않고 추가 확인을 요청합니다. 계약에 맞게 다시 확인한 요청은 통과합니다.
  if (isCompositeAnomaly(request)) {
    return verifiedStepUp(request)
      ? respond(request, 'allow', 'approved', ['device_registered', 'resource_zone', 'step_up_required'])
      : respond(request, 'step_up', 'step_up_required', ['step_up_required']);
  }
  return respond(request, 'allow', 'approved', ['device_registered', 'resource_zone']);
}
