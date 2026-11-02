import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { decide, readSignals, RULE_IDS } from '../src/decider.mjs';

const { normal, suspicious } = fixtureRequests();
const fresh = (request, patch = {}) => ({ ...request, requestId: randomUUID(), ...patch });
const RESPONSE_KEYS = 'decision,reasonCode,requestId,ruleIds,schema';

function assertValidResponse(request, response) {
  assert.equal(Object.keys(response).sort().join(','), RESPONSE_KEYS);
  assert.equal(response.schema, 'aleph.decision.v1');
  assert.equal(response.requestId, request.requestId);
  assert.ok(['allow', 'deny', 'step_up'].includes(response.decision));
  assert.match(response.reasonCode, /^[a-z][a-z0-9_]{0,63}$/u);
  assert.ok(response.ruleIds.length > 0 && response.ruleIds.every(id => RULE_IDS.includes(id)), JSON.stringify(response.ruleIds));
}

// ── 제작 1: 입력 검사 ──────────────────────────────────────────────
test('접속 정보는 엔진이 붙인 출처(judge_fixture)일 때만 믿고, 없거나 불분명하면 정상값으로 채우지 않는다', () => {
  assert.deepEqual({ ...readSignals(normal) }, { trusted: true, source: 'judge_fixture', region: 'local', network: 'usual', hour: 14 });
  assert.deepEqual({ ...readSignals(suspicious) }, { trusted: true, source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3 });
  const unknown = { trusted: false, source: 'untrusted', region: null, network: null, hour: null };
  for (const signals of [undefined, null, 'x', 5, [], {}, { source: 'none', region: 'unknown', network: 'unknown', hour: 14 },
    { source: 'client_header', region: 'local', network: 'usual', hour: 14 }, { region: 'local', network: 'usual', hour: 14 },
    { source: 'JUDGE_FIXTURE', region: 'local', network: 'usual', hour: 14 }, { source: ['judge_fixture'] }]) {
    assert.deepEqual({ ...readSignals({ signals }) }, unknown, JSON.stringify(signals));
  }
  assert.deepEqual({ ...readSignals(undefined) }, unknown);
});

test('출처가 믿을 만해도 빠졌거나 모양이 다른 값은 null 로 두고, 임의의 정상값으로 바꾸지 않는다', () => {
  const read = signals => ({ ...readSignals({ signals: { source: 'judge_fixture', ...signals } }) });
  assert.deepEqual(read({}), { trusted: true, source: 'judge_fixture', region: null, network: null, hour: null });
  assert.equal(read({ network: 'unknown' }).network, null, 'unknown 은 usual 도 unusual 도 아니다');
  assert.equal(read({ region: 'moon' }).region, null);
  for (const hour of [-1, 24, 3.5, '3', null, NaN, Infinity]) assert.equal(read({ hour }).hour, null, String(hour));
  for (const hour of [0, 3, 14, 23]) assert.equal(read({ hour }).hour, hour);
});

test('위조한 클라이언트 헤더·위치·역할은 접속 정보로 승격되지 않는다', () => {
  const forged = fresh(suspicious, {
    headers: { 'x-forwarded-for': '203.0.113.9', 'x-region': 'local', 'x-network': 'usual', 'x-hour': '14' },
    geo: { region: 'local' }, clientIp: '192.0.2.1', network: 'usual', region: 'local', hour: 14,
    role: 'admin', identity: { admin: true }, device: { approval: true },
  });
  assert.deepEqual({ ...readSignals(forged) }, { trusted: true, source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3 },
    '엔진이 준 signals 만 읽고 위조 값은 무시한다');
  const noEngineSignals = fresh(normal, { signals: undefined, headers: { 'x-network': 'usual' }, geo: { region: 'local' }, hour: 14 });
  assert.deepEqual({ ...readSignals(noEngineSignals) }, { trusted: false, source: 'untrusted', region: null, network: null, hour: null });
});

