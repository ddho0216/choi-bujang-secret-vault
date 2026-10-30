// 알림과 차단: decide 결과 가운데 block 은 거부 규칙 후보로, alert·block 은 xdr/alerts.log 에 한 줄씩 남긴다.
// decide.mjs 는 판단만 돌려주고, 파일 쓰기와 규칙 기록은 이 파일만 한다.
//
// 주의: 이 저장소의 src/decider.mjs 는 시작 틀이라 규칙 파일을 읽지 않고, 판정 요청(docs/DECIDER_REQUEST.md)에는
// 출발 주소도 없다. 그래서 아래 deny-rules.json 은 "넣을 규칙을 적어 둔 기록"이고, 판정기에 연결되지는 않았다.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const FIXTURE_PATH = join(ROOT, 'xdr', 'fixtures', 'brute-force.json');
export const ALERTS_LOG_PATH = join(ROOT, 'xdr', 'alerts.log');
export const DENY_RULES_PATH = join(HERE, 'deny-rules.json');
// 규칙 만료 시각 = 근거 경보 가운데 가장 늦은 경보 시각 + 이 분. 시험 경보를 다시 흘려도 같은 결과가 나온다.
export const DENY_TTL_MINUTES = 60;

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/u;
// 사설·루프백·링크 로컬·미지정 주소는 정상 사용자일 가능성이 커서 차단 규칙을 만들지 않는다.
const NEVER_BLOCK = [/^0\./u, /^10\./u, /^127\./u, /^169\.254\./u, /^172\.(?:1[6-9]|2\d|3[01])\./u, /^192\.168\./u];
const oneLine = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim();

export function blockableAddress(srcip) {
  if (typeof srcip !== 'string' || !IPV4.test(srcip)) return { ok: false, why: '주소 형식이 아님' };
  if (NEVER_BLOCK.some(pattern => pattern.test(srcip))) return { ok: false, why: '사설·루프백 주소' };
  return { ok: true };
}

const minutes = value => value * 60 * 1000;

// 경보와 판단 결과를 받아 만들 거부 규칙과 알림 줄을 계산한다(파일은 건드리지 않는다).
export function planResponse(entries) {
  const bySource = new Map();
  for (const entry of entries) {
    const src = entry.alert?.data?.srcip;
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(entry);
  }

  const rules = [];
  const held = new Map();
  for (const [src, group] of bySource) {
    const blocks = group.filter(entry => entry.decision.action === 'block');
    if (blocks.length === 0) continue;
    const address = blockableAddress(src);
    const hasNormal = group.some(entry => entry.decision.action === 'record');
    const times = blocks.map(entry => Date.parse(entry.alert.timestamp));
    let why = null;
    if (!address.ok) why = address.why;
    else if (hasNormal) why = '같은 주소에 정상 경보가 있음';
    else if (times.some(time => Number.isNaN(time))) why = '경보 시각을 읽을 수 없음';
    if (why) {
      for (const entry of blocks) held.set(entry.alert.id, why);
      continue;
    }
    rules.push({
      ruleId: `brute-force.deny.${src}`,
      action: 'deny',
      match: { srcip: src },
      reasons: [...new Set(blocks.map(entry => entry.decision.reason))],
      confidence: Math.max(...blocks.map(entry => entry.decision.confidence)),
      evidenceAlertIds: blocks.map(entry => entry.alert.id),
      effectiveFrom: new Date(Math.min(...times)).toISOString(),
      expiresAt: new Date(Math.max(...times) + minutes(DENY_TTL_MINUTES)).toISOString(),
    });
  }
  rules.sort((a, b) => a.match.srcip.localeCompare(b.match.srcip, 'en', { numeric: true }));

  const ruleBySource = new Map(rules.map(rule => [rule.match.srcip, rule]));
  const lines = [];
  for (const { alert, decision } of entries) {
    if (decision.action === 'record') continue;
    const id = oneLine(alert?.id);
    const src = IPV4.test(alert?.data?.srcip ?? '') ? alert.data.srcip : '-';
    const rule = decision.action === 'block' ? ruleBySource.get(alert.data.srcip) : null;
    const level = decision.action === 'block' && rule ? 'BLOCK' : 'ALERT';
    const note = decision.action === 'block' && !rule ? ` | 차단 보류: ${held.get(alert.id) ?? '규칙을 만들지 못함'}`
      : rule ? ` | 거부 규칙 ${rule.ruleId} (만료 ${rule.expiresAt})` : '';
    lines.push({ key: `${level} alert=${id}`,
      text: `${oneLine(alert?.timestamp)} ${level} alert=${id} src=${src} confidence=${decision.confidence} ${oneLine(decision.reason)}${note}` });
  }
  return { rules, lines, held };
}

// 규칙 목록에서 이 주소가 그 시각에 막히는지 본다. 시험 경보를 다시 흘려 볼 때와 나중에 판정기에 연결할 때 쓴다.
export function isDenied(srcip, at, rulesDoc) {
  const time = Date.parse(at);
  if (Number.isNaN(time)) return null;
  return (rulesDoc?.rules ?? []).find(rule => rule.match.srcip === srcip
    && time >= Date.parse(rule.effectiveFrom) && time < Date.parse(rule.expiresAt)) ?? null;
}

async function existingKeys(path) {
  try {
    const text = await readFile(path, 'utf8');
    return new Set(text.split('\n').map(line => /^\S+ (BLOCK|ALERT) alert=(\S+)/u.exec(line)).filter(Boolean)
      .map(match => `${match[1]} alert=${match[2]}`));
  } catch (error) {
    if (error?.code === 'ENOENT') return new Set();
    throw error;
  }
}

export async function respondToAlerts({ alerts, alertsLogPath = ALERTS_LOG_PATH, denyRulesPath = DENY_RULES_PATH } = {}) {
  const entries = [];
  for (const alert of alerts) entries.push({ alert, decision: await decide(alert) });
  const plan = planResponse(entries);

  const doc = {
    schema: 'aleph.xdr.deny-rules.v1',
    moduleKey: 'brute-force',
    connectedToDecider: false,
    ttlMinutes: DENY_TTL_MINUTES,
    note: '넣을 규칙을 적어 둔 기록이다. src/decider.mjs 는 규칙 파일을 읽지 않고 판정 요청에 출발 주소가 없어 아직 연결되지 않았다.',
    rules: plan.rules,
  };
  await mkdir(dirname(denyRulesPath), { recursive: true });
  await writeFile(denyRulesPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

  const seen = await existingKeys(alertsLogPath);
  const fresh = plan.lines.filter(line => !seen.has(line.key));
  if (fresh.length) {
    await mkdir(dirname(alertsLogPath), { recursive: true });
    await appendFile(alertsLogPath, `${fresh.map(line => line.text).join('\n')}\n`, 'utf8');
  }
  return { rules: plan.rules, doc, logged: fresh.length, logLines: plan.lines.length, held: plan.held.size,
    counts: entries.reduce((sum, entry) => ({ ...sum, [entry.decision.action]: sum[entry.decision.action] + 1 }),
      { block: 0, alert: 0, record: 0 }) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
    const out = await respondToAlerts({ alerts: fixture.alerts });
    console.log(`거부 규칙 ${out.rules.length}개 · 알림 ${out.logLines}줄(새로 쌓음 ${out.logged}줄) · 차단 보류 ${out.held}건`);
    console.log('ZTNA 판정기에는 연결하지 않았습니다(규칙 파일을 읽지 않고, 판정 요청에 출발 주소가 없음).');
  } catch (error) {
    console.error(error instanceof Error ? error.message : '실행 오류');
    process.exitCode = 1;
  }
}
