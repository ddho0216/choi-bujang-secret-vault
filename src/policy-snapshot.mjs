import { createHash } from 'node:crypto';
import { RESOURCE_ZONES, resourceFor, RULE_IDS, STEP_UP_POLICY, ZONE_RULES } from './decider.mjs';

// 10단계 안전 정책: 1~9단계에서 만든 접근 규칙(판정기 규칙, allowedRoutes, DB 접근 정책)을 한 덩어리로 적은 사본입니다.
// 이 파일은 계산만 하고 파일을 읽거나 쓰지 않습니다(파일 처리는 policy-files.mjs).
export const SNAPSHOT_SCHEMA = 'aleph.policy.snapshot.v1';
export const SNAPSHOT_VERSION = 'safe-1';

export class PolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
  }
}

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// 키를 정렬한 JSON 글자. 줄바꿈·들여쓰기·키 순서가 달라도 같은 내용이면 같은 글자입니다.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
export const policyHash = policy => sha256(canonicalJson(policy));

// DB 접근 정책은 운영 DB를 읽은 것이 아니라, 5단계에서 Supabase에 적용하도록 안내한 SQL 기록
// (supabase/notes-permissions.sql, supabase/notes-revoke-direct.sql)에서 옮긴 선언입니다.
export const DB_POLICY = Object.freeze({
  table: 'public.notes',
  rowLevelSecurity: true,
  tableGrants: Object.freeze({ anon: Object.freeze([]), authenticated: Object.freeze([]), public: Object.freeze([]),
    service_role: Object.freeze(['DELETE', 'INSERT', 'SELECT', 'UPDATE']) }),
  rlsPolicies: Object.freeze({
    notes_delete_own: Object.freeze({ command: 'DELETE', roles: Object.freeze(['authenticated']), using: 'auth.uid() = owner_id' }),
    notes_insert_own: Object.freeze({ command: 'INSERT', roles: Object.freeze(['authenticated']), withCheck: 'auth.uid() = owner_id' }),
    notes_select_own: Object.freeze({ command: 'SELECT', roles: Object.freeze(['authenticated']), using: 'auth.uid() = owner_id' }),
    notes_update_own: Object.freeze({ command: 'UPDATE', roles: Object.freeze(['authenticated']), using: 'auth.uid() = owner_id', withCheck: 'auth.uid() = owner_id' }),
  }),
  source: 'supabase/notes-permissions.sql, supabase/notes-revoke-direct.sql 의 적용 기록(운영 DB를 읽은 값이 아님)',
});

// 지금 코드와 설정에서 안전 정책 사본을 만듭니다.
export function buildSnapshot({ allowedRoutes }) {
  if (!Array.isArray(allowedRoutes) || allowedRoutes.some(route => typeof route !== 'string')) {
    throw new PolicyError('invalid_config', 'aleph.config.json 의 allowedRoutes 가 문자열 목록이 아닙니다.');
  }
  return {
    schema: SNAPSHOT_SCHEMA,
    version: SNAPSHOT_VERSION,
    ruleIds: [...RULE_IDS],
    deviceRule: { requireRegistered: true },
    stepUpRule: {
      unusualHours: { ...STEP_UP_POLICY.unusualHours },
      burstWindowSeconds: STEP_UP_POLICY.burstWindowSeconds,
      burstThreshold: STEP_UP_POLICY.burstThreshold,
      verifiedMaxAgeSeconds: STEP_UP_POLICY.verifiedMaxAgeSeconds,
    },
    services: {
      notes: { zoneRules: [...ZONE_RULES.memo], ownerCheck: true, roleClaimsRejected: true, ownerChangeRejected: true },
      notices: { zoneRules: [...ZONE_RULES.class_notice] },
      instructor: { zoneRules: [...ZONE_RULES.instructor_material] },
    },
    allowedRoutes: [...allowedRoutes],
    db: structuredClone(DB_POLICY),
  };
}

