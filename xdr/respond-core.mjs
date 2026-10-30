// 알림과 차단의 공통 로직: decide 결과 가운데 block 은 거부 규칙 후보로, alert·block 은 알림 줄로 만든다.
// 모듈마다 xdr/<moduleKey>/respond.mjs 가 자기 decide 와 파일 위치를 넣어 이 파일을 쓴다.
// decide.mjs 는 이 파일을 불러오지 않는다(판단만 돌려주고 파일 쓰기·연결은 하지 않는다).
//
// 주의: 이 저장소의 src/decider.mjs 는 시작 틀이라 규칙 파일을 읽지 않고, 판정 요청(docs/DECIDER_REQUEST.md)에는
// 출발 주소도 없다. 그래서 deny-rules.json 은 "넣을 규칙을 적어 둔 기록"이고, 판정기에 연결되지는 않았다.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// 규칙 만료 시각 = 근거 경보 가운데 가장 늦은 경보 시각 + 이 분. 시험 경보를 다시 흘려도 같은 결과가 나온다.
export const DENY_TTL_MINUTES = 60;

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/u;
// 사설·루프백·링크 로컬·미지정 주소는 정상 사용자일 가능성이 커서 차단 규칙을 만들지 않는다.
const NEVER_BLOCK = [/^0\./u, /^10\./u, /^127\./u, /^169\.254\./u, /^172\.(?:1[6-9]|2\d|3[01])\./u, /^192\.168\./u];
const oneLine = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim();
const minutes = value => value * 60 * 1000;

export function blockableAddress(srcip) {
  if (typeof srcip !== 'string' || !IPV4.test(srcip)) return { ok: false, why: '주소 형식이 아님' };
  if (NEVER_BLOCK.some(pattern => pattern.test(srcip))) return { ok: false, why: '사설·루프백 주소' };
  return { ok: true };
}

// 경보와 판단 결과를 받아 만들 거부 규칙과 알림 줄을 계산한다(파일은 건드리지 않는다).
export function planResponse(entries, { moduleKey, ttlMinutes = DENY_TTL_MINUTES }) {
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
      ruleId: `${moduleKey}.deny.${src}`,
      action: 'deny',
      match: { srcip: src },
      reasons: [...new Set(blocks.map(entry => entry.decision.reason))],
      confidence: Math.max(...blocks.map(entry => entry.decision.confidence)),
      evidenceAlertIds: blocks.map(entry => entry.alert.id),
      effectiveFrom: new Date(Math.min(...times)).toISOString(),
      expiresAt: new Date(Math.max(...times) + minutes(ttlMinutes)).toISOString(),
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

export async function respondToAlerts({ alerts, decide, moduleKey, alertsLogPath, denyRulesPath, ttlMinutes = DENY_TTL_MINUTES }) {
  const entries = [];
  for (const alert of alerts) entries.push({ alert, decision: await decide(alert) });
  const plan = planResponse(entries, { moduleKey, ttlMinutes });

  const doc = {
    schema: 'aleph.xdr.deny-rules.v1',
    moduleKey,
    connectedToDecider: false,
    ttlMinutes,
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
