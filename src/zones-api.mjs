import { resourceFor } from './decider.mjs';

// 메모 밖의 구역과 알 수 없는 경로를 JSON 으로 거부한다. 메모(/api/notes, /api/notes/:id)는 notes-api.mjs 가 처리한다.
// 이 자료실에는 반 공지와 강사 자료의 데이터가 없고, 강사 권한을 저장한 곳도 없다. 그래서 어떤 응답에도 자료가 들어 있지 않다.
// 메뉴나 요청 본문의 role 은 읽지 않는다. 권한은 서버가 검증한 로그인으로만 정한다.
const defaultLog = entry => console.warn(JSON.stringify(entry));
const SAFE_ID = /^[A-Za-z0-9._:*~-]{1,220}$/u;

const send = (response, status, payload) => {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(status).json(payload);
};

function pathOf(request) {
  try {
    return new URL(String(request.url ?? ''), 'http://localhost').pathname;
  } catch {
    return '';
  }
}

export function createZonesApi({ verifier, log = defaultLog }) {
  return async function handle(request, response) {
    try {
      const resource = resourceFor(pathOf(request));
      const resourceId = resource?.resourceId;
      response.setHeader('X-Resource-Id', resourceId && SAFE_ID.test(resourceId) ? resourceId : 'unknown');
      const refuse = (status, error, reason) => {
        log({ event: 'deny', status, reason, resource: resource?.zone ? `${resource.zone}:${resource.depth === 0 ? '*' : 'id'}` : null });
        return send(response, status, { error, reason });
      };

      const user = await verifier(request.headers?.authorization);
      if (!user) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return refuse(401, 'UNAUTHENTICATED', 'no_valid_login');
      }
      if (!resource) return refuse(404, 'NOT_FOUND', 'unknown_route');
      if (resource.zone === 'instructor_material') return refuse(403, 'FORBIDDEN', 'instructor_only');
      if (resource.zone === 'class_notice') {
        if (request.method === 'GET' && resource.depth <= 1) return refuse(404, 'NOT_FOUND', 'no_notice_data');
        return refuse(403, 'FORBIDDEN', 'notice_write_admin_only');
      }
      // 메모 경로 가운데 notes-api.mjs 가 받지 않는 모양(/api/notes/a/b 등)
      return refuse(404, 'NOT_FOUND', 'unknown_route');
    } catch {
      return send(response, 502, { error: 'ZONES_UNAVAILABLE' });
    }
  };
}
