// 무차별 로그인 판단 모듈. 이 파일 하나만 불러와 경보마다 바로 답한다.
// import 문이 없고, 파일을 읽거나 쓰지 않고, 바깥에 묻지 않고, 이 파일 안에서 혼자 계산한다.
// 패턴은 xdr/brute-force/patterns.json 에서 옮겨 적은 것이다. 한쪽을 고치면 다른 쪽도 같이 고친다.
const THRESHOLDS = Object.freeze({ block: 0.85, alert: 0.5 });
const CORROBORATION_BONUS = 0.03;
export const PATTERNS = Object.freeze([
  { name: 'burst_failures', technique: 'T1110.001', confidence: 0.92,
    when: { mitre: 'T1110', minLevel: 10, minCount: 30 } },
  { name: 'spray_many_accounts', technique: 'T1110.003', confidence: 0.9,
    when: { mitre: 'T1110', minLevel: 10, anyPatterns: ['여러 계정', '서로 다른 계정', '계정\\s*\\d+\\s*개', '계정 이름을 바꿔'] } },
  { name: 'failures_then_success', technique: 'T1110', confidence: 0.58,
    when: { mitre: 'T1110', minLevel: 5, maxLevel: 9, anyPatterns: ['(뒤|후)에?\\s*(그\\s*뒤\\s*)?성공'] } },
  { name: 'lockout_retry', technique: 'T1110', confidence: 0.62,
    when: { mitre: 'T1110', minLevel: 5, anyPatterns: ['잠금'] } },
  { name: 'low_volume_failures', technique: 'T1110', confidence: 0.5,
    when: { mitre: 'T1110', minLevel: 5, maxLevel: 9, minCount: 3, maxCount: 29 } },
]);

const COMPILED = PATTERNS.map(pattern => ({
  ...pattern,
  regexes: (pattern.when.anyPatterns ?? []).map(source => new RegExp(source, 'u')),
}));

const round2 = value => Math.round(value * 100) / 100;
// Wazuh 경보의 data 값은 문자열("48")로 오기도 해서, 숫자나 숫자만 든 문자열을 숫자로 읽는다.
const finite = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^\d{1,9}$/u.test(value.trim())) return Number(value);
  return null;
};

// 경보에서 판단에 쓰는 값만 꺼낸다. 값이 없거나 모양이 다르면 null로 둔다.
function readFacts(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) return null;
  return {
    level: finite(alert.rule?.level),
    count: finite(alert.data?.count),
    mitre: Array.isArray(alert.rule?.mitre) ? alert.rule.mitre.filter(id => typeof id === 'string') : [],
    text: typeof alert.rule?.description === 'string' ? alert.rule.description : '',
  };
}

function matches(pattern, facts) {
  const { when, regexes } = pattern;
  if (when.mitre !== undefined && !facts.mitre.includes(when.mitre)) return false;
  if (when.minLevel !== undefined && !(facts.level !== null && facts.level >= when.minLevel)) return false;
  if (when.maxLevel !== undefined && !(facts.level !== null && facts.level <= when.maxLevel)) return false;
  if (when.minCount !== undefined && !(facts.count !== null && facts.count >= when.minCount)) return false;
  if (when.maxCount !== undefined && !(facts.count !== null && facts.count <= when.maxCount)) return false;
  if (regexes.length > 0 && !regexes.some(regex => regex.test(facts.text))) return false;
  return true;
}

// 확신도: 맞은 패턴 중 가장 높은 값에, 서로 다른 패턴이 더 맞을 때마다 조금 더한다.
// 0.85 이상이면 block, 0.5 이상이면 alert, 그 아래는 record 다.
export function decide(alert) {
  const facts = readFacts(alert);
  if (!facts) return { action: 'record', confidence: 0, reason: '경보 형식이 아니라서 기록만 합니다' };
  const hits = COMPILED.filter(pattern => matches(pattern, facts));
  if (hits.length === 0) return { action: 'record', confidence: 0.05, reason: '일치하는 패턴 없음' };
  const top = Math.max(...hits.map(pattern => pattern.confidence));
  const confidence = Math.min(1, round2(top + CORROBORATION_BONUS * (hits.length - 1)));
  const action = confidence >= THRESHOLDS.block ? 'block' : confidence >= THRESHOLDS.alert ? 'alert' : 'record';
  return { action, confidence, reason: `패턴 ${hits.map(pattern => pattern.name).join(', ')}` };
}
