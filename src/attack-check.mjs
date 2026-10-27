// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3].includes(config.step)) {
    throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  }
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  const anonymousGet = (path) => fetch(new URL(path, app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  const readJson = async (response) => {
    if (!response.ok) return null;
    try {
      return await response.json();
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
      return null;
    }
  };

  const response = await anonymousGet('/data.json');
  const data = await readJson(response);
  const visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
    && data.notes.length > 0;
  if (config.step === 1) {
    return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
      observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
  }

  if (config.step === 3) {
    // 3단계: 로그인 없는 요청은 서버가 거부해야 한다. 실제로 보낸 요청의 응답 코드만 기록한다.
    // B가 A의 메모를 고치는 점검은 4단계에서 하므로 여기서는 실행하지 않는다.
    const anonymous = (path, init = {}) => fetch(new URL(path, app), {
      redirect: 'error', signal: AbortSignal.timeout(10000), ...init,
    });
    const jsonHeaders = { 'Content-Type': 'application/json' };
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const list = await anonymous('/api/notes');
    const create = await anonymous('/api/notes', { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ title: 'anonymous', body: 'anonymous' }) });
    const update = await anonymous(`/api/notes/${fakeId}`, { method: 'PUT', headers: jsonHeaders,
      body: JSON.stringify({ title: 'anonymous', body: 'anonymous' }) });
    const remove = await anonymous(`/api/notes/${fakeId}`, { method: 'DELETE' });
    const listBody = await readJson(list);
    const result = (response) => (response.status === 401 ? '거부됨 (HTTP 401)' : `거부되지 않음 (HTTP ${response.status})`);
    return [
      { attackId: 'anonymous_static_data_read', expected: '/data.json에서 가상 메모가 보이지 않아야 함',
        observed: visible ? '비로그인 요청에서 /data.json에 가상 메모가 아직 보임'
          : `비로그인 요청에서 /data.json에 메모가 보이지 않음 (HTTP ${response.status})` },
      { attackId: 'anonymous_list_read', expected: '로그인 없이 목록을 읽을 수 없어야 함',
        observed: `비로그인 GET /api/notes ${result(list)}${Array.isArray(listBody) ? ', 목록이 돌아옴' : ''}` },
      { attackId: 'anonymous_note_create', expected: '로그인 없이 메모를 추가할 수 없어야 함',
        observed: `비로그인 POST /api/notes ${result(create)}` },
      { attackId: 'anonymous_note_update', expected: '로그인 없이 메모를 수정할 수 없어야 함',
        observed: `비로그인 PUT /api/notes/:id ${result(update)}` },
      { attackId: 'anonymous_note_delete', expected: '로그인 없이 메모를 삭제할 수 없어야 함',
        observed: `비로그인 DELETE /api/notes/:id ${result(remove)}` },
    ];
  }

  // 2단계: 옛 공개 파일은 사라져야 하고, 서버 함수는 아직 공개라서 읽힐 수 있다.
  const apiResponse = await anonymousGet('/api/notes');
  const apiData = await readJson(apiResponse);
  const apiCount = Array.isArray(apiData?.notes) ? apiData.notes.length : 0;
  return [
    { attackId: 'anonymous_static_data_read', expected: '/data.json에서 가상 메모가 보이지 않아야 함',
      observed: visible ? '비로그인 요청에서 /data.json에 가상 메모가 아직 보임'
        : `비로그인 요청에서 /data.json에 메모가 보이지 않음 (HTTP ${response.status})` },
    { attackId: 'anonymous_api_notes_read', expected: '3단계 이전이라 /api/notes는 로그인 없이 읽히는 약점이 남아 있음',
      observed: apiCount > 0 ? `비로그인 요청에서 /api/notes가 메모 ${apiCount}건을 돌려줌 (약점 남음)`
        : `비로그인 요청에서 /api/notes가 메모를 돌려주지 않음 (HTTP ${apiResponse.status})` },
  ];
}
