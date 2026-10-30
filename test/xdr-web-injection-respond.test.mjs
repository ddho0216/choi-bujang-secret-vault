import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { blockableAddress, DENY_TTL_MINUTES, isDenied, respondToAlerts } from '../xdr/web-injection/respond.mjs';
import { decide } from '../xdr/web-injection/decide.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'web-injection.json'), 'utf8'));
const idNumber = alert => Number(alert.id.slice(3));

async function withTempPaths(run) {
  const dir = await mkdtemp(join(tmpdir(), 'xdr-wi-respond-'));
  try {
    return await run({ alertsLogPath: join(dir, 'alerts.log'), denyRulesPath: join(dir, 'deny-rules.json') });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const injection = (id, srcip) => ({
  id, timestamp: '2026-09-27T10:00:00+09:00', agent: { name: 'choi-bujang-pc' },
  rule: { level: 12, mitre: ['T1190'], description: '같은 주소에서 SQL 구문을 이어 붙인 요청이 반복됐습니다.' },
  data: { srcip, count: '12', url: '/notes?q=doc-sql-chain' },
});

test('시험 경보를 흘리면 명확한 주입 주소만 막히고 나머지는 통과한다', async () => {
  await withTempPaths(async paths => {
    const out = await respondToAlerts({ alerts: fixture.alerts, ...paths });
    assert.deepEqual(out.counts, { block: 8, alert: 9, record: 9 });
    assert.equal(out.rules.length, 7, '주입 경보 8건이지만 203.0.113.10 이 두 번이라 규칙은 7개');
    const doc = JSON.parse(await readFile(paths.denyRulesPath, 'utf8'));
    assert.equal(doc.moduleKey, 'web-injection');
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
    const otherIps = new Set(fixture.alerts.filter(alert => idNumber(alert) > 8).map(alert => alert.data.srcip));
    const ids = new Set(fixture.alerts.map(alert => alert.id));
    for (const rule of rules) {
      assert.match(rule.ruleId, /^web-injection\.deny\./u);
      assert.ok(rule.evidenceAlertIds.length >= 1 && rule.evidenceAlertIds.every(id => ids.has(id)));
      assert.equal(otherIps.has(rule.match.srcip), false, `${rule.ruleId} 는 애매·정상 경보의 주소`);
      const latest = Math.max(...rule.evidenceAlertIds.map(id => Date.parse(fixture.alerts.find(alert => alert.id === id).timestamp)));
      assert.equal(Date.parse(rule.expiresAt), latest + DENY_TTL_MINUTES * 60 * 1000);
      assert.ok(Date.parse(rule.expiresAt) > Date.parse(rule.effectiveFrom));
    }
    assert.deepEqual(rules.find(rule => rule.match.srcip === '203.0.113.10').evidenceAlertIds, ['wi-01', 'wi-02']);
  });
});

test('알림은 한 줄씩 쌓이고, 같은 경보를 다시 흘려도 중복되지 않으며, 앞 모듈의 줄과 섞여도 건드리지 않는다', async () => {
  await withTempPaths(async paths => {
    const first = await respondToAlerts({ alerts: fixture.alerts, ...paths });
    const lines = (await readFile(paths.alertsLogPath, 'utf8')).trimEnd().split('\n');
    assert.equal(lines.length, 17, 'block 8 + alert 9, 정상 이벤트는 쌓지 않는다');
    assert.equal(first.logged, 17);
    assert.equal(lines.filter(line => line.includes(' BLOCK ')).length, 8);
    assert.equal(lines.filter(line => line.includes(' ALERT ')).length, 9);
    assert.equal(lines.every(line => / alert=wi-\d\d /u.test(line)), true);
    const second = await respondToAlerts({ alerts: fixture.alerts, ...paths });
    assert.equal(second.logged, 0);
  });
});

test('안전장치: 사설 주소, 형식이 이상한 주소, 정상 경보와 겹치는 주소는 규칙 없이 알림만 남긴다', async () => {
  assert.equal(blockableAddress('10.0.0.8').ok, false);
  await withTempPaths(async paths => {
    const normal = { id: 'ok-1', timestamp: '2026-09-27T10:01:00+09:00', agent: { name: 'choi-bujang-pc' },
      rule: { level: 3, mitre: [], description: '자료 목록을 조회했습니다.' }, data: { srcip: '203.0.113.50', url: '/api/notes' } };
    const alerts = [injection('t-1', '10.0.0.8'), injection('t-2', 'not-an-ip'), injection('t-3', '203.0.113.50'), normal,
      injection('t-4', '203.0.113.60')];
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
