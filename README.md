# BYTE BACK 방어전 — 내 자료실

방어전 시작 틀 R5에서 만든 학생 본인의 저장소입니다. 자료실의 메모 네 건은 모두 실습용 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요. 코딩 도구에는 [AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청합니다.

## 단계 기록

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 시작 틀로 GitHub 저장소와 Vercel 배포를 만들고, `/data.json`에 메모가 공개된 상태를 확인 | 완료(첫 커밋 `ce0237b`) |
| 2 | 메모를 코드 밖(Supabase 표)으로 옮기고 `api/notes.js`를 통해 읽음. 보안 헤더(`nosniff`) 추가 | 완료·배포 확인(`b823ec1`, `4678663`) |
| 3 | Supabase Auth 이메일·비밀번호 로그인·로그아웃 화면, 로그인한 사용자의 메모 추가·수정·삭제 화면과 서버 API(서버가 토큰 검증), `aleph.config.json`에 `identityProvider`·`allowedRoutes` | 배포 완료(`7b9e987`). 로그인해 추가한 메모가 A의 `owner_id`로 저장된 것은 DB 조회로 확인 |
| 4 | 서버 API의 소유자 검사(검증한 사용자 ID와 `owner_id` 비교)와 Supabase의 GRANT·RLS를 본인 행만 허용하도록 적용 | 완료·배포(`ed3c069`, `7918c83`). DB 정책 네 개를 Supabase에서 실행하고 `pg_policies` 조회로 확인, `anon` 키 직접 요청 거부 확인. 배포 서버에서 A·B 토큰으로 직접 확인한 점검은 **미실행** |
| 5 | 자료 요청을 서버 한곳으로 모음: 브라우저의 직접 자료 호출 점검(없음), 학습 DB의 PUBLIC·anon·authenticated 직접 권한 회수, `originalApiUrl` 기입. 가점: 로그인·로그아웃도 서버 함수(`/api/login`, `/api/logout`)로 옮겨 화면 코드에서 공개 키 제거 | 구현·DB 적용 확인. 권한 조회에서 `anon`·`authenticated`는 모두 `false`, `service_role`은 `true`. 서버 로그인 코드는 실제 Supabase에 틀린 계정으로 실행해 연결을 확인했고, 로그인 성공 흐름은 배포 뒤 사람이 확인 |

## 현재 기능

- `/`: 로그인하면 내 가상 메모 목록을 보여 주고, 메모를 추가·수정·삭제할 수 있습니다. 로그인하지 않으면 안내 문구만 보입니다.
- 로그인: 화면의 로그인 칸은 `/api/login`, 로그아웃 버튼은 `/api/logout`을 부릅니다. 서버 함수(`api/login.js`, `api/logout.js`, 로직은 `src/auth-api.mjs`)가 Supabase 공식 SDK(`signInWithPassword`, `admin.signOut`)로 대신 처리하므로 화면 코드(`public/index.html`)에는 Supabase 주소도 공개 키도 없습니다. 비밀번호는 Supabase로 전달만 하고 저장·로그·응답에 쓰지 않으며 JWT는 직접 만들지 않습니다. 성공하면 `{access_token, expires_at, email}`만 돌려주고(`refresh_token`은 주지 않음), 화면은 이 탭의 `sessionStorage`에 보관합니다. 실패하면 Supabase가 준 이유를 화면에 보여 줍니다. 로그인하면 계정 이메일과 로그아웃 버튼이, 로그아웃하면 입력 폼이 보입니다. 공개 키(publishable)는 비밀은 아니지만 브라우저가 받는 `public/` 밖의 서버 전용 파일(`src/supabase-public.mjs`)에서만 씁니다.
- 서버 API(`api/notes.js`, `api/notes/[id].js`, 로직은 `src/notes-api.mjs`): 모든 요청에서 `Authorization: Bearer` 토큰을 `src/verify-login.mjs`로 검증하고, 서버가 확인한 사용자 ID로 로그인 여부를 판단합니다. 실패하면 `401`입니다. 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`는 서버에서만 읽고 응답·로그에 쓰지 않습니다.
  - `GET /api/notes`: 로그인 사용자의 메모 배열 `[{id,title,body}]`
  - `POST /api/notes`: `{id?,title,body}` 추가. `id`는 UUID이고 없으면 서버가 만들어 `{id}`로 돌려줍니다(`201`). 서버가 확인한 사용자 ID를 `owner_id`로 저장합니다.
  - `GET·PUT·DELETE /api/notes/:id`: 한 건 조회 `{id,title,body}`·수정(본문 `{title,body}`)·삭제. 지운 뒤 GET은 `404`입니다.
  - 소유자 검사: 한 건 읽기·수정·삭제는 `id`와 `owner_id = 검증된 사용자 ID`를 한 질의에 함께 걸어, 남의 메모는 없는 메모와 똑같이 `404`로 거부합니다. 추가는 본문의 `owner_id`를 쓰지 않고 항상 검증된 사용자 ID로 저장합니다. 수정 본문에 내 ID가 아닌 `owner_id`가 있으면 `403`으로 거부하고 소유자는 바뀌지 않습니다.
  - `aleph.config.json`의 `identityProvider`(Supabase 발급자·대상·공개키 주소)와 `allowedRoutes`(위 다섯 경로)에 같은 내용을 적었습니다.
- `supabase/notes.sql`: 표 생성(`owner_id uuid`, `auth.users` 외래키 없음), RLS 켜기, `anon`·`authenticated` 권한 회수, 가상 메모 네 건 입력, 확인용 조회. 메모 문장이 들어 있어 `.gitignore`로 Git에서 뺐습니다. 이 컴퓨터에만 있습니다.
- DB 권한(`supabase/notes-permissions.sql`, 로컬 기록): `notes`에 RLS를 켜고 `anon`·`authenticated`·`public`의 권한을 모두 회수한 뒤 `authenticated`에만 SELECT·INSERT·UPDATE·DELETE를 부여합니다. 정책은 네 개이고 모두 `auth.uid() = owner_id`일 때만 허용합니다(SELECT·DELETE는 기존 행, INSERT는 새 행, UPDATE는 기존 행과 새 행 모두). 5단계에서 이 직접 권한은 다시 회수했고 정책만 남아 있습니다.
- 직접 권한 회수(`supabase/notes-revoke-direct.sql`, 로컬 기록): `public.notes`의 `PUBLIC`·`anon`·`authenticated` 권한을 모두 회수했습니다. 이제 `notes`는 서버 함수(서버 전용 키, `service_role`)만 읽고 씁니다. 화면 코드는 Supabase를 직접 부르지 않고 로그인은 `/api/login`, 자료는 `/api/notes`로만 요청합니다(직접 자료 호출은 점검 결과 없음). `aleph.config.json`의 `originalApiUrl`은 쿼리 없는 원본 경로 `https://meupslbrbesjtyuwpske.supabase.co/rest/v1/notes`이며, 이 경로를 `anon` 키로 직접 부르면 `permission denied`(HTTP 401)입니다.
- `vercel.json`의 `headers`로 모든 응답에 `X-Content-Type-Options: nosniff`를 붙입니다. 확인: `curl -sI https://choi-bujang-secret-vault-hailey17.vercel.app/ | grep -i x-content-type-options`
- 공개 `/data.json`과 저장소의 `data.json`은 없앴습니다. 빌드(`npm run build`)는 `public/aleph.json`(저장소·커밋·배포 주소)만 만듭니다.

## 다시 실행하는 방법

1. Supabase 학습용 프로젝트의 **SQL Editor**에 `supabase/notes.sql` 내용을 붙여 넣고 Run합니다. 마지막 확인 조회에서 `owner_id`가 보이고, 제약에 `FOREIGN KEY`가 없고, `rowsecurity`가 `true`이고, `anon`·`authenticated` 권한 조회가 0행이어야 합니다.
   - 5단계: 이어서 `supabase/notes-revoke-direct.sql`을 실행합니다. 적용 전후에 `has_table_privilege`로 확인해 `anon`·`authenticated`가 네 칸 모두 `false`, `service_role`이 모두 `true`가 되어야 합니다. 그 뒤 A로 로그인해 읽기·추가·수정·삭제를 다시 해 봅니다. 문제가 생기면 `grant select, insert, update, delete on table public.notes to authenticated;`로 되돌립니다.
2. Vercel 프로젝트 **Settings → Environment Variables**에 `SUPABASE_URL`과 `SUPABASE_SECRET_KEY`를 직접 넣습니다. 값은 채팅·코드·Git에 적지 않습니다. 서버 전용 키(secret)이며, 공개용 키(anon/publishable)와 구분하세요.
3. 이 저장소를 GitHub에 push하면 Vercel이 다시 배포합니다.
4. 시크릿 창에서 배포 주소 `/data.json`이 404인지 확인합니다. `/api/notes`는 로그인 없이 부르면 `401`이어야 합니다.
5. 로그인 확인: Supabase 대시보드 Authentication → Users에서 시험 계정을 만들고(Auto Confirm 체크), 시크릿 창에서 `/`를 열어 로그인합니다. 틀린 비밀번호는 실패 이유가 보여야 하고, 맞으면 계정 이메일·로그아웃 버튼·메모 추가 칸이 보이며, 로그아웃하면 입력 폼으로 돌아와야 합니다. 로그인한 상태에서 메모를 추가·수정·삭제해 봅니다.
6. 제출 묶음은 `bundle-notes.json`(Git 제외)을 만든 뒤 `npm run bundle`로 만듭니다. 이 명령은 Node 22 이상이 필요하고, 변경을 모두 커밋한 상태에서만 실행됩니다.

## 남은 약점

- **서버 API는 RLS를 건너뜁니다.** 서버 함수는 서버 전용 키로 읽으므로 DB 정책이 아니라 `src/notes-api.mjs`의 소유자 비교가 실제 방어선입니다. 이 키가 새면 표 전체가 열리므로 키는 Vercel 환경변수에만 둡니다.
- **직접 Data API 점검 범위**: `anon` 키로 `/rest/v1/notes`를 읽고 지우는 요청은 `permission denied`(HTTP 401)로 거부되는 것을 직접 요청해 확인했습니다. `authenticated` 역할도 5단계에서 직접 권한을 회수해 `has_table_privilege`로 `false`를 확인했지만, 로그인 토큰으로 직접 요청해 보지는 않았습니다. 심판은 `anon` 키로만 확인합니다.
- **로그인 토큰 보관**: 로그인 토큰은 이 탭의 `sessionStorage`에 둡니다. 이 화면은 문자열을 `textContent`로만 그려 스크립트 주입을 막지만, 같은 출처에서 스크립트가 실행되면 토큰을 읽을 수 있습니다(httpOnly 쿠키보다 약함). `refresh_token`을 주지 않으므로 토큰이 만료되면(Supabase 기본 약 1시간) 다시 로그인해야 합니다. 로그인 시도 횟수 제한은 Supabase의 기본 제한에 맡기며 서버 함수에는 따로 두지 않았습니다.
- **미실행 점검**: 배포 서버에서 B의 토큰으로 A의 메모를 읽고·고치고·지우는 요청은 로그인 토큰이 필요해 실행하지 않았습니다. 로컬 시험(가짜 표)으로만 확인했습니다. 화면에서 A·B가 각자 자기 메모만 보는지는 사람이 직접 확인합니다.
- 시험 한계: `npm run test:notes` 같은 로컬 시험은 가짜 표로 돌린 것입니다. 실제 Supabase와 A·B의 로그인 토큰으로 확인한 결과가 아닙니다. 배포 후 A·B로 직접 확인해야 합니다.
- **옛 공개 노출은 해소되지 않았습니다.** 첫 커밋 `ce0237b`에는 `data.json`과 `public/data.json`이 그대로 있고, 옛 배포 주소와 옛 미리보기 배포에도 메모가 남아 있을 수 있습니다. 그 기록이 남는 한 과거 노출이 해소됐다고 말할 수 없습니다.

## 가상 메모가 새 파일에 없는지 확인하는 절차

각각의 결과를 따로 기록합니다. 검색 패턴은 가상 메모 본문 네 건의 문장만 잡도록 만들었습니다. 이 README 자체는 그 문장을 적지 않아 검색에 걸리지 않습니다.

| 확인 | 명령 | 기대 결과 |
|---|---|---|
| 현재 배포의 옛 공개 파일 | `curl -s -o /dev/null -w "%{http_code}" https://choi-bujang-secret-vault-hailey17.vercel.app/data.json` | `404` |
| 현재 배포의 화면 파일 | `curl -s https://choi-bujang-secret-vault-hailey17.vercel.app/ \| grep -cE "실습용 가상 (과제|포트폴리오|리추얼|행정) 기록"` | `0` (메모는 화면 로드 뒤에 api에서 받아 옵니다) |
| GitHub 최신 파일 | `git grep -nE "실습용 가상 (과제|포트폴리오|리추얼|행정) 기록" origin/main` | 출력 없음 |
| GitHub 최신 파일(원격 직접) | `curl -s https://raw.githubusercontent.com/ddho0216/choi-bujang-secret-vault/main/public/index.html \| grep -cE "실습용 가상 (과제|포트폴리오|리추얼|행정) 기록"` | `0` |
| 옛 커밋 | `git grep -nE "실습용 가상 (과제|포트폴리오|리추얼|행정) 기록" ce0237b` | 출력이 **나옵니다**. 옛 기록이므로 정상이며 약점으로 남깁니다 |
| 로그인 없는 API | `curl -s -o /dev/null -w "%{http_code}" https://choi-bujang-secret-vault-hailey17.vercel.app/api/notes` | `401`. 메모가 나오면 안 됩니다 |

`supabase/notes.sql`은 Git에서 빼 두었으므로 위 검색에 걸리지 않습니다. 이 파일을 커밋하면 GitHub 최신 파일에 메모 문장이 생기니, 커밋하지 마세요.

## 시작 틀 메모

`vercel.json`은 `public`을 배포하고 `npm run build`로 `public/aleph.json`을 만듭니다. `aleph.json`은 Vercel이 주는 저장소 소유자·이름, 커밋, 배포 주소를 담을 뿐이며, 이것만으로 저장소 소유나 방어 성공이 인정되지는 않습니다. `npm run build -- --local`은 이 파일을 만들지 않으므로 배포나 심판 접수를 증명하지 않습니다. `src/attack-check.mjs`는 `npm run bundle`이 실행하는 직접 점검이며 심판의 판정이 아닙니다. `src/decider.mjs`·`src/detect.mjs`의 로컬 시험도 반 엔진의 결과가 아닙니다.

## 보너스 xdr-01: 무차별 로그인 공격

Wazuh 모양의 시험 경보(`xdr/fixtures/brute-force.json`, 28건)에서 같은 주소의 로그인 실패가 몰린 공격을 가려냅니다. 정답 파일은 저장소에 없고, 경보는 수업용 가상 자료입니다.

- `xdr/brute-force/read-alerts.mjs`: 시각·출발 주소·계정·규칙 수준·설명만 뽑는 확인용 모듈. 비밀값처럼 보이는 값은 `[가림]`으로 바꿔 출력하고 원본 경보는 고치지 않습니다. `decide.mjs`는 이 파일을 불러오지 않습니다.
- `xdr/brute-force/patterns.json`: 패턴 다섯 개와 근거. MITRE ATT&CK T1110의 하위 기법(T1110.001 비밀번호 추측, T1110.003 스프레이)에 근거한 것만 넣었습니다.
- `xdr/brute-force/decide.mjs`: `decide(alert)` 하나를 내보냅니다. `import` 없이 패턴을 파일 맨 위 상수로 옮겨 적었고, 파일 읽기·쓰기·네트워크 없이 파일 안에서만 계산합니다. 확신도가 0.85 이상이면 `block`, 0.5 이상이면 `alert`, 그 아래는 `record`입니다. 경보의 `data.count`가 문자열(`"48"`)로 오는 것을 숫자로 읽습니다.
- `xdr/brute-force/respond.mjs`: `block`이면 거부 규칙을 `xdr/brute-force/deny-rules.json`에 적고, `block`·`alert`를 `xdr/alerts.log`에 한 줄씩 쌓습니다(같은 경보는 다시 쌓지 않음). 규칙에는 근거 경보 번호와 만료 시각(근거 경보 중 가장 늦은 시각 + 60분)이 있습니다. 같은 주소에 정상 경보가 있거나, 사설·루프백 주소이거나, 주소 형식이 이상하면 규칙을 만들지 않고 알림만 남깁니다. 알림·차단 로직은 `xdr/respond-core.mjs`를 xdr-02와 같이 씁니다.

결과(시험 경보 28건): `block` 10건, `alert` 9건, `record` 9건. 정상으로 본 9건(T1110 표시 없음, 규칙 수준 3 이하)은 모두 `record`입니다.

다시 실행하기:

```
npm run xdr:run -- brute-force
node xdr/brute-force/respond.mjs
npm run test:xdr
```

### 한계

- **ZTNA 판정기에 연결되지 않았습니다.** `src/decider.mjs`는 시작 틀이라 규칙 파일을 읽지 않고 모든 요청을 거부하며, 판정 요청(`docs/DECIDER_REQUEST.md`)에는 출발 주소가 없어 주소 기준 규칙을 맞출 수 없습니다. `deny-rules.json`은 넣을 규칙을 적어 둔 기록이고 `connectedToDecider: false`로 표시했습니다. 판정기의 기존 규칙은 고치지 않았습니다.
- 정상과 애매한 경보를 가른 기준은 경보의 모양(규칙 수준, T1110 표시, 건수, 설명)입니다. 정답은 저장소에 없으므로 심판의 구분과 다를 수 있습니다.
- 설명 문장의 단어(`여러 계정`, `잠금` 등)를 찾는 패턴은 문장이 바뀌면 맞지 않습니다.
- `npm run test:xdr`은 로컬 시험이며 심판의 판정이 아닙니다.

## 보너스 xdr-02: 웹 주입 공격

웹 접근 경보(`xdr/fixtures/web-injection.json`, 26건)에서 SQL 구문·스크립트 태그·경로 거슬러 올라가기(`../`) 형태의 주입이 같은 주소에서 반복되는 것을 가려냅니다. 정답 파일은 저장소에 없고, 경보는 수업용 가상 자료입니다.

- `xdr/web-injection/read-alerts.mjs`: 시각·출발 주소·계정·규칙 수준·설명만 뽑는 확인용 모듈(비밀값처럼 보이는 값은 `[가림]`). `decide.mjs`는 불러오지 않습니다.
- `xdr/web-injection/patterns.json`: 패턴 여섯 개와 근거. MITRE ATT&CK T1190(공개된 응용 프로그램 악용)에 근거한 것만 넣었습니다.
- `xdr/web-injection/decide.mjs`: `decide(alert)` 하나를 내보냅니다. `import` 없이 패턴을 파일 맨 위 상수로 옮겨 적었고, 파일·네트워크 없이 파일 안에서만 계산합니다. 확신도 0.85 이상이면 `block`, 0.5 이상이면 `alert`, 그 아래는 `record`입니다. `data.count`(문자열)를 숫자로 읽고, 요청 주소는 퍼센트 인코딩을 두 번까지 풀어서 봅니다.
- `xdr/web-injection/respond.mjs`: `block`이면 거부 규칙을 `xdr/web-injection/deny-rules.json`에 적고, `block`·`alert`를 `xdr/alerts.log`에 쌓습니다. 안전장치(정상 경보가 있는 주소, 사설·루프백 주소, 이상한 주소는 차단 보류)는 `xdr/respond-core.mjs`에 있습니다.

결과(시험 경보 26건): `block` 8건, `alert` 9건, `record` 9건. 정상으로 본 9건(T1190 표시 없음, 규칙 수준 3 이하)은 모두 `record`이고, 애매한 시도 9건(T1190, 수준 5~8, 1번)은 모두 `alert`입니다.

다시 실행하기:

```
npm run xdr:run -- web-injection
node xdr/web-injection/respond.mjs
npm run test:xdr
```

### 한계

- **ZTNA 판정기에 연결되지 않았습니다.** xdr-01과 같은 이유입니다. `src/decider.mjs`는 시작 틀이고 판정 요청에 출발 주소·주소(URL)가 없습니다. `deny-rules.json`은 `connectedToDecider: false`인 기록입니다.
- 이 경보 묶음의 요청 주소(`data.url`)는 `doc-sql-chain` 같은 문서용 표기라서, 실제 판단은 설명 문장과 반복 횟수(8번 이상이면 반복)로 했습니다. 주소에 실제 주입 형태가 있을 때를 대비한 `payload_in_url_repeat`는 시험 문자열로만 확인했고 이 경보 26건에는 해당이 없습니다.
- 정상과 애매한 경보를 가른 기준은 경보의 모양입니다. 정답은 저장소에 없으므로 심판의 구분과 다를 수 있습니다. 설명 문장의 단어(`SQL`, `스크립트`, `경로`)를 찾는 패턴은 문장이 바뀌면 맞지 않습니다.
- `npm run test:xdr`은 로컬 시험이며 심판의 판정이 아닙니다.
