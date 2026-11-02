// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
// 요청은 docs/DECIDER_REQUEST.md 의 이름만 읽습니다(request.role, identity, device, geo 같은 값은 읽지 않습니다).
//
// 6단계: 등록한 기기만 들어옵니다. deviceRegistered 가 true 일 때만 허용하고,
// false 이거나 값이 없거나 true 가 아니면 deny 와 이유 코드 device_not_registered 로 거부합니다.
export const RULE_IDS = Object.freeze(['device_registered']);

export async function decide(request) {
  const registered = request?.deviceRegistered === true;
  return {
    schema: 'aleph.decision.v1',
    requestId: request?.requestId,
    decision: registered ? 'allow' : 'deny',
    reasonCode: registered ? 'approved' : 'device_not_registered',
    ruleIds: ['device_registered'],
  };
}
