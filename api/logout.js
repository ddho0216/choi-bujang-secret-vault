import { authApiFromEnvironment } from '../src/auth-api.mjs';

// POST /api/logout (Authorization: Bearer 토큰) -> 이 로그인 세션을 끊는다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  let api;
  try {
    api = authApiFromEnvironment();
  } catch {
    return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  }
  if (!api) return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  return api.logout(request, response);
}
