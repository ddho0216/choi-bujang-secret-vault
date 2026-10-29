import { authApiFromEnvironment } from '../src/auth-api.mjs';

// POST /api/login {email,password} -> {access_token, expires_at, email}
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  let api;
  try {
    api = authApiFromEnvironment();
  } catch {
    return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  }
  if (!api) return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  return api.login(request, response);
}