test('기기 규칙의 판정은 입력 검사를 더해도 그대로다', async () => {
  const response = await decide(normal);
  assertValidResponse(normal, response);
  assert.equal(response.decision, 'allow');
  const denied = await decide(fresh(normal, { deviceRegistered: false }));
  assert.deepEqual([denied.decision, denied.reasonCode], ['deny', 'device_not_registered']);
});

// ── 제작 2: 복합 이상 사건은 추가 확인 ────────────────────────────────
const withSignals = (patch, extra = {}) => fresh(normal, { signals: { source: 'judge_fixture', region: 'local', network: 'usual', hour: 14, ...patch }, ...extra });
const composite = (patch = {}, extra = {}) => fresh(suspicious, { signals: { ...suspicious.signals, ...patch }, ...extra });
const decision = async request => { const r = await decide(request); assertValidResponse(request, r); return r; };

test('RULE_IDS 에는 구현한 규칙 두 개만 있고, 기기 규칙을 그대로 유지한다', async () => {
  assert.deepEqual([...RULE_IDS], ['device_registered', 'step_up_required']);
  const unregistered = await decision(fresh(normal, { deviceRegistered: false }));
  assert.deepEqual([unregistered.decision, unregistered.reasonCode, unregistered.ruleIds], ['deny', 'device_not_registered', ['device_registered']]);
});

test('정해진 복합 이상 사건은 step_up, 정상 사건은 allow', async () => {
  const unusual = await decision(suspicious);
  assert.deepEqual([unusual.decision, unusual.reasonCode, unusual.ruleIds], ['step_up', 'step_up_required', ['step_up_required']]);
  const ordinary = await decision(normal);
  assert.deepEqual([ordinary.decision, ordinary.reasonCode, ordinary.ruleIds], ['allow', 'approved', ['device_registered']]);
});

test('계약에 맞게 다시 확인한 복합 이상 사건은 allow, 모양이 틀린 확인은 믿지 않는다', async () => {
  const verified = await decision(composite({}, { stepUp: { verified: true, authAgeSeconds: 60 } }));
  assert.deepEqual([verified.decision, verified.ruleIds], ['allow', ['device_registered', 'step_up_required']]);
  for (const age of [0, 900]) assert.equal((await decision(composite({}, { stepUp: { verified: true, authAgeSeconds: age } }))).decision, 'allow', String(age));
  for (const stepUp of [{ verified: true, authAgeSeconds: null }, { verified: true, authAgeSeconds: 901 }, { verified: true, authAgeSeconds: -1 },
    { verified: true, authAgeSeconds: '60' }, { verified: true, authAgeSeconds: 59.5 }, { verified: 'true', authAgeSeconds: 60 },
    { verified: false, authAgeSeconds: 60 }, { verified: true }, null, 'verified', [], undefined]) {
    assert.equal((await decision(composite({}, { stepUp }))).decision, 'step_up', JSON.stringify(stepUp));
  }
});

test('세 조건 가운데 하나라도 빠지면 막지 않고 통과한다', async () => {
  const burst = [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }];
  assert.equal((await decision(composite({ hour: 14 }))).decision, 'allow', '시각이 평소');
  assert.equal((await decision(composite({ network: 'usual' }))).decision, 'allow', '네트워크가 평소');
  assert.equal((await decision(composite({}, { recentEvents: [] }))).decision, 'allow', '사건이 없음');
  assert.equal((await decision(composite({}, { recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 9 }] }))).decision, 'allow', '9건');
  assert.equal((await decision(composite({}, { recentEvents: [{ kind: 'risk_signal', ageSeconds: 301, count: 50 }] }))).decision, 'allow', '5분이 지난 사건');
  assert.equal((await decision(composite({ region: 'foreign' }, { recentEvents: [] }))).decision, 'allow', '지역만으로는 막지 않는다');
  assert.equal((await decision(withSignals({ region: 'foreign' }))).decision, 'allow', '낯선 지역 하나만');
  assert.equal((await decision(withSignals({ region: 'foreign', hour: 3 }, { recentEvents: burst }))).decision, 'allow', '시각·지역·사건만, 네트워크는 평소');
  assert.equal((await decision(composite({ region: 'local' }))).decision, 'step_up', '지역이 달라도 세 조건이 맞으면 같은 판정');
});

