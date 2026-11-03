import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { SUPABASE_PUBLISHABLE_KEY } from './supabase-public.mjs';
import { createOpsSummary } from './ops-api.mjs';
import { createLoginVerifier } from './verify-login.mjs';

// 11단계 기기 승인: GET /api/device (상태), POST /api/device { action: 'request' | 'approve', password? }
// - 기기 값은 서버가 만든 무작위 값이며 HttpOnly 쿠키로만 가진다. 화면 스크립트와 브라우저 저장소(local/sessionStorage)에는 넣지 않는다.
// - 서버에는 그 값의 SHA-256 만 저장한다. 승인은 같은 계정의 비밀번호를 서버가 다시 확인해야 하며 버튼만으로는 되지 않는다.
// - 이 기록은 학생 서버의 것이다. 판정기의 deviceRegistered 는 운영 엔진이 정하므로 바꾸지도 보내지도 않는다.
const COOKIE = 'vault-device';
const DEVICE_ID = /^[0-9a-f]{64}$/u;
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;
const PENDING_MAX_PER_USER = 5;
const PASSWORD_MAX = 1024;
const FORBIDDEN_KEYS = ['role', 'roles', 'isInstructor', 'is_instructor', 'instructor', 'isAdmin', 'is_admin', 'admin',
  'user_id', 'userId', 'owner_id', 'ownerId', 'deviceId', 'device_id', 'status'];
const hasForbiddenKey = input => Boolean(input) && typeof input === 'object' && FORBIDDEN_KEYS.some(key => Object.hasOwn(input, key));

export const deviceHash = id => createHash('sha256').update(id, 'utf8').digest('hex');

const send = (response, status, payload) => {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(status).json(payload);
};
const readBody = request => {
  const raw = request.body;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};
const readCookie = request => {
  const header = request.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) {
      const value = rest.join('=');
      return DEVICE_ID.test(value) ? value : null;
    }
  }
  return null;
};
const cookieHeader = id => `${COOKIE}=${id}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${60 * 60 * 24 * 90}`;
const defaultLog = entry => console.warn(JSON.stringify(entry));

