import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { canonicalJson, sha256 } from './policy-snapshot.mjs';
import { memoResourceId } from './notes-api.mjs';
import { createLoginVerifier } from './verify-login.mjs';

// 10단계 메모 한 건 복원: POST /api/restore/notes  본문 { "id": "<메모 UUID>" }
// 비공개 백업 표(notes_backup)에서 로그인한 사용자 본인의 메모 한 건만 notes 로 되살린다.
// 다른 메모와 감사 기록은 건드리지 않고, 이미 있는 메모를 덮어쓰지 않는다(없을 때만 넣는다).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ROLE_KEYS = ['role', 'roles', 'isInstructor', 'is_instructor', 'instructor', 'isAdmin', 'is_admin', 'admin', 'owner_id', 'ownerId'];
const hasForbiddenKey = input => Boolean(input) && typeof input === 'object' && ROLE_KEYS.some(key => Object.hasOwn(input, key));

// 시험용 가상 메모(B 소유). 실제 개인 정보가 아니다. 소유자 ID 는 로그인 계정에서 SQL 이 채운다.
export const RESTORE_TEST_MEMO = Object.freeze({
  id: '5b2d7f10-3c4e-4a6b-9d1e-0b5a7c9e1f20',
  title: 'B의 가상 메모 (복원 시험)',
  content: '이것은 10단계 복원 시험용 가상 메모입니다. 실제 개인 정보가 아닙니다.',
});

// 내용 해시: 소유자와 별도로 비교하므로 id·제목·본문만 정렬한 JSON 의 SHA-256 으로 만든다.
export const memoContentHash = ({ id, title, content }) => sha256(canonicalJson({ id, title, content }));

const send = (response, status, payload) => {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(status).json(payload);
};
const readBody = request => {
  const raw = request.body;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};
const defaultLog = entry => console.warn(JSON.stringify(entry));

export function createRestoreApi({ verifier, supabase, log = defaultLog }) {
  const refuse = (response, status, error, reason, resource) => {
    log({ event: 'restore_deny', status, reason, resource });
    return send(response, status, { error });
  };

  return async function handle(request, response) {
    try {
      const input = request.method === 'POST' ? readBody(request) : null;
      const id = typeof input?.id === 'string' && UUID.test(input.id) ? input.id : undefined;
      const resource = memoResourceId(id);
      response.setHeader('X-Resource-Id', resource);
      const user = await verifier(request.headers?.authorization);
      if (!user) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return refuse(response, 401, 'UNAUTHENTICATED', 'no_valid_login', resource);
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return refuse(response, 405, 'METHOD_NOT_ALLOWED', 'method_not_allowed', resource);
      }
      if (hasForbiddenKey(input)) return refuse(response, 403, 'CLAIM_REJECTED', 'role_or_owner_in_body', resource);
      if (!id) return send(response, 400, { error: 'INVALID_ID' });

      // 1. 백업 조회: id 와 소유자를 한 질의에 걸어, 남의 메모와 없는 백업을 똑같이 404 로 거부한다.
      const found = await supabase.from('notes_backup').select('id, owner_id, title, content, content_hash')
        .eq('id', id).eq('owner_id', user.userId).maybeSingle();
      if (found.error) return send(response, 502, { error: 'RESTORE_UNAVAILABLE' });
      const backup = found.data;
      if (!backup) return refuse(response, 404, 'NOT_FOUND', 'no_backup_for_owner', resource);

      // 2. 비교: ID·소유자·내용 해시가 모두 맞아야 한다.
      if (backup.id !== id || backup.owner_id !== user.userId) return refuse(response, 404, 'NOT_FOUND', 'id_or_owner_mismatch', resource);
      if (memoContentHash(backup) !== backup.content_hash) return refuse(response, 409, 'BACKUP_CORRUPT', 'content_hash_mismatch', resource);

      // 3. 덮어쓰지 않는다: 같은 ID 의 메모가 이미 있으면 멈춘다(남의 메모 존재 여부도 소유자 조건으로 가린다).
      const existing = await supabase.from('notes').select('id').eq('id', id).maybeSingle();
      if (existing.error) return send(response, 502, { error: 'RESTORE_UNAVAILABLE' });
      if (existing.data) return refuse(response, 409, 'ALREADY_EXISTS', 'target_exists', resource);

      // 4. 이 한 건만 넣는다.
      const inserted = await supabase.from('notes').insert({ id, owner_id: user.userId, title: backup.title, content: backup.content });
      if (inserted.error?.code === '23505') return refuse(response, 409, 'ALREADY_EXISTS', 'target_exists', resource);
      if (inserted.error) return send(response, 502, { error: 'RESTORE_UNAVAILABLE' });

      // 5. 확인: 다시 읽어 ID·소유자·내용 해시가 백업과 같은지 본다. 다르면 방금 넣은 이 한 건만 지운다.
      const check = await supabase.from('notes').select('id, owner_id, title, content').eq('id', id).eq('owner_id', user.userId).maybeSingle();
      const ok = check.data && check.data.id === id && check.data.owner_id === user.userId && memoContentHash(check.data) === backup.content_hash;
      if (!ok) {
        await supabase.from('notes').delete().eq('id', id).eq('owner_id', user.userId);
        return refuse(response, 502, 'RESTORE_VERIFY_FAILED', 'verify_after_insert_failed', resource);
      }
      log({ event: 'restore', status: 201, resource, contentHash: backup.content_hash.slice(0, 12) });
      return send(response, 201, { id, restored: true, contentHash: backup.content_hash });
    } catch {
      return send(response, 502, { error: 'RESTORE_UNAVAILABLE' });
    }
  };
}

let cached;
export function restoreApiFromEnvironment(env = process.env) {
  if (cached) return cached;
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  cached = createRestoreApi({ verifier: createLoginVerifier({ config, supabaseSecretKey: key }), supabase });
  return cached;
}