test('경계값: 심야는 23시~5시, 사건은 최근 5분 10건 이상', async () => {
  for (const hour of [23, 0, 3, 5]) assert.equal((await decision(composite({ hour }))).decision, 'step_up', `hour ${hour}`);
  for (const hour of [6, 12, 22]) assert.equal((await decision(composite({ hour }))).decision, 'allow', `hour ${hour}`);
  const split = [{ kind: 'a', ageSeconds: 10, count: 4 }, { kind: 'b', ageSeconds: 300, count: 6 }];
  assert.equal((await decision(composite({}, { recentEvents: split }))).decision, 'step_up', '여러 사건의 합이 10, 5분 정각 포함');
  assert.equal((await decision(composite({}, { recentEvents: [{ kind: 'a', ageSeconds: 10, count: 4 }, { kind: 'b', ageSeconds: 301, count: 6 }] }))).decision, 'allow');
});

test('엔진이 믿을 만하다고 표시하지 않은 접속 정보와 이상한 사건 배열은 근거로 쓰지 않는다', async () => {
  for (const signals of [{ source: 'none', region: 'unknown', network: 'unknown', hour: 3 },
    { source: 'client_header', region: 'foreign', network: 'unusual', hour: 3 }, undefined, null]) {
    assert.equal((await decision(composite({}, { signals }))).decision, 'allow', JSON.stringify(signals));
  }
  for (const recentEvents of [undefined, null, 'x', {}, [null, 'x', 5, []], [{ ageSeconds: 'a', count: 20 }], [{ ageSeconds: 1, count: -20 }],
    [{ ageSeconds: 1.5, count: 20 }], [{ ageSeconds: 1, count: '20' }]]) {
    assert.equal((await decision(composite({}, { recentEvents }))).decision, 'allow', JSON.stringify(recentEvents));
  }
});

test('위조한 헤더가 정상으로 보이게 해도 엔진이 준 복합 이상은 그대로 step_up, 반대로 위조로 막을 수도 없다', async () => {
  const hidden = composite({}, { headers: { 'x-network': 'usual', 'x-hour': '14' }, geo: { region: 'local' }, role: 'admin', identity: { admin: true }, device: { approval: true } });
  assert.equal((await decision(hidden)).decision, 'step_up');
  const fakeAttack = fresh(normal, { headers: { 'x-network': 'unusual', 'x-hour': '3' }, geo: { region: 'foreign' }, hour: 3, network: 'unusual' });
  assert.equal((await decision(fakeAttack)).decision, 'allow');
});

test('등록하지 않은 기기는 복합 이상보다 먼저 거부한다', async () => {
  const response = await decision(composite({}, { deviceRegistered: false }));
  assert.deepEqual([response.decision, response.reasonCode, response.ruleIds], ['deny', 'device_not_registered', ['device_registered']]);
});

test('어떤 입력에도 던지지 않고 응답 다섯 항목을 지킨다', async () => {
  for (const request of [undefined, null, 'x', 5, [], {}, { requestId: 'r-1' }, { requestId: 'r-2', deviceRegistered: true }, { requestId: 'r-3', deviceRegistered: true, signals: 7, stepUp: 7, recentEvents: 7 }]) {
    const response = await decide(request);
    assert.equal(Object.keys(response).sort().join(','), RESPONSE_KEYS);
    assert.ok(response.ruleIds.every(id => RULE_IDS.includes(id)));
  }
});
