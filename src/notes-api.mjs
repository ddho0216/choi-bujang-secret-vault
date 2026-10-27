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

// 서버가 확인한 사용자 ID로만 로그인 여부를 판단한다. 소유자 검사는 4단계에서 붙인다.
// 지금은 id만 알면 누구든 다른 사람의 메모를 읽고 고치고 지울 수 있다(알려진 허점).
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
      const { error } = await notes().insert(
        { id, owner_id: user.userId, title: input.title.trim(), content: input.body });
      if (error?.code === '23505') return send(response, 409, { error: 'ID_EXISTS' });
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return send(response, 201, { id });
    }
    response.setHeader('Allow', 'GET, POST');
    return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
  }

  async function item(request, response, id) {
    if (!UUID.test(id ?? '')) return send(response, 404, { error: 'NOT_FOUND' });
    if (request.method === 'GET') {
      const { data, error } = await notes().select('id, title, content').eq('id', id).maybeSingle();
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return data ? send(response, 200, toPublic(data)) : send(response, 404, { error: 'NOT_FOUND' });
    }
    if (request.method === 'PUT') {
      const input = readBody(request);
      if (!validNote(input)) return send(response, 400, { error: 'INVALID_NOTE' });
      const { data, error } = await notes().update({ title: input.title.trim(), content: input.body })
        .eq('id', id).select('id, title, content');
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return data?.length ? send(response, 200, toPublic(data[0])) : send(response, 404, { error: 'NOT_FOUND' });
    }
    if (request.method === 'DELETE') {
      const { data, error } = await notes().delete().eq('id', id).select('id');
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
      return id === undefined ? await collection(request, response, user) : await item(request, response, id);
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
