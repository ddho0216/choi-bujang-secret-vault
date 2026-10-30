import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { blockableAddress, DENY_TTL_MINUTES, isDenied, respondToAlerts } from '../xdr/brute-force/respond.mjs';
import { decide } from '../xdr/brute-force/decide.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'brute-force.json'), 'utf8'));

async function withTempPaths(run) {
  const dir = await mkdtemp(join(tmpdir(), 'xdr-respond-'));
  try {
    return await run({ alertsLogPath: join(dir, 'alerts.log'), denyRulesPath: join(dir, 'deny-rules.json') });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const attack = (id, srcip, extra = {}) => ({
  id, timestamp: '2026-09-27T10:00:00+09:00', agent: { name: 'choi-bujang-pc' },
  rule: { level: 12, mitre: ['T1110'], description: '로그인 실패가 몰렸습니다.' },
  data: { srcip, srcuser: 'user01', count: '50', ...extra },
});

test('시험 경보를 흘리면 명확한 공격 주소만 막히고 나머지는 통과한다', async () => {
  await withTempPaths(async paths => {
    const out = await respondToAlerts({ alerts: fixture.alerts, ...paths });
    assert.deepEqual(out.counts, { block: 10, alert: 9, record: 9 });
    assert.equal(out.rules.length, 9, '공격 경보 10건이지만 203.0.113.10 이 두 번이라 규칙은 9개');
    const doc = JSON.parse(await readFile(paths.denyRulesPath, 'utf8'));
    assert.equal(doc.connectedToDecider, false, '판정기에 연결되지 않았다고 적혀 있어야 한다');
    for (const alert of fixture.alerts) {
      const action = (await decide(alert)).action;
      const denied = isDenied(alert.data.srcip, alert.timestamp, doc);
      assert.equal(Boolean(denied), action === 'block', `${alert.id} ${action}`);
    }
  });
});

test('규칙에는 만료 시각과 근거 경보 번호가 있고, 정상 사용자를 막는 규칙은 없다', async () => {
  await withTempPaths(async paths => {
    const { rules } = await respondToAlerts({ alerts: fixture.alerts, ...paths });
    const normalIps = new Set(fixture.alerts.filter(alert => Number(alert.id.slice(3)) > 10).map(alert => alert.data.srcip));
    const ids = new Set(fixture.alerts.map(alert => alert.id));
    for (const rule of rules) {
      assert.ok(rule.evidenceAlertIds.length >= 1 && rule.evidenceAlertIds.every(id => ids.has(id)));
      assert.equal(normalIps.has(rule.match.srcip), false, `${rule.ruleId} 는 애매·정상 경보의 주소`);
      const latest = Math.max(...rule.evidenceAlertIds.map(id => Date.parse(fixture.alerts.find(alert => alert.id === id).timestamp)));
      assert.equal(Date.parse(rule.expiresAt), latest + DENY_TTL_MINUTES * 60 * 1000);
      assert.ok(Date.parse(rule.expiresAt) > Date.parse(rule.effectiveFrom));
    }
    const shared = rules.find(rule => rule.match.srcip === '203.0.113.10');
    assert.deepEqual(shared.evidenceAlertIds, ['bf-01', 'bf-02']);
  });
});

test('알림은 xdr/alerts.log 형식으로 한 줄씩 쌓이고, 같은 경보를 다시 흘려도 중복되지 않는다', async () => {
  await withTempPaths(async paths => {
    const first = await respondToAlerts({ alerts: fixture.alerts, ...paths });
    const lines = (await readFile(paths.alertsLogPath, 'utf8')).trimEnd().split('\n');
    assert.equal(lines.length, 19, 'block 10 + alert 9, 정상 이벤트는 쌓지 않는다');
    assert.equal(first.logged, 19);
    assert.equal(lines.filter(line => line.includes(' BLOCK ')).length, 10);
    assert.equal(lines.filter(line => line.includes(' ALERT ')).length, 9);
    assert.equal(lines.some(line => /user0\d/u.test(line)), false, '계정 이름은 로그에 쓰지 않는다');
    const second = await respondToAlerts({ alerts: fixture.alerts, ...paths });
    assert.equal(second.logged, 0);
    assert.equal((await readFile(paths.alertsLogPath, 'utf8')).trimEnd().split('\n').length, 19);
  });
});

test('안전장치: 사설 주소, 형식이 이상한 주소, 정상 경보와 겹치는 주소는 규칙 없이 알림만 남긴다', async () => {
  assert.deepEqual(blockableAddress('192.168.1.5'), { ok: false, why: '사설·루프백 주소' });
  assert.equal(blockableAddress('203.0.113.7').ok, true);
  assert.equal(blockableAddress('999.1.1.1').ok, false);
  await withTempPaths(async paths => {
    const normal = { id: 'ok-1', timestamp: '2026-09-27T10:01:00+09:00', agent: { name: 'choi-bujang-pc' },
      rule: { level: 3, mitre: [], description: '로그인이 성공했습니다.' }, data: { srcip: '203.0.113.50', srcuser: 'user02' } };
    const alerts = [attack('t-1', '192.168.1.5'), attack('t-2', 'not-an-ip'), attack('t-3', '203.0.113.50'), normal,
      attack('t-4', '203.0.113.60')];
    const out = await respondToAlerts({ alerts, ...paths });
    assert.deepEqual(out.rules.map(rule => rule.match.srcip), ['203.0.113.60']);
    assert.equal(out.held, 3);
    const log = await readFile(paths.alertsLogPath, 'utf8');
    assert.match(log, /ALERT alert=t-1 .*차단 보류: 사설·루프백 주소/u);
    assert.match(log, /ALERT alert=t-2 .*차단 보류: 주소 형식이 아님/u);
    assert.match(log, /ALERT alert=t-3 .*차단 보류: 같은 주소에 정상 경보가 있음/u);
    assert.match(log, /BLOCK alert=t-4 /u);
  });
});

test('만료된 규칙과 시작 전 시각에는 적용되지 않는다', async () => {
  await withTempPaths(async paths => {
    const { doc } = await respondToAlerts({ alerts: [attack('t-9', '203.0.113.70')], ...paths });
    assert.ok(isDenied('203.0.113.70', '2026-09-27T10:30:00+09:00', doc));
    assert.equal(isDenied('203.0.113.70', '2026-09-27T11:00:00+09:00', doc), null, '만료 시각 정각부터는 풀린다');
    assert.equal(isDenied('203.0.113.70', '2026-09-27T09:59:00+09:00', doc), null, '규칙이 생기기 전');
    assert.equal(isDenied('203.0.113.71', '2026-09-27T10:30:00+09:00', doc), null);
  });
});
