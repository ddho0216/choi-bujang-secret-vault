import { notesApiFromEnvironment } from '../../src/notes-api.mjs';

// GET·PUT·DELETE /api/notes/:id. 로그인한 사용자만 쓸 수 있다.
// 소유자 검사는 src/notes-api.mjs 에서 한다: 남의 메모는 없는 메모와 같이 404 로 거부한다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  let api;
  try {
    api = notesApiFromEnvironment();
  } catch {
    return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  }
  if (!api) return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  const id = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  return api(request, response, id ?? '');
}
