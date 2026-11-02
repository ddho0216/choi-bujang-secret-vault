import { verifierFromEnvironment } from '../src/notes-api.mjs';
import { createZonesApi } from '../src/zones-api.mjs';

// 다른 파일이 받지 않는 모든 /api 경로(반 공지, 강사 자료, 알 수 없는 경로)를 JSON 으로 거부한다.
// /api/notes, /api/notes/:id, /api/login, /api/logout 은 각자의 파일이 먼저 받는다.
let handler;
export default async function route(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (!handler) {
      const verifier = verifierFromEnvironment();
      if (!verifier) return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
      handler = createZonesApi({ verifier });
    }
  } catch {
    return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  }
  return handler(request, response);
}
