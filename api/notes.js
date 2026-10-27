import { notesApiFromEnvironment } from '../src/notes-api.mjs';

// GET /api/notes (내 메모 목록), POST /api/notes (추가). 로그인한 사용자만 쓸 수 있다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  let api;
  try {
    api = notesApiFromEnvironment();
  } catch {
    return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  }
  if (!api) return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  return api(request, response);
}
