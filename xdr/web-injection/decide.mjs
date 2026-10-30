// 웹 주입 판단 모듈. 이 파일 하나만 불러와 경보마다 바로 답한다.
// import 문이 없고, 파일을 읽거나 쓰지 않고, 바깥에 묻지 않고, 이 파일 안에서 혼자 계산한다.
// 패턴은 xdr/web-injection/patterns.json 에서 옮겨 적은 것이다. 한쪽을 고치면 다른 쪽도 같이 고친다.
const THRESHOLDS = Object.freeze({ block: 0.85, alert: 0.5 });
const CORROBORATION_BONUS = 0.03;
export const PATTERNS = Object.freeze([
  { name: 'repeated_injection_marks', technique: 'T1190', confidence: 0.88,
    when: { mitre: 'T1190', minLevel: 10, minCount: 8 } },
  { name: 'sql_injection_repeat', technique: 'T1190', confidence: 0.92,
    when: { mitre: 'T1190', minLevel: 10, minCount: 8, anyPatterns: ['SQL', '데이터베이스 조회'] } },
  { name: 'script_tag_repeat', technique: 'T1190', confidence: 0.92,
    when: { mitre: 'T1190', minLevel: 10, minCount: 8, anyPatterns: ['스크립트'] } },
  { name: 'path_traversal_repeat', technique: 'T1190', confidence: 0.92,
    when: { mitre: 'T1190', minLevel: 10, minCount: 8, anyPatterns: ['경로.*(거슬러|이탈)'] } },
  { name: 'payload_in_url_repeat', technique: 'T1190', confidence: 0.92,
    when: {
      mitre: 'T1190',
      minCount: 5,
      anyUrlPatterns: [
        '\\bunion\\b[\\s\\S]{0,20}\\bselect\\b',
        '\\bor\\b\\s+[\'"]?\\d+[\'"]?\\s*=\\s*[\'"]?\\d+',
        '[\'"]\\s*(?:or|and)\\s+[\'"]?\\w+[\'"]?\\s*=',
        ';\\s*(?:drop|delete|insert|update)\\b',
        '<\\s*script',
        'javascript:',
        '(?:\\.\\.[/\\\\]){2,}',
      ],
    } },
  { name: 'single_injection_mark', technique: 'T1190', confidence: 0.5,
    when: { mitre: 'T1190', minLevel: 5, maxLevel: 9, minCount: 1, maxCount: 3 } },
]);

const COMPILED = PATTERNS.map(pattern => ({
  ...pattern,
  regexes: (pattern.when.anyPatterns ?? []).map(source => new RegExp(source, 'iu')),
  urlRegexes: (pattern.when.anyUrlPatterns ?? []).map(source => new RegExp(source, 'iu')),
}));

const round2 = value => Math.round(value * 100) / 100;
// Wazuh 경보의 data 값은 문자열("12")로 오기도 해서, 숫자나 숫자만 든 문자열을 숫자로 읽는다.
const finite = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^\d{1,9}$/u.test(value.trim())) return Number(value);
  return null;
};
// 주소는 퍼센트 인코딩을 두 번까지 풀어서 본다(이중 인코딩으로 숨기는 경우). 길이는 잘라 낸다.
function decodeUrl(value) {
  if (typeof value !== 'string') return '';
  let text = value.slice(0, 2000).replace(/\+/gu, ' ');
  for (let round = 0; round < 2; round += 1) {
    try {
      const next = decodeURIComponent(text);
      if (next === text) break;
      text = next;
    } catch {
      break;
    }
  }
  return text;
}

// 경보에서 판단에 쓰는 값만 꺼낸다. 값이 없거나 모양이 다르면 null 이나 빈 글자로 둔다.
function readFacts(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) return null;
  return {
    level: finite(alert.rule?.level),
    count: finite(alert.data?.count),
    mitre: Array.isArray(alert.rule?.mitre) ? alert.rule.mitre.filter(id => typeof id === 'string') : [],
    text: typeof alert.rule?.description === 'string' ? alert.rule.description : '',
    url: decodeUrl(alert.data?.url),
  };
}

function matches(pattern, facts) {
  const { when, regexes, urlRegexes } = pattern;
  if (when.mitre !== undefined && !facts.mitre.includes(when.mitre)) return false;
  if (when.minLevel !== undefined && !(facts.level !== null && facts.level >= when.minLevel)) return false;
  if (when.maxLevel !== undefined && !(facts.level !== null && facts.level <= when.maxLevel)) return false;
  if (when.minCount !== undefined && !(facts.count !== null && facts.count >= when.minCount)) return false;
  if (when.maxCount !== undefined && !(facts.count !== null && facts.count <= when.maxCount)) return false;
  if (regexes.length > 0 && !regexes.some(regex => regex.test(facts.text))) return false;
  if (urlRegexes.length > 0 && !urlRegexes.some(regex => regex.test(facts.url))) return false;
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
