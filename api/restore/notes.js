import { restoreApiFromEnvironment } from '../../src/restore-api.mjs';

// POST /api/restore/notes  { "id": "<메모 UUID>" }: 비공개 백업에서 로그인한 사용자 본인의 메모 한 건만 되살린다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  let api;
  try {
    api = restoreApiFromEnvironment();
  } catch {
    return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  }
  if (!api) return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  return api(request, response);
}
