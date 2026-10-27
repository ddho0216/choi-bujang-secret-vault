import { notesApiFromEnvironment } from '../../src/notes-api.mjs';

// GET·PUT·DELETE /api/notes/:id. 로그인한 사용자만 쓸 수 있다.
// 소유자 검사는 아직 없다(4단계에서 추가): id를 아는 로그인 사용자는 남의 메모도 다룰 수 있다.
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
