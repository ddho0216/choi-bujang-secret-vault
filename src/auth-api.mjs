import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY } from './supabase-public.mjs';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u;
const EMAIL_MAX = 254;
const PASSWORD_MAX = 1024;

const send = (response, status, payload) => {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(status).json(payload);
};
const readBody = request => {
  const raw = request.body;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

// 로그인·로그아웃은 서버 함수가 Supabase 공식 SDK로 대신한다. 브라우저는 Supabase 주소도 키도 모른다.
// 비밀번호는 Supabase로 전달만 하고 저장·로그·응답에 쓰지 않는다. JWT는 만들지 않는다.
// 응답에는 refresh_token을 넣지 않는다(만료되면 다시 로그인).
export function createAuthApi({ newAnonClient, adminClient }) {
  async function login(request, response) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    const input = readBody(request);
    if (!input || typeof input.email !== 'string' || typeof input.password !== 'string'
        || !input.email.trim() || input.email.length > EMAIL_MAX
        || !input.password || input.password.length > PASSWORD_MAX) {
      return send(response, 400, { error: 'INVALID_LOGIN_INPUT' });
    }
    const { data, error } = await newAnonClient().auth.signInWithPassword({
      email: input.email.trim(), password: input.password,
    });
    if (error || !data?.session) {
      const status = error?.status === 429 ? 429 : (error?.status >= 500 ? 502 : 401);
      return send(response, status, { error: 'LOGIN_FAILED', message: error?.message ?? 'Login failed' });
    }
    const { access_token: accessToken, expires_at: expiresAt } = data.session;
    return send(response, 200, { access_token: accessToken, expires_at: expiresAt,
      email: data.user?.email ?? null });
  }

  async function logout(request, response) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    const match = BEARER.exec(request.headers?.authorization ?? '');
    if (!match) return send(response, 401, { error: 'UNAUTHENTICATED' });
    // 이 로그인 세션만 끊는다. 이미 만료·무효인 토큰이면 오류가 나도 로그아웃은 성공으로 본다.
    const { error } = await adminClient().auth.admin.signOut(match[1], 'local');
    return send(response, 200, { ok: true, revoked: !error });
  }

  const guard = handler => async (request, response) => {
    try {
      return await handler(request, response);
    } catch {
      return send(response, 502, { error: 'AUTH_UNAVAILABLE' });
    }
  };
  return { login: guard(login), logout: guard(logout) };
}

let cached;
export function authApiFromEnvironment(env = process.env) {
  if (cached) return cached;
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  cached = createAuthApi({
    // 요청마다 새로 만들어, 한 요청의 로그인 상태가 다른 요청에 남지 않게 한다.
    newAnonClient: () => createClient(url, SUPABASE_PUBLISHABLE_KEY, options),
    adminClient: () => createClient(url, key, options),
  });
  return cached;
}
