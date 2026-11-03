import { createHash } from 'node:crypto';

// 기기 승인 확인(11단계): 기기 승인 API(src/device-api.mjs)와 메모 API(src/notes-api.mjs)가 함께 쓴다.
// 기기 값은 서버가 만든 무작위 값이며 HttpOnly 쿠키로만 온다. DB 에는 그 SHA-256 과 계정 ID 만 있다.
export const DEVICE_COOKIE = 'vault-device';
export const PENDING_MAX_AGE_MS = 15 * 60 * 1000;
const DEVICE_ID = /^[0-9a-f]{64}$/u;

export const deviceHash = id => createHash('sha256').update(id, 'utf8').digest('hex');

export function readDeviceCookie(request) {
  const header = request.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === DEVICE_COOKIE) {
      const value = rest.join('=');
      return DEVICE_ID.test(value) ? value : null;
    }
  }
  return null;
}

// 이 계정의 이 기기 기록. 쿠키가 없거나 다른 계정의 기기면 기록이 없는 것으로 본다. 조회가 실패하면 던진다.
export async function lookupDevice(supabase, request, user) {
  const id = readDeviceCookie(request);
  if (!id) return { id: null, row: null };
  const { data, error } = await supabase.from('device_approvals').select('id, user_id, status, created_at, approved_at')
    .eq('device_hash', deviceHash(id)).eq('user_id', user.userId).maybeSingle();
  if (error) throw new Error('device_lookup_failed');
  return { id, row: data ?? null };
}

export const statusAt = (row, nowMs) => {
  if (!row) return 'none';
  if (row.status === 'pending' && nowMs - Date.parse(row.created_at) > PENDING_MAX_AGE_MS) return 'expired';
  return row.status;
};

// 메모 API 가 자료를 읽기 전에 부른다. 'approved' 일 때만 통과시키고, 그 밖의 값이나 조회 실패(던짐)는 거부로 다룬다.
export function createDeviceCheck({ supabase, now = () => Date.now() }) {
  return async function deviceCheck(request, user) {
    const { row } = await lookupDevice(supabase, request, user);
    return statusAt(row, now());
  };
}
