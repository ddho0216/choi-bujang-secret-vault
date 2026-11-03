// 9단계 탐지 함수입니다. 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.
// 사건 모양은 docs/DETECT_EVENTS.md 의 로컬 연습용 계약이며, 이 함수는 실제 접속을 회수하지 않습니다.

// 입력 처리: 사건 한 건에서 at(시각), method(요청 종류), identity.sub(가명 사용자) 세 값만 읽습니다.
// 사건에 없는 네트워크·기기·지역 값은 지어내거나 조건으로 쓰지 않고, 메모 내용·토큰·실명은 읽지도 저장하지도 출력하지 않습니다.
// 시각은 ISO 8601 형식만 받습니다(Date.parse 가 '1' 같은 값도 날짜로 읽는 것을 막습니다).
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SUB_MAX = 200;

export function readEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const { at, method, identity } = event;
  if (typeof at !== 'string' || !ISO_TIME.test(at) || typeof method !== 'string') return null;
  const time = Date.parse(at);
  const sub = identity && typeof identity === 'object' && !Array.isArray(identity) ? identity.sub : undefined;
  if (!Number.isFinite(time) || typeof sub !== 'string' || sub.length === 0 || sub.length > SUB_MAX) return null;
  return Object.freeze({ at: time, method, sub });
}

// 읽을 수 없는 사건은 건너뜁니다(세 값이 없거나 모양이 다르면 정상값으로 채우지 않고 버립니다).
export function readEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  const read = [];
  for (const event of events) {
    const item = readEvent(event);
    if (item) read.push(item);
  }
  return read;
}

// 규칙 burst_read: 같은 identity.sub 의 GET 사건이 어느 10분 구간에서든 120건을 넘으면(121건 이상) 의심입니다.
// - 정확히 120건은 의심이 아닙니다. 10분 밖의 사건과 다른 사용자의 사건은 합치지 않습니다.
// - 구간은 움직이는 10분 창입니다(시계 구간으로 나누면 경계에 걸친 폭주를 놓칩니다). 시작과 끝이 정확히 10분 떨어진 두 사건은 같은 구간으로 봅니다.
// - 창 계산은 at 시각만 씁니다. 입력 순서와 상관없고, 읽을 수 없는 사건과 GET 이 아닌 사건은 세지 않습니다.
// 돌려주는 값은 두 가지뿐입니다: { action, reasonCode, subject } 또는 { action: 'observe' }.
const WINDOW_MS = 10 * 60 * 1000;
const BURST_LIMIT = 120;
// 12단계 작전실이 규칙 기준값을 보여 주려고 내보낸다(판정에는 위 상수를 그대로 쓴다).
export const BURST_READ_RULE = Object.freeze({ rule: 'burst_read', method: 'GET', windowSeconds: WINDOW_MS / 1000, overCount: BURST_LIMIT });

export function detect(events) {
  const reads = readEvents(events).filter(item => item.method === 'GET').sort((a, b) => a.at - b.at);
  const windows = new Map();
  // 시각 순서로 보면서, 가장 먼저 120건을 넘긴 사용자를 돌려줍니다.
  for (const item of reads) {
    let state = windows.get(item.sub);
    if (!state) {
      state = { times: [], head: 0 };
      windows.set(item.sub, state);
    }
    state.times.push(item.at);
    while (item.at - state.times[state.head] > WINDOW_MS) state.head += 1;
    if (state.times.length - state.head > BURST_LIMIT) {
      return { action: 'propose_revocation', reasonCode: 'burst_read', subject: item.sub };
    }
  }
  return { action: 'observe' };
}