// 두 정책의 차이를 [{ path, before, after }]로 돌려줍니다. 감사 이력(audit)은 비교하지 않습니다.
const flatten = (value, prefix, out) => {
  if (isObject(value) && Object.keys(value).length > 0) {
    for (const key of Object.keys(value).sort()) flatten(value[key], prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.set(prefix, canonicalJson(value));
  }
  return out;
};
const withoutAudit = policy => { const { audit: _audit, ...rest } = policy ?? {}; return rest; };

export function diffPolicies(before, after) {
  const left = flatten(withoutAudit(before), '', new Map());
  const right = flatten(withoutAudit(after), '', new Map());
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  return paths.filter(path => left.get(path) !== right.get(path)).map(path => ({
    path,
    before: left.has(path) ? JSON.parse(left.get(path)) : undefined,
    after: right.has(path) ? JSON.parse(right.get(path)) : undefined,
  }));
}

// 정책으로 요청 하나를 판단합니다(정책이 바뀌면 결과가 바뀌는지 보려는 시험용 계산기입니다).
// 메모의 소유자 검사는 ownerCheck 가 정확히 false 일 때만 건너뜁니다(값이 없거나 이상하면 검사합니다).
const ROOT_OF_ZONE = Object.fromEntries(Object.values(RESOURCE_ZONES).map(zone => [zone.kind, zone.root]));

export function evaluate(policy, { method, path, actor, owner }) {
  const resource = resourceFor(path);
  if (!resource) return { allow: false, reason: 'unknown_route' };
  const root = ROOT_OF_ZONE[resource.zone];
  const service = policy?.services?.[root];
  const shape = `${method} ${resource.template}`;
  if (!service || !Array.isArray(service.zoneRules) || !service.zoneRules.includes(shape)) {
    return { allow: false, reason: 'zone_not_allowed' };
  }
  if (root === 'notes' && service.ownerCheck !== false && owner !== actor) return { allow: false, reason: 'not_owner' };
  return { allow: true, reason: 'allowed' };
}

// 시험 정책: 검증한 사본에서 만들고 감사 이력(audit)을 붙입니다. 침공 흉내는 시험 정책에서만 합니다.
export function createTestPolicy(verified, { at }) {
  return { ...structuredClone(verified), audit: [{ at, event: 'created_from_verified', version: verified.version, hash: policyHash(verified) }] };
}

export const TAMPER_PATH = 'services.notes.ownerCheck';
export function simulateTamper(testPolicy, { at }) {
  const next = structuredClone(testPolicy);
  next.services.notes.ownerCheck = false;
  next.audit = [...(next.audit ?? []), { at, event: 'tamper_simulated', path: TAMPER_PATH, before: true, after: false }];
  return next;
}

// 같은 요청들을 정책에 넣어 보는 확인표입니다. A·B 는 가상 사용자이고, 메모 한 건의 주인은 A 입니다.
export const DEMO_REQUESTS = Object.freeze([
  { name: 'A의 자기 메모 읽기', request: { method: 'GET', path: '/api/notes/note-of-a', actor: 'user_a', owner: 'user_a' }, expected: true },
  { name: 'A의 자기 메모 수정', request: { method: 'PUT', path: '/api/notes/note-of-a', actor: 'user_a', owner: 'user_a' }, expected: true },
  { name: 'B의 A 메모 읽기', request: { method: 'GET', path: '/api/notes/note-of-a', actor: 'user_b', owner: 'user_a' }, expected: false },
  { name: 'B의 A 메모 수정', request: { method: 'PUT', path: '/api/notes/note-of-a', actor: 'user_b', owner: 'user_a' }, expected: false },
  { name: 'B의 A 메모 삭제', request: { method: 'DELETE', path: '/api/notes/note-of-a', actor: 'user_b', owner: 'user_a' }, expected: false },
  { name: '메모 전체 목록', request: { method: 'GET', path: '/api/notes', actor: 'user_a', owner: 'user_a' }, expected: false },
  { name: '반 공지 쓰기', request: { method: 'POST', path: '/api/notices', actor: 'user_a', owner: 'user_a' }, expected: false },
  { name: '강사 자료 읽기', request: { method: 'GET', path: '/api/instructor/m-1', actor: 'user_a', owner: 'user_a' }, expected: false },
]);

export function runDemo(policy) {
  return DEMO_REQUESTS.map(({ name, request, expected }) => {
    const result = evaluate(policy, request);
    return { name, allow: result.allow, reason: result.reason, expected, ok: result.allow === expected };
  });
}

// 복원 계획: 검증한 사본과 시험 정책을 비교해, 복원할 서비스 범위 안에서 바뀔 항목과 범위 밖이라 보존할 항목을 나눕니다.
export function planRestore({ verified, test, service = 'notes' }) {
  if (!verified?.services?.[service]) throw new PolicyError('unknown_service', `검증한 사본에 없는 서비스입니다: ${service}`);
  if (!test?.services) throw new PolicyError('invalid_test_policy', '시험 정책의 형식이 아닙니다.');
  const scope = `services.${service}`;
  const inScope = item => item.path === scope || item.path.startsWith(`${scope}.`);
  const diff = diffPolicies(verified, test);
  return {
    version: verified.version,
    hash: policyHash(verified),
    service,
    scope,
    willChange: diff.filter(inScope),
    preserved: diff.filter(item => !inScope(item)),
    auditEntries: Array.isArray(test.audit) ? test.audit.length : 0,
  };
}

// 복원: 그 서비스의 규칙만 검증한 사본의 것으로 바꾸고, 다른 서비스 규칙과 감사 이력은 그대로 둔 채 복원 기록을 덧붙입니다.
export function applyRestore({ verified, test, service = 'notes', at }) {
  const plan = planRestore({ verified, test, service });
  if (plan.willChange.length === 0) throw new PolicyError('nothing_to_restore', `복원할 것이 없습니다. ${plan.scope} 는 이미 검증한 사본과 같습니다.`);
  const next = structuredClone(test);
  next.services[service] = structuredClone(verified.services[service]);
  next.audit = [...(Array.isArray(test.audit) ? test.audit : []),
    { at, event: 'restore', version: plan.version, hash: plan.hash, scope: plan.scope, changed: plan.willChange.map(item => item.path) }];
  return { next, plan };
}
