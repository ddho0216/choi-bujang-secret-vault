import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detect, readEvent, readEvents } from '../src/detect.mjs';

const START = Date.UTC(2026, 9, 1, 0, 0, 0);
const reads = (count, { intervalSeconds = 2, owner = 'learner_fixture', start = START, method = 'GET' } = {}) => Array.from({ length: count }, (_, index) => ({
  at: new Date(start + index * intervalSeconds * 1000).toISOString(), method, identity: { sub: owner },
}));

// ── 제작 1: 입력 처리 ─────────────────────────────────────────────────────────
test('사건에서 at·method·identity.sub 세 값만 읽는다', () => {
  const secretMemo = '비밀 메모 내용 SECRET_MEMO_TEXT';
  const event = { at: '2026-10-01T00:00:00.000Z', method: 'GET', identity: { sub: 'learner_fixture', name: '홍길동', email: 'a@example.com', token: 'tok_SECRET_VALUE' },
    network: 'usual', device: 'dev-1', region: 'local', ip: '203.0.113.9', memo: secretMemo, headers: { authorization: 'Bearer SECRET_HEADER' } };
  const read = readEvent(event);
  assert.deepEqual({ ...read }, { at: Date.UTC(2026, 9, 1), method: 'GET', sub: 'learner_fixture' });
  assert.deepEqual(Object.keys(read).sort(), ['at', 'method', 'sub'], '세 값만 나온다');
  const printed = JSON.stringify(readEvents([event]));
  for (const leaked of ['홍길동', 'a@example.com', 'SECRET_VALUE', 'SECRET_MEMO_TEXT', 'SECRET_HEADER', '203.0.113.9', 'dev-1', 'usual', 'local']) {
    assert.equal(printed.includes(leaked), false, `${leaked} 는 읽지도 출력하지도 않는다`);
  }
  assert.equal(Object.isFrozen(read), true);
});

test('정상 사건과 폭주 사건을 세 값만으로, 비밀값 없이 읽는다', () => {
  assert.equal(readEvents(reads(30)).length, 30);
  assert.equal(readEvents(reads(121)).length, 121);
  assert.equal(readEvents(reads(200, { intervalSeconds: 7 })).length, 200);
  const mixed = [...reads(3), ...reads(2, { owner: 'other_fixture' })];
  assert.deepEqual([...new Set(readEvents(mixed).map(item => item.sub))].sort(), ['learner_fixture', 'other_fixture']);
  assert.ok(readEvents(reads(5)).every(item => item.method === 'GET'));
});

test('세 값이 없거나 모양이 다른 사건은 정상값으로 채우지 않고 버린다', () => {
  const good = { at: '2026-10-01T00:00:00.000Z', method: 'GET', identity: { sub: 's' } };
  const bad = [null, undefined, 'x', 5, [], {}, { ...good, at: undefined }, { ...good, at: 5 }, { ...good, at: '1' }, { ...good, at: '2026-10-01' },
    { ...good, at: 'not a date' }, { ...good, at: '2026-13-45T99:99:99Z' }, { ...good, method: undefined }, { ...good, method: 5 }, { ...good, identity: undefined },
    { ...good, identity: null }, { ...good, identity: 'learner' }, { ...good, identity: [] }, { ...good, identity: {} }, { ...good, identity: { sub: '' } },
    { ...good, identity: { sub: 5 } }, { ...good, identity: { sub: 'x'.repeat(201) } }, { ...good, identity: undefined, sub: 'top-level-sub-is-not-identity' }];
  assert.deepEqual(readEvents(bad), []);
  assert.equal(readEvents([...bad, good]).length, 1, '좋은 사건은 그대로 읽는다');
  assert.equal(readEvents([{ ...good, at: '2026-10-01T09:00:00+09:00' }, { ...good, at: '2026-10-01T00:00:00Z' }]).length, 2, '시간대 표기도 읽는다');
});

test('사용자 번호를 사건 위쪽에 직접 넣어도 신원으로 취급하지 않는다', () => {
  const event = { at: '2026-10-01T00:00:00.000Z', method: 'GET', sub: 'browser_sent', userId: 'browser_sent', identity: { userId: 'browser_sent' } };
  assert.deepEqual(readEvents([event]), []);
});

test('목록이 아니면 던지고, 사건이 적거나 없으면 observe 다', () => {
  for (const value of [undefined, null, 'x', 5, {}]) assert.throws(() => detect(value), { message: 'invalid_detection_events' });
  assert.deepEqual(detect(reads(30)), { action: 'observe' });
  assert.deepEqual(detect([]), { action: 'observe' });
});

// ── 제작 2·3: 규칙 burst_read 와 돌려주는 값 ──────────────────────────────────────
const propose = subject => ({ action: 'propose_revocation', reasonCode: 'burst_read', subject });
const OBSERVE = { action: 'observe' };
const MIN = 60 * 1000;
const at = ms => new Date(START + ms).toISOString();
const at_ = (ms, owner = 'learner_fixture', method = 'GET') => ({ at: at(ms), method, identity: { sub: owner } });
const many = (count, ms, owner, method) => Array.from({ length: count }, () => at_(ms, owner, method));

test('10분 안 120건까지는 observe, 121건 이상만 propose_revocation 이다', () => {
  assert.deepEqual(detect(reads(30)), OBSERVE);
  assert.deepEqual(detect(reads(119)), OBSERVE);
  assert.deepEqual(detect(reads(120)), OBSERVE, '정확히 120건은 의심이 아니다');
  assert.deepEqual(detect(reads(121)), propose('learner_fixture'));
  assert.deepEqual(detect(reads(200)), propose('learner_fixture'));
  assert.deepEqual(detect(reads(5000, { intervalSeconds: 0.1 })), propose('learner_fixture'));
});

