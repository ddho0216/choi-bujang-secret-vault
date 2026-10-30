import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { isDecision } from '../scripts/xdr-run.mjs';
import { decide, PATTERNS } from '../xdr/web-injection/decide.mjs';
import { pickAlert, readAlerts, redact } from '../xdr/web-injection/read-alerts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wi = (...parts) => join(root, 'xdr', 'web-injection', ...parts);
const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'web-injection.json'), 'utf8'));
const idNumber = alert => Number(alert.id.slice(3));

const alertWith = (rule, data) => ({ id: 'x-1', timestamp: '2026-09-27T10:00:00+09:00', agent: { name: 'choi-bujang-pc' },
  rule: { level: 3, mitre: [], description: '', ...rule }, data: { srcip: '203.0.113.9', ...data } });

test('decide.mjs 는 import·파일·네트워크 없이 이 파일 안에서만 계산한다', async () => {
  const source = await readFile(wi('decide.mjs'), 'utf8');
  assert.equal(/^\s*import[\s{*]/mu.test(source), false, 'import 문이 없어야 한다');
  assert.equal(/\bimport\s*\(/u.test(source), false, '동적 import 도 없어야 한다');
  assert.equal(/\brequire\s*\(|node:|\bfetch\s*\(|readFile|writeFile|\bprocess\b|XMLHttpRequest|\bWebSocket\b/u.test(source), false);
});

test('decide.mjs 의 패턴이 patterns.json 과 같다', async () => {
  const spec = JSON.parse(await readFile(wi('patterns.json'), 'utf8'));
  assert.deepEqual(PATTERNS.map(({ name, technique, confidence, when }) => ({ name, technique, confidence, when })),
    spec.patterns.map(({ name, technique, confidence, when }) => ({ name, technique, confidence, when })));
  for (const pattern of spec.patterns) {
    assert.ok(pattern.name && pattern.condition && pattern.evidence, `${pattern.name} 에 이름·조건·근거가 모두 있어야 한다`);
  }
});

test('명확한 공격은 block, 애매한 건 alert, 정상 이벤트는 record 로 나뉜다', async () => {
  const counts = { block: 0, alert: 0, record: 0 };
  for (const alert of fixture.alerts) {
    const out = await decide(alert);
    assert.ok(isDecision(out), `${alert.id} 반환 형식`);
    assert.equal(out.reason.includes('\n'), false, `${alert.id} reason 은 한 줄`);
    counts[out.action] += 1;
    const n = idNumber(alert);
    if (n <= 8) assert.ok(out.action === 'block' && out.confidence >= 0.85, `${alert.id} 명확한 주입`);
    else if (n <= 17) assert.ok(out.action === 'alert' && out.confidence >= 0.5 && out.confidence < 0.85, `${alert.id} 애매한 시도`);
    else assert.ok(out.action === 'record' && out.confidence < 0.5, `${alert.id} 정상 이벤트`);
  }
  assert.deepEqual(counts, { block: 8, alert: 9, record: 9 });
});

test('요청 주소에 실제 주입 형태가 있으면 반복될 때만 block, 한 번이면 alert', async () => {
  const payloads = ['/notes?q=1%20union%20select%20a%20from%20b', '/notes?id=1%20or%201%3D1', '/search?q=%3Cscript%3Ex%3C%2Fscript%3E',
    '/files?path=..%2F..%2Fetc%2Fx', '/files?path=%252e%252e%252f%252e%252e%252fx'];
  for (const url of payloads) {
    const repeated = await decide(alertWith({ level: 7, mitre: ['T1190'] }, { url, count: '6' }));
    assert.equal(repeated.action, 'block', `반복: ${url}`);
    assert.match(repeated.reason, /payload_in_url_repeat/u);
    const once = await decide(alertWith({ level: 6, mitre: ['T1190'] }, { url, count: '1' }));
    assert.equal(once.action, 'alert', `한 번: ${url}`);
  }
  for (const url of ['/search?q=select-course', '/files?name=note-01', '/search?q=script-class', '/notes?q=doc-sql-chain', '/']) {
    const out = await decide(alertWith({ level: 7, mitre: ['T1190'] }, { url, count: '6' }));
    assert.notEqual(out.action, 'block', `정상 주소는 막지 않는다: ${url}`);
  }
});

test('T1190 표시가 없으면 주소에 무엇이 있어도 막지 않고 기록한다', async () => {
  const out = await decide(alertWith({ level: 3, mitre: [] }, { url: '/notes?id=1%20or%201%3D1', count: '9' }));
  assert.equal(out.action, 'record');
});

test('값이 없거나 모양이 다른 경보는 막지 않고 기록만 한다', async () => {
  for (const value of [null, undefined, 'x', 5, [], {}, { rule: { level: 12 } },
    { rule: { mitre: ['T1190'], level: 'high' }, data: { count: '20' } },
    { rule: { mitre: ['T1190'], level: 12 }, data: { count: 'many', url: 5 } }]) {
    const out = await decide(value);
    assert.ok(isDecision(out));
    assert.equal(out.action, 'record');
  }
});

test('읽기 모듈: 경보 건수와 뽑은 줄 수가 같고, 비밀값처럼 보이는 값은 가린다', async () => {
  const { alertCount, rows } = await readAlerts(wi('..', 'fixtures', 'web-injection.json'));
  assert.equal(alertCount, fixture.alerts.length);
  assert.equal(rows.length, alertCount);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['account', 'accountsTried', 'description', 'id', 'level', 'srcip', 'time']);
  const tricky = pickAlert({ id: 'x1', timestamp: 't', rule: { level: 3, description: 'token=abc123secret Bearer abcdefgh12345678' },
    data: { srcip: '192.0.2.1', srcuser: 'user01' } });
  assert.equal(/abc123secret|abcdefgh12345678/u.test(JSON.stringify(tricky)), false);
  assert.match(redact('password: hunter2'), /\[가림\]/u);
});

test('decide.mjs 는 읽기 모듈을 불러오지 않고, 원본 경보를 고치지 않는다', async () => {
  const before = JSON.stringify(fixture);
  for (const alert of fixture.alerts) await decide(alert);
  assert.equal(JSON.stringify(fixture), before);
  assert.equal((await readFile(wi('decide.mjs'), 'utf8')).includes('read-alerts'), false);
});
