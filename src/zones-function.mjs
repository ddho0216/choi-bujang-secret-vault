import { verifierFromEnvironment } from './notes-api.mjs';
import { createZonesApi } from './zones-api.mjs';

// 다른 파일이 받지 않는 /api 경로(반 공지, 강사 자료, 알 수 없는 경로)를 JSON 으로 거부하는 서버 함수의 본문입니다.
// Vercel 은 여러 단계를 한꺼번에 받는 파일([...이름].js)을 이 설정에서 한 단계만 받아서, 단계 수마다 파일을 따로 두고 모두 이 함수를 씁니다.
// /api/notes, /api/notes/:id, /api/login, /api/logout 은 각자의 파일이 먼저 받습니다.
let handler;
export default async function handleZones(request, response) {
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