export function createDeviceApi({ verifier, supabase, verifyPassword, ops = null, now = () => Date.now(), newDeviceId = () => randomBytes(32).toString('hex'), log = defaultLog }) {
  const table = () => supabase.from('device_approvals');
  const refuse = (response, status, error, reason) => {
    log({ event: 'device_deny', status, reason });
    return send(response, status, { error });
  };
  const expired = row => row.status === 'pending' && now() - Date.parse(row.created_at) > PENDING_MAX_AGE_MS;

  // 이 계정의 이 기기 기록. 쿠키가 없거나 다른 계정의 기기면 기록이 없는 것으로 본다.
  async function current(request, user) {
    const id = readCookie(request);
    if (!id) return { id: null, row: null };
    const { data, error } = await table().select('id, user_id, status, created_at, approved_at')
      .eq('device_hash', deviceHash(id)).eq('user_id', user.userId).maybeSingle();
    if (error) throw new Error('device_lookup_failed');
    return { id, row: data ?? null };
  }
  const statusOf = row => (!row ? 'none' : expired(row) ? 'expired' : row.status);

  return async function handle(request, response) {
    try {
      const user = await verifier(request.headers?.authorization);
      if (!user) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return refuse(response, 401, 'UNAUTHENTICATED', 'no_valid_login');
      }
      if (request.method === 'GET') {
        const { row } = await current(request, user);
        // 12단계: 서버 함수 한도 때문에 작전실 요약을 같은 함수에 붙였다(GET /api/device?view=ops).
        if (ops && request.query?.view === 'ops') return send(response, 200, await ops({ request, user, deviceStatus: statusOf(row) }));
        return send(response, 200, { status: statusOf(row) });
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        return refuse(response, 405, 'METHOD_NOT_ALLOWED', 'method_not_allowed');
      }
      const input = readBody(request);
      if (!input || typeof input !== 'object') return send(response, 400, { error: 'INVALID_REQUEST' });
      if (hasForbiddenKey(input)) return refuse(response, 403, 'CLAIM_REJECTED', 'forbidden_key_in_body');

      if (input.action === 'request') {
        const { row } = await current(request, user);
        if (row?.status === 'approved') return send(response, 200, { status: 'approved' });
        const pending = await table().select('id, status, created_at').eq('user_id', user.userId).eq('status', 'pending');
        if (pending.error) throw new Error('device_lookup_failed');
        // 만료된 요청은 세지 않는다(잊어버린 요청이 쌓여 영영 막히지 않게).
        if ((pending.data ?? []).filter(item => !expired(item)).length >= PENDING_MAX_PER_USER) return refuse(response, 429, 'TOO_MANY_PENDING', 'pending_limit');
        const id = newDeviceId();
        const created = await table().insert({ user_id: user.userId, device_hash: deviceHash(id), status: 'pending', created_at: new Date(now()).toISOString() });
        if (created.error) return send(response, 502, { error: 'DEVICE_UNAVAILABLE' });
        response.setHeader('Set-Cookie', cookieHeader(id));
        log({ event: 'device_request', status: 202 });
        return send(response, 202, { status: 'pending' });
      }

      if (input.action === 'approve') {
        const { id, row } = await current(request, user);
        if (!row) return refuse(response, 404, 'NOT_FOUND', 'no_request_for_device');
        if (row.status === 'approved') return send(response, 200, { status: 'approved' });
        if (statusOf(row) !== 'pending') return refuse(response, 409, 'REQUEST_EXPIRED', 'not_pending');
        if (typeof input.password !== 'string' || !input.password || input.password.length > PASSWORD_MAX) {
          return send(response, 400, { error: 'PASSWORD_REQUIRED' });
        }
        // 같은 계정의 비밀번호를 서버가 다시 확인한다. 확인한 사용자가 이 로그인의 사용자와 같아야 한다.
        const verifiedId = await verifyPassword(input.password, request.headers?.authorization);
        if (!verifiedId || verifiedId !== user.userId) return refuse(response, 403, 'REAUTH_FAILED', 'password_check_failed');
        const updated = await table().update({ status: 'approved', approved_at: new Date(now()).toISOString() })
          .eq('device_hash', deviceHash(id)).eq('user_id', user.userId).eq('status', 'pending').select('id');
        if (updated.error) return send(response, 502, { error: 'DEVICE_UNAVAILABLE' });
        if (!updated.data?.length) return refuse(response, 409, 'REQUEST_EXPIRED', 'not_pending');
        log({ event: 'device_approved', status: 200 });
        return send(response, 200, { status: 'approved' });
      }
      return send(response, 400, { error: 'INVALID_ACTION' });
    } catch {
      return send(response, 502, { error: 'DEVICE_UNAVAILABLE' });
    }
  };
}

let cached;
export function deviceApiFromEnvironment(env = process.env) {
  if (cached) return cached;
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const supabase = createClient(url, key, options);
  const verifier = createLoginVerifier({ config, supabaseSecretKey: key });
  // 비밀번호를 서버가 다시 확인한다. 이메일은 이 로그인 토큰의 계정에서 서버가 직접 읽고, 요청 본문에서 받지 않는다.
  const verifyPassword = async (password, authorization) => {
    const token = /^Bearer (\S+)$/u.exec(authorization ?? '')?.[1];
    if (!token) return null;
    const { data: found, error: lookupError } = await supabase.auth.getUser(token);
    if (lookupError || !found?.user?.email) return null;
    const anon = createClient(url, SUPABASE_PUBLISHABLE_KEY, options);
    const { data, error } = await anon.auth.signInWithPassword({ email: found.user.email, password });
    return error ? null : (data?.user?.id ?? null);
  };
  cached = createDeviceApi({ verifier, supabase, verifyPassword, ops: createOpsSummary({ supabase }) });
  return cached;
}
