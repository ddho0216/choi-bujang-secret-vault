import { deviceApiFromEnvironment } from '../src/device-api.mjs';

// GET /api/device (이 기기의 승인 상태), POST /api/device (승인 요청·승인). 로그인한 사용자만 쓸 수 있다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  let api;
  try {
    api = deviceApiFromEnvironment();
  } catch {
    return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  }
  if (!api) return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  return api(request, response);
}
