import { createClient } from '@supabase/supabase-js';

// 서버 함수만 서버 전용 키로 자료를 읽습니다. 키는 응답과 로그에 넣지 않습니다.
// 2단계에서는 이 함수 주소가 공개되어 있어 누구나 호출할 수 있습니다(README의 약점 참고).
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  }
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await supabase
      .from('notes')
      .select('title, content')
      .order('created_at', { ascending: true });
    if (error) {
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
    return response.status(200).json({ notes: data });
  } catch {
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
