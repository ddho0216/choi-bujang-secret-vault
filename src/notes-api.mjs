import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TITLE_MAX = 200;
const BODY_MAX = 5000;

const send = (response, status, payload) => {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(status).json(payload);
};
const toPublic = row => ({ id: row.id, title: row.title, body: row.content });
const readBody = request => {
  const raw = request.body;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};
// 제목·본문만 받는다. 길이를 제한하고, 그 밖의 칸(owner_id 등)은 무시한다.
const validNote = input => input && typeof input.title === 'string' && typeof input.body === 'string'
  && input.title.trim().length > 0 && input.title.length <= TITLE_MAX && input.body.length <= BODY_MAX;

// 소유자는 서버가 검증한 사용자 ID(user.userId)로만 정한다. URL·본문의 owner_id는 믿지 않는다.
// 한 건 읽기·수정·삭제는 id와 owner_id를 한 질의에 함께 걸어, 남의 메모와 없는 메모를 똑같이 404로 거부한다.
// (남의 메모가 있다는 사실도 알려 주지 않는다.)
const bodyOwner = input => (Object.hasOwn(input, 'owner_id') ? input.owner_id
  : Object.hasOwn(input, 'ownerId') ? input.ownerId : undefined);
export function createNotesApi({ verifier, supabase }) {
  const notes = () => supabase.from('notes');

  async function collection(request, response, user) {
    if (request.method === 'GET') {
      const { data, error } = await notes().select('id, title, content')
        .eq('owner_id', user.userId).order('created_at', { ascending: true });
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return send(response, 200, data.map(toPublic));
    }
    if (request.method === 'POST') {
      const input = readBody(request);
      if (!validNote(input)) return send(response, 400, { error: 'INVALID_NOTE' });
      if (input.id !== undefined && (typeof input.id !== 'string' || !UUID.test(input.id))) {
        return send(response, 400, { error: 'INVALID_ID' });
      }
      const id = input.id ?? randomUUID();
      // 본문에 owner_id가 있어도 쓰지 않는다. 항상 서버가 확인한 사용자 ID로 저장한다.
      const { error } = await notes().insert(
        { id, owner_id: user.userId, title: input.title.trim(), content: input.body });
      if (error?.code === '23505') return send(response, 409, { error: 'ID_EXISTS' });
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return send(response, 201, { id });
    }
    response.setHeader('Allow', 'GET, POST');
    return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
  }

  async function item(request, response, id, user) {
    if (!UUID.test(id ?? '')) return send(response, 404, { error: 'NOT_FOUND' });
    if (request.method === 'GET') {
      const { data, error } = await notes().select('id, title, content')
        .eq('id', id).eq('owner_id', user.userId).maybeSingle();
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return data ? send(response, 200, toPublic(data)) : send(response, 404, { error: 'NOT_FOUND' });
    }
    if (request.method === 'PUT') {
      const input = readBody(request);
      if (!validNote(input)) return send(response, 400, { error: 'INVALID_NOTE' });
      // 소유자를 바꾸려는 요청(본문 owner_id가 내 ID가 아님)은 거부한다.
      const claimed = bodyOwner(input);
      if (claimed !== undefined && claimed !== user.userId) {
        return send(response, 403, { error: 'OWNER_CHANGE_FORBIDDEN' });
      }
      // 기존 행의 소유자가 나일 때만 고친다. 새 행의 owner_id는 값에 넣지 않으므로 그대로 나다.
      const { data, error } = await notes().update({ title: input.title.trim(), content: input.body })
        .eq('id', id).eq('owner_id', user.userId).select('id, title, content');
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return data?.length ? send(response, 200, toPublic(data[0])) : send(response, 404, { error: 'NOT_FOUND' });
    }
    if (request.method === 'DELETE') {
      const { data, error } = await notes().delete()
        .eq('id', id).eq('owner_id', user.userId).select('id');
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return data?.length ? send(response, 200, { id }) : send(response, 404, { error: 'NOT_FOUND' });
    }
    response.setHeader('Allow', 'GET, PUT, DELETE');
    return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
  }

  return async function handle(request, response, id) {
    try {
      const user = await verifier(request.headers?.authorization);
      if (!user) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return send(response, 401, { error: 'UNAUTHENTICATED' });
      }
      return id === undefined ? await collection(request, response, user) : await item(request, response, id, user);
    } catch {
      return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
    }
  };
}

// 서버 함수 실행 환경에서 한 번만 만든다. 서버 전용 키는 환경변수에서만 읽는다.
let cached;
export function notesApiFromEnvironment(env = process.env) {
  if (cached) return cached;
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const verifier = createLoginVerifier({ config, supabaseSecretKey: key });
  cached = createNotesApi({ verifier, supabase });
  return cached;
}