test('돌려주는 값에는 정해진 키만 있고 다른 키를 덧붙이지 않는다', () => {
  assert.deepEqual(Object.keys(detect(reads(121))).sort(), ['action', 'reasonCode', 'subject']);
  assert.deepEqual(Object.keys(detect(reads(30))), ['action']);
  const withExtras = reads(121).map(event => ({ ...event, deviceId: 'dev-9', network: 'unusual', region: 'foreign', ip: '203.0.113.5', identity: { ...event.identity, name: '실명' } }));
  assert.deepEqual(detect(withExtras), propose('learner_fixture'), '기기·네트워크·지역·실명은 결과에 나오지 않는다');
  assert.equal(JSON.stringify(detect(withExtras)).includes('dev-9'), false);
});

test('10분 구간은 움직이는 창이다: 시계 구간 경계에 걸쳐도 잡고, 10분 밖으로 흩어지면 합치지 않는다', () => {
  const straddle = Array.from({ length: 121 }, (_, index) => at_(9 * MIN + index * 2000));
  assert.deepEqual(detect(straddle), propose('learner_fixture'), '00:10 경계에 걸친 폭주');
  assert.deepEqual(detect(reads(200, { intervalSeconds: 7 })), OBSERVE, '10분 안에는 86건뿐');
  assert.deepEqual(detect([...many(100, 0), ...many(100, 11 * MIN)]), OBSERVE, '10분 밖의 사건은 합치지 않는다');
  assert.deepEqual(detect([...many(100, 0), ...many(100, 5 * MIN)]), propose('learner_fixture'), '같은 10분 안이면 합친다');
});

test('경계: 정확히 10분 떨어진 사건은 같은 구간이고, 1밀리초라도 지나면 다른 구간이다', () => {
  assert.deepEqual(detect([...many(61, 0), ...many(60, 10 * MIN)]), propose('learner_fixture'));
  assert.deepEqual(detect([...many(61, 0), ...many(60, 10 * MIN + 1)]), OBSERVE);
  assert.deepEqual(detect([...many(60, 0), ...many(60, 10 * MIN)]), OBSERVE, '합이 120건');
});

test('다른 사용자의 사건은 합산하지 않는다', () => {
  assert.deepEqual(detect([...reads(100), ...reads(100, { owner: 'other_fixture' })].sort((a, b) => a.at.localeCompare(b.at))), OBSERVE);
  assert.deepEqual(detect([...many(120, 0, 'a'), ...many(120, 0, 'b'), ...many(120, 0, 'c')]), OBSERVE);
  assert.deepEqual(detect([...reads(121), ...reads(50, { owner: 'other_fixture' })]), propose('learner_fixture'));
  assert.deepEqual(detect([...reads(50), ...reads(121, { owner: 'other_fixture' })]), propose('other_fixture'));
});

test('둘 이상이 넘으면 가장 먼저 넘긴 사용자를 돌려준다', () => {
  const early = Array.from({ length: 121 }, (_, index) => at_(index * 1000, 'early_sub'));
  const late = Array.from({ length: 121 }, (_, index) => at_(2000 * 1000 + index * 1000, 'late_sub'));
  assert.deepEqual(detect([...late, ...early]), propose('early_sub'));
  assert.deepEqual(detect([...early, ...late]), propose('early_sub'));
});

test('GET 만 센다: 다른 요청 종류는 세지 않는다', () => {
  assert.deepEqual(detect(many(500, 0, 'learner_fixture', 'POST')), OBSERVE);
  assert.deepEqual(detect([...many(100, 0), ...many(100, 0, 'learner_fixture', 'POST')]), OBSERVE);
  assert.deepEqual(detect([...many(121, 0), ...many(50, 0, 'learner_fixture', 'DELETE')]), propose('learner_fixture'));
  for (const method of ['get', 'Get', 'HEAD', 'PUT', '']) assert.deepEqual(detect(many(200, 0, 'learner_fixture', method)), OBSERVE, method);
});

test('창 계산은 at 시각만 쓴다: 입력 순서와 같은 시각 사건과 읽을 수 없는 사건', () => {
  const events = reads(121);
  assert.deepEqual(detect([...events].reverse()), propose('learner_fixture'), '순서가 뒤집혀도 같다');
  const shuffled = [...events].sort((a, b) => (a.at.charCodeAt(18) % 7) - (b.at.charCodeAt(18) % 7) || a.at.localeCompare(b.at));
  assert.deepEqual(detect(shuffled), propose('learner_fixture'));
  assert.deepEqual(detect(many(121, 0)), propose('learner_fixture'), '같은 시각의 사건도 각각 센다');
  const junk = [null, 5, 'x', {}, { at: 'bad', method: 'GET', identity: { sub: 'learner_fixture' } }, { at: at(0), method: 'GET' }];
  assert.deepEqual(detect([...reads(120), ...junk]), OBSERVE, '읽을 수 없는 사건은 세지 않는다');
  assert.deepEqual(detect([...reads(121), ...junk]), propose('learner_fixture'));
  const before = JSON.stringify(events);
  detect(events);
  assert.equal(JSON.stringify(events), before, '입력을 바꾸지 않는다');
});

test('큰 입력도 빠르게 처리한다', () => {
  const started = Date.now();
  const big = Array.from({ length: 60000 }, (_, index) => at_(index * 20000, `user_${index % 500}`));
  assert.deepEqual(detect(big), OBSERVE);
  assert.ok(Date.now() - started < 2000, `${Date.now() - started}ms`);
});
