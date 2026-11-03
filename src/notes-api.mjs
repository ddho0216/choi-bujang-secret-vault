import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { RESOURCE_ZONES } from './decider.mjs';
import { createDeviceCheck } from './device-check.mjs';
import { createLoginVerifier } from './verify-login.mjs';

// 8단계: 요청마다 서버가 구별하는 자원 ID(memo:<id>, 목록·추가는 memo:*). 응답 머리 X-Resource-Id 로도 내보낸다.
// 구역 정의는 판정기(src/decider.mjs)와 같은 것을 쓴다. 경로에서 온 ID는 안전한 글자일 때만 그대로 쓴다.
const SAFE_ID = /^[A-Za-z0-9._~-]{1,100}$/u;
export const memoResourceId = id => (id === undefined ? `${RESOURCE_ZONES.memo.kind}:*`
  : SAFE_ID.test(id) ? `${RESOURCE_ZONES.memo.kind}:${id}` : `${RESOURCE_ZONES.memo.kind}:invalid`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TITLE_MAX = 200;
const BODY_MAX = 5000;

// 거부 사유를 한 줄로 남긴다(토큰·요청 본문·사용자 ID는 쓰지 않는다). 기본은 서버 로그(console.warn)다.
const defaultLog = entry => console.warn(JSON.stringify(entry));
// 요청 본문의 역할·권한 표시는 믿지 않는다. 권한은 서버가 검증한 로그인과 저장된 소유자로만 정한다.
// 이 자료실에는 강사 권한을 저장한 곳이 없어서 아무도 강사가 아니다.
const ROLE_KEYS = ['role', 'roles', 'isInstructor', 'is_instructor', 'instructor', 'isAdmin', 'is_admin', 'admin'];
const hasRoleClaim = input => Boolean(input) && typeof input === 'object' && ROLE_KEYS.some(key => Object.hasOwn(input, key));

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
// 11단계: 메모는 서버가 이 계정의 승인된 기기에서 온 요청임을 확인한 뒤에만 읽고 쓴다.
// deviceCheck(request, user) 는 'approved' 를 돌려줄 때만 통과이고, 그 밖의 값(none·pending·expired·revoked)이나 확인 실패(던짐)나
// deviceCheck 를 주지 않은 경우는 모두 자료를 읽기 전에 거부한다(확인할 수 없으면 거부).
export function createNotesApi({ verifier, supabase, log = defaultLog, deviceCheck = null }) {
  const notes = () => supabase.from('notes');
  // 거부 응답과 사유 기록을 함께 한다. 응답에는 사유를 따로 싣지 않는다(남의 메모가 있다는 사실도 알리지 않기 위해서다).
  const refuse = (response, status, error, reason, resourceId) => {
    log({ event: 'deny', status, reason, resource: resourceId });
    return send(response, status, { error });
  };

  async function collection(request, response, user, resourceId) {
    if (request.method === 'GET') {
      const { data, error } = await notes().select('id, title, content')
        .eq('owner_id', user.userId).order('created_at', { ascending: true });
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return send(response, 200, data.map(toPublic));
    }
    if (request.method === 'POST') {
      const input = readBody(request);
      if (hasRoleClaim(input)) return refuse(response, 403, 'ROLE_CLAIM_REJECTED', 'role_claim_in_body', resourceId);
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
    return refuse(response, 405, 'METHOD_NOT_ALLOWED', 'method_not_allowed', resourceId);
  }

  async function item(request, response, id, user, resourceId) {
    if (!UUID.test(id ?? '')) return refuse(response, 404, 'NOT_FOUND', 'invalid_id', resourceId);
    if (request.method === 'GET') {
      const { data, error } = await notes().select('id, title, content')
        .eq('id', id).eq('owner_id', user.userId).maybeSingle();
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return data ? send(response, 200, toPublic(data)) : refuse(response, 404, 'NOT_FOUND', 'not_found_or_not_owner', resourceId);
    }
    if (request.method === 'PUT') {
      const input = readBody(request);
      if (hasRoleClaim(input)) return refuse(response, 403, 'ROLE_CLAIM_REJECTED', 'role_claim_in_body', resourceId);
      if (!validNote(input)) return send(response, 400, { error: 'INVALID_NOTE' });
      // 소유자를 바꾸려는 요청(본문 owner_id가 내 ID가 아님)은 거부한다.
      const claimed = bodyOwner(input);
      if (claimed !== undefined && claimed !== user.userId) {
        return refuse(response, 403, 'OWNER_CHANGE_FORBIDDEN', 'owner_change', resourceId);
      }
      // 기존 행의 소유자가 나일 때만 고친다. 새 행의 owner_id는 값에 넣지 않으므로 그대로 나다.
      const { data, error } = await notes().update({ title: input.title.trim(), content: input.body })
        .eq('id', id).eq('owner_id', user.userId).select('id, title, content');
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return data?.length ? send(response, 200, toPublic(data[0])) : refuse(response, 404, 'NOT_FOUND', 'not_found_or_not_owner', resourceId);
    }
    if (request.method === 'DELETE') {
      const { data, error } = await notes().delete()
        .eq('id', id).eq('owner_id', user.userId).select('id');
      if (error) return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
      return data?.length ? send(response, 200, { id }) : refuse(response, 404, 'NOT_FOUND', 'not_found_or_not_owner', resourceId);
    }
    response.setHeader('Allow', 'GET, PUT, DELETE');
    return refuse(response, 405, 'METHOD_NOT_ALLOWED', 'method_not_allowed', resourceId);
  }

  return async function handle(request, response, id) {
    try {
      const resourceId = memoResourceId(id);
      response.setHeader('X-Resource-Id', resourceId);
      const user = await verifier(request.headers?.authorization);
      if (!user) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return refuse(response, 401, 'UNAUTHENTICATED', 'no_valid_login', resourceId);
      }
      let approval = null;
      try { approval = deviceCheck ? await deviceCheck(request, user) : null; } catch { approval = null; }
      if (approval !== 'approved') {
        return refuse(response, 403, 'DEVICE_NOT_APPROVED', approval === null ? 'device_check_failed' : `device_${approval}`, resourceId);
      }
      return id === undefined ? await collection(request, response, user, resourceId)
        : await item(request, response, id, user, resourceId);
    } catch {
      return send(response, 502, { error: 'NOTES_UNAVAILABLE' });
    }
  };
}

// 로그인 검증기는 서버 함수 실행 환경에서 한 번만 만든다. 서버 전용 키는 환경변수에서만 읽는다.
let cachedVerifier;
export function verifierFromEnvironment(env = process.env) {
  if (cachedVerifier) return cachedVerifier;
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  cachedVerifier = createLoginVerifier({ config, supabaseSecretKey: key });
  return cachedVerifier;
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
  cached = createNotesApi({ verifier, supabase, deviceCheck: createDeviceCheck({ supabase }) });
  return cached;
}
