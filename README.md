# BYTE BACK 방어전 — 내 자료실

방어전 시작 틀 R5에서 만든 학생 본인의 저장소입니다. 자료실의 메모 네 건은 모두 실습용 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요. 코딩 도구에는 [AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청합니다.

## 단계 기록

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 시작 틀로 GitHub 저장소와 Vercel 배포를 만들고, `/data.json`에 메모가 공개된 상태를 확인 | 완료(첫 커밋 `ce0237b`) |
| 2 | 메모를 코드 밖(Supabase 표)으로 옮기고 `api/notes.js`를 통해 읽음. 보안 헤더(`nosniff`) 추가 | 완료·배포 확인(`b823ec1`, `4678663`) |
| 3 | Supabase Auth 이메일·비밀번호 로그인·로그아웃 화면, 로그인한 사용자의 메모 추가·수정·삭제 화면과 서버 API(서버가 토큰 검증), `aleph.config.json`에 `identityProvider`·`allowedRoutes` | 배포 완료(`7b9e987`). 로그인해 추가한 메모가 A의 `owner_id`로 저장된 것은 DB 조회로 확인 |
| 4 | 서버 API의 소유자 검사(검증한 사용자 ID와 `owner_id` 비교)와 Supabase의 GRANT·RLS를 본인 행만 허용하도록 적용 | 완료·배포(`ed3c069`, `7918c83`). DB 정책 네 개를 Supabase에서 실행하고 `pg_policies` 조회로 확인, `anon` 키 직접 요청 거부 확인. 배포 서버에서 A·B 토큰으로 직접 확인한 점검은 **미실행** |
| 5 | 자료 요청을 서버 한곳으로 모음: 브라우저의 직접 자료 호출 점검(없음), 학습 DB의 PUBLIC·anon·authenticated 직접 권한 회수, `originalApiUrl` 기입. 가점: 로그인·로그아웃도 서버 함수(`/api/login`, `/api/logout`)로 옮겨 화면 코드에서 공개 키 제거 | 구현·DB 적용 확인. 권한 조회에서 `anon`·`authenticated`는 모두 `false`, `service_role`은 `true`. 서버 로그인 코드는 실제 Supabase에 틀린 계정으로 실행해 연결을 확인했고, 배포 뒤 로그인과 메모 추가·수정·삭제 동작은 사용자가 직접 확인했다고 알려 줌(캡처는 받지 못함) |
| 6 | 판정기 `src/decider.mjs`에 기기 등록 규칙 `device_registered` 추가: `deviceRegistered`가 `true`인 기기만 허용하고, 아니면 `deny`와 이유 코드 `device_not_registered`로 거부 | 구현. `npm run decider:test` 통과(가상 요청 연습이며 심판 통과 증거가 아님). 미등록 기기 공격은 심판이 확인 |
| 7 | 판정기에 규칙 `step_up_required` 추가: 평소와 다른 시각·처음 보는 네트워크·갑자기 몰린 사건이 함께 있으면 `step_up`(추가 확인), 다시 확인한 요청은 `allow`. 접속 정보는 엔진이 붙인 출처만 믿는 입력 검사 추가 | 구현. `npm run decider:test`(4항목)·`npm run fixture:7`·`npm run test:decider` 통과(가상 사건 연습이며 심판 통과 증거가 아님). **실제 재로그인 확인과 자료 차단은 미실행** |
| 8 | 자원 구역(메모·반 공지·강사 자료)과 자원 ID. 판정기에 규칙 `resource_zone` 추가(메모는 자료 ID 하나를 고르는 경로만, 반 공지는 읽기만, 강사 자료와 알 수 없는 경로는 거부). 자료 API는 본문의 `role`을 믿지 않고 거부 사유를 기록하며, 다른 구역은 JSON으로 거부 | 구현. `npm run decider:test`·`npm run test:decider`·`npm run test:notes` 통과(가상 요청·가짜 표 기준이며 심판 통과 증거가 아님). 이 자료실에는 메모만 있어 공지·강사 자료는 데이터 없이 구역만 정의함. 로그인한 사용자의 다른 구역 직접 요청은 **미실행** |
| 9 | 탐지 함수 `src/detect.mjs`: 사건에서 `at`·`method`·`identity.sub` 세 값만 읽고, 규칙 `burst_read`(같은 사용자의 `GET`이 어느 10분 구간에서든 120건 초과)이면 `propose_revocation`, 아니면 `observe` | 구현. `npm run detect:test` 6항목·`npm run test:detect` 통과(가상 사건 연습이며 심판 통과 증거가 아님). **운영 반 엔진의 사건 전달과 실제 접속 회수는 연결하지 않음(미실행)** |
| 10 | 안전 정책 사본(`policy/safe-policy.json`)+해시, 규칙 한 줄을 바꾼 시험 정책(침공 흉내)과 검증한 버전으로의 복원 절차, 메모 한 건 복원 API `POST /api/restore/notes` | 구현. `npm run test:policy`·`npm run test:restore` 통과(가상 요청·가짜 표 기준이며 심판 통과 증거가 아님). 배포된 복원 API를 B 로그인으로 호출한 결과는 사용자가 직접 실행해 알려 줌(복원 응답 `restored: true`, 다시 요청 `409`, B가 읽기 `200`; 캡처는 받지 못함). A로 B의 백업 복원을 요청한 결과도 사용자가 직접 실행해 `404 NOT_FOUND`를 알려 줌(캡처는 받지 못함) |
| 11 | 설치형 웹앱(manifest·아이콘·오프라인 안내 서비스 워커)과 기기 승인: 서버가 이 기기를 승인된 기기로 확인한 뒤에만 화면이 메모를 불러옴. 승인은 같은 계정의 비밀번호를 서버가 다시 확인해야 함 | 구현. `npm run test:device`(가짜 표 13항목) 통과(심판 통과 증거가 아님). 배포 후 실제 승인은 사용자가 직접 해 보고 "승인되고 메모 추가 칸과 메모 목록이 보인다"고 알려 줌(캡처는 받지 못함). **앱 설치·오프라인 화면, 새 브라우저에서 다시 승인이 필요한지는 미실행** |
| 12 | 탈환 작전실 화면(`/ops.html`)과 요약(`GET /api/device?view=ops`): 판정기 규칙·탐지 규칙·복구 버전·내 건수를 서버가 직접 확인한 값(실측)으로, 탐지 사건·회수 상태는 연결하지 않은 것(미실행)으로 구분해 표시. 정상·금지 요청을 한 표로 만드는 절차(`npm run ops:table`)와 설치·실행·중지·복구·출처 안내 | 구현. `npm run test:ops` 통과(가짜 표·가짜 서버 기준이며 심판 통과 증거가 아님). **심판의 41종 공격 방어 시험은 실행하지 않음(미실행)**. 로그인한 작전실 화면은 사용자가 직접 열어 확인하고 스크린샷을 보내 줌(실측 6개·미실행 2개 구분, 화면과 서버 응답 일치, 메모 건수는 DB 조회와 일치) |

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
- 판정기(`src/decider.mjs`): 규칙 세 개. `device_registered`는 요청의 `deviceRegistered`가 `true`인 기기만 통과시키고 아니면 `deny`·`device_not_registered`입니다. `resource_zone`은 허용 목록에 없는 구역·경로·메서드를 `deny`·`resource_not_allowed`로 거부합니다(8단계 절). `step_up_required`는 복합 이상 사건을 `step_up`으로 보냅니다(7단계 절). 요청 이름은 `docs/DECIDER_REQUEST.md`의 것만 읽고 역할·`identity`·`device` 같은 필드는 읽지 않습니다.
- 탐지(`src/detect.mjs`): `detect(events)`가 가상 조회 사건에서 폭주를 찾아 `{ action: 'propose_revocation', reasonCode: 'burst_read', subject }` 또는 `{ action: 'observe' }`만 돌려줍니다(9단계 절). 접속을 실제로 회수하지는 않습니다.
- 안전 정책·복원(`src/policy-snapshot.mjs`, `src/policy-files.mjs`, `scripts/policy.mjs`, `src/restore-api.mjs`): 10단계 절을 보세요.
- 설치형 웹앱·기기 승인(`public/manifest.webmanifest`, `public/sw.js`, `public/offline.html`, `src/device-api.mjs`, `api/device.js`): 11단계 절을 보세요.
- 탈환 작전실(`public/ops.html`, `src/ops-api.mjs`, `scripts/ops-table.mjs`): 12단계 절을 보세요.

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

## 6단계: 등록한 기기만

판정기가 요청의 `deviceRegistered`만 보고 등록하지 않은 기기를 거부합니다. 브라우저 화면과 자료실 주소는 바꾸지 않았고, 새 키·인증서 파일도 만들지 않았습니다.

확인 순서:

1. 저장소를 새로 받았다면 `npm install`을 합니다.
2. `npm run decider:test`를 실행합니다.
3. 아래 두 줄이 `통과`로 나와야 합니다. 첫째는 등록 기기의 정상 요청이 `allow`, 둘째는 `deviceRegistered: false`인 가상 요청이 `deny`와 `device_not_registered`로 나오는 것입니다.

```
통과 · 등록 기기의 정상 요청
통과 · 미등록 기기의 가상 요청
이 명령은 가상 요청으로 연습하며 심판 통과 증거가 아닙니다.
```

한계:

- `decider:test`는 가상 요청 연습이며 심판의 판정이 아닙니다. 미등록 기기 공격은 심판이 확인합니다.
- 허용 응답의 이유 코드 `approved`는 `docs/DECIDER_REQUEST.md`의 응답 예시에서 가져왔습니다. 운영 등록부의 허용 코드 목록은 이 저장소에서 확인하지 못했습니다.
- 실제 릴레이는 미등록 기기를 판정기보다 먼저 막습니다. 이 규칙은 그 앞단 검사를 되돌리지 못하고, `deviceRegistered` 값 자체는 엔진이 정한 값을 믿을 뿐 판정기가 따로 검증하지 않습니다.

## 7단계: 평소와 다른 접속은 다시 확인합니다

판정기가 복합 이상 사건을 막지 않고 **추가 본인 확인(`step_up`)** 으로 보냅니다. 브라우저 화면과 자료실 주소는 바꾸지 않았습니다.

**입력 검사(`readSignals`)**: 접속 정보(`request.signals`)는 엔진이 심판의 가상 사건에 붙이는 출처 `judge_fixture`일 때만 믿습니다. 실제 경로의 `none`이나 알 수 없는 출처는 근거로 쓰지 않습니다. 지역·시각·네트워크가 없거나 모양이 다르면 `null`로 두고 정상값으로 채우지 않습니다. 브라우저가 보낸 헤더·위치(`request.headers`, `geo`, `clientIp` 등)는 읽지 않으므로, 위조한 값이 믿는 접속 정보로 승격되지 않습니다(시험으로 확인).

**규칙 `step_up_required`**: 아래 세 가지가 **모두** 맞을 때만 `step_up`(이유 코드 `step_up_required`)입니다.

| 조건 | 기준(수업용 가정) |
|---|---|
| 평소와 다른 시각 | 엔진이 준 `signals.hour`가 23시~5시 |
| 처음 보는 네트워크 | `signals.network`가 `unusual`(`unknown`은 근거가 아님) |
| 갑자기 몰린 사건 | `recentEvents` 가운데 최근 5분(`ageSeconds` 300 이하)의 `count` 합이 10 이상 |

- 지역(`signals.region`)은 판정에 쓰지 않습니다. 지역 하나만으로 막지 않기 위해서입니다. `deny`나 영구 차단은 하지 않고, 사유는 이유 코드와 규칙 이름(`step_up_required`)으로 남습니다.
- 다시 확인한 요청은 `allow`입니다. 계약에 맞는 모양(`stepUp.verified`가 `true`이고 `authAgeSeconds`가 0~900 사이 정수)일 때만 믿고, 모양이 틀린 확인은 믿지 않습니다.
- 기기 규칙이 먼저입니다. 등록하지 않은 기기는 복합 이상 여부와 상관없이 `deny`·`device_not_registered`입니다.
- 시각·네트워크·사건 기준은 실제 사용자의 평소 기록이 아니라 수업용 가정값입니다.

**다시 로그인 계약 확인 결과**

- 있는 것: 요청의 `stepUp {verified, authAgeSeconds}`(`docs/DECIDER_REQUEST.md`)와, `step_up` 결정이 엔진에 추가 본인 확인을 요청한다는 설명입니다.
- 없는 것: 엔진이 **같은 내 로그인으로 다시 로그인한 시각**을 검증해 준다는 문서는 이 저장소에 없습니다. `authAgeSeconds`는 나이(초)일 뿐 같은 계정의 새 로그인이라는 설명이 없습니다. 이 자료실의 서버 함수도 판정기를 호출하지 않습니다.
- 그래서 **가상 사건 규칙만 시험했고, 실제 자료 차단과 새 로그인 뒤 재판정은 미실행**입니다. 토큰 원문은 어디에도 기록하지 않았습니다.

확인 순서:

1. `npm run decider:test`: 네 줄이 모두 `통과`여야 합니다(등록 기기의 정상 요청, 미등록 기기의 가상 요청, 복합 이상 접속, 다시 확인한 복합 이상 접속).
2. `npm run fixture:7`: `정상 사건: allow`, `복합 이상 사건: step_up`이 나와야 합니다.
3. `npm run test:decider`: 입력 검사, 세 조건의 경계값, 모양이 틀린 입력을 확인하는 시험이 모두 통과해야 합니다.

한계:

- 위 시험은 가상 사건 연습이며 심판의 판정이 아닙니다.
- 실제 경로에서는 `signals.source`가 `none`이고 지역·네트워크가 `unknown`이라, 이 규칙은 심판의 가상 사건에서만 동작합니다. 실제 위치·네트워크를 가려내는 기능이 아닙니다.
- `step_up` 뒤에 재인증 화면으로 보내고 새 요청에 `stepUp`을 채우는 일은 엔진의 몫이며 이 저장소에서 확인하지 못했습니다.
- 허용 응답의 이유 코드 `approved`와 `step_up_required`는 계약 문서·시험 코드에서 가져왔고, 운영 등록부의 허용 코드 목록은 확인하지 못했습니다.

## 8단계: 자료마다 갈 수 있는 구역을 나눕니다

**이 자료실에 실제로 있는 자료는 메모뿐입니다.** 반 공지와 강사 자료는 데이터가 없고, 강사 권한을 저장한 곳도 없습니다(아무도 강사가 아닙니다). 그래서 구역·자원 ID·거부 동작만 구현했고, 없는 자료를 만들지 않았습니다. 브라우저 화면과 자료실 주소는 바꾸지 않았습니다.

**구역과 자원 ID** (`src/decider.mjs`의 `RESOURCE_ZONES`, `resourceFor`. 판정기와 서버 API가 같은 정의를 씁니다)

| 구역 | 서비스 | 경로 | 자원 ID |
|---|---|---|---|
| 메모 | `notes` | `/notes`, `/notes/:id` | `memo:*`, `memo:<id>` |
| 반 공지 | `notices` | `/notices`, `/notices/:id` | `class_notice:*`, `class_notice:<id>` |
| 강사 자료 | `instructor` | `/instructor` 이하 | `instructor_material:*`, `instructor_material:<id>` |

같은 `<id>`여도 구역이 다르면 자원 ID가 다릅니다. 서버 API는 모든 응답에 `X-Resource-Id`로 자원 ID를 붙입니다(로그인하지 않은 요청과 거부된 요청도). 맨 앞의 `/api`는 떼고 해석합니다.

**판정기 규칙 `resource_zone`** (허용 목록에 없는 요청은 모두 `deny`·`resource_not_allowed`)

| 구역 | 허용 | 거부 |
|---|---|---|
| 메모 | `GET·PUT·DELETE /notes/:id` (자료 ID 하나를 고르는 경로) | `/notes` 전체 목록·추가, 그 밖의 메서드·깊이 |
| 반 공지 | `GET /notices`, `GET /notices/:id` | 쓰기(`POST·PUT·PATCH·DELETE`)는 누구에게나 |
| 강사 자료 | 없음 | 모두 |

- 판단은 `service`, `method`, `path`, `route`가 모두 같은 구역·같은 모양일 때만 허용합니다. 쿼리(`queryLength`, `querySha256`)는 읽지 않으므로 쿼리로 기능을 고를 수 없습니다.
- 자료 ID 형식은 좁히지 않습니다(UUID가 아니어도 허용). `:id`와 같은 깊이에 `export` 같은 기능 경로를 두지 않았고, 두면 그 이름이 자료 ID로 읽힙니다.
- 순서는 기기 규칙 → 구역 규칙 → 복합 이상 규칙입니다. 막힌 구역은 복합 이상이어도 `step_up`이 아니라 바로 `deny`입니다.
- 메모의 주인 비교는 판정기에 넣지 않았고 서버 API가 합니다. 강사의 공지 수정은 판정기에 역할이 없어 서버의 관리 경로 몫인데, 이 자료실에는 그 경로를 만들지 않았습니다.
- `aleph.config.json`의 `allowedRoutes`는 판정기가 허용하는 `GET·PUT·DELETE /api/notes/:id` 세 개로 줄였습니다.

**자료 API**

- 메모 API(`src/notes-api.mjs`): 검증된 사용자와 저장된 소유자(`owner_id`)를 한 질의에 함께 걸어 남의 메모는 404로 거부합니다. 요청 본문의 `role`·`roles`·`isInstructor`·`instructor`·`admin`류 표시는 믿지 않고 `403`(`ROLE_CLAIM_REJECTED`)으로 거부합니다.
- 다른 구역과 알 수 없는 경로(`api/[zone].js`와 그 아래 `[id]`·`[a]`·`[b]` 파일(한 단계부터 네 단계까지), 로직은 `src/zones-api.mjs`와 `src/zones-function.mjs`): 로그인하지 않으면 `401`, 강사 자료는 `403`(`instructor_only`), 반 공지는 읽기 `404`(`no_notice_data`)·쓰기 `403`(`notice_write_admin_only`), 그 밖은 `404`(`unknown_route`)입니다. 모두 JSON이고 자료가 들어 있지 않습니다.
- 단계별 파일로 나눈 이유: Vercel은 여러 단계를 한꺼번에 받는 `[...이름].js` 파일을 이 설정에서 한 단계만 받아서, 배포해 보니 `/api/instructor/x` 같은 두 단계 경로가 JSON이 아니라 기본 404 페이지로 나왔습니다. 다섯 단계 이상의 깊은 경로는 호스팅 서비스의 기본 404이며 자료가 없습니다.
- 거부할 때마다 사유를 한 줄 기록합니다(서버 로그). 토큰·요청 본문·사용자 ID는 쓰지 않습니다.

확인 순서:

1. `npm run decider:test`: 네 줄이 모두 `통과`여야 합니다(정상 요청은 메모 한 건 읽기이므로 구역 규칙을 통과합니다).
2. `npm run test:decider`: 자원 ID, 구역 규칙(메모·공지·강사 자료·알 수 없는 경로), 이전 규칙 유지를 확인합니다.
3. `npm run test:notes`: 본인 정상 요청 유지, 남의 메모 거부, 본문 `role` 거부, 다른 구역 JSON 거부, 거부 사유 기록을 확인합니다.
4. 배포 뒤 로그인하지 않고 `curl -si https://choi-bujang-secret-vault-hailey17.vercel.app/api/instructor/x`를 실행하면 `401`과 JSON `{"error":"UNAUTHENTICATED","reason":"no_valid_login"}`이 나와야 합니다.

한계:

- 위 시험은 가상 요청과 가짜 표를 쓴 로컬 시험이며 심판의 판정이 아닙니다. **로그인한 사용자가 다른 구역 자료를 직접 API로 요청하는 점검은 로그인 토큰이 필요해 실행하지 않았습니다.**
- 메모의 `PUT`·`DELETE`는 카드가 허용 여부를 말하지 않아 "자료 ID 하나를 고르는 경로"로 보고 허용했습니다(주인 비교는 API). 거부해야 하면 `ZONE_RULES.memo`에서 두 줄을 빼면 됩니다.
- 판정기는 메모 전체 목록과 추가(`GET·POST /notes`)를 거부하지만, 화면은 판정기를 거치지 않아 목록·추가를 그대로 씁니다. `allowedRoutes`가 판정기가 허용하는 경로만 담는 것과 실제 서버가 내주는 경로가 다른 이유입니다.
- `resource_not_allowed`와 `approved`는 계약 문서·시험 코드에서 정한 이유 코드입니다. `resource_not_allowed`가 운영 등록부의 허용 코드인지는 이 저장소에서 확인하지 못했습니다.
- 서버 로그의 거부 기록은 호스팅 서비스의 로그 화면에서만 볼 수 있고, 이 저장소에는 남지 않습니다.

## 9단계: 도플갱어를 찾고 권한을 거둡니다

**이 단계의 결과는 회수 "제안"이고, 실제 접속 회수는 하지 않았습니다.** `detect()`는 의심되는 사용자를 돌려줄 뿐이며, 운영 반 엔진이 검증한 사건을 전달하고 그 제안을 집행하는 경로는 이 저장소에 연결하지 않았습니다. `npm run detect:test`의 통과는 실제 접속 차단이나 심판 판정이 아닙니다. 판정기(`src/decider.mjs`)의 응답 형식, 회수 API, 기기 권한은 바꾸지 않았습니다.

**입력 처리(`readEvent`, `readEvents`)**: 사건 한 건에서 `at`(시각), `method`(요청 종류), `identity.sub`(가명 사용자) **세 값만** 읽습니다. 사건에 없는 네트워크·기기·지역 값은 지어내거나 조건으로 쓰지 않고, 메모 내용·토큰·실명은 읽지도 저장하지도 출력하지도 않습니다. 사건 위쪽에 직접 넣은 사용자 번호는 신원으로 취급하지 않고(`identity.sub`만 신원), 세 값이 없거나 모양이 다른 사건은 정상값으로 채우지 않고 버립니다. 시각은 ISO 8601 형식(`2026-10-01T00:00:00.000Z`)만 받습니다.

**규칙 `burst_read`**

| 항목 | 기준 |
|---|---|
| 세는 사건 | `method`가 `GET`인 사건만(다른 요청 종류는 세지 않음) |
| 묶는 단위 | 같은 `identity.sub`만. 다른 사용자의 사건은 합치지 않음 |
| 구간 | 어느 10분 구간에서든(움직이는 창). 창 계산은 `at` 시각만 사용 |
| 의심 | 한 구간에 **120건을 넘을 때만**(121건 이상). 정확히 120건은 의심이 아님 |
| 돌려주는 값 | 의심이면 `{ action: 'propose_revocation', reasonCode: 'burst_read', subject }` 세 키만, 아니면 `{ action: 'observe' }`만 |

- 구간을 고정된 시계 구간(예: 00:00~00:10)으로 나누지 않고 움직이는 창으로 봅니다. 나누면 경계에 걸친 폭주를 놓칩니다(시험으로 확인).
- 계약이 말하지 않은 경계는 이렇게 정했습니다. 시작과 끝이 **정확히 10분** 떨어진 두 사건은 같은 구간으로 보고, 1밀리초라도 지나면 다른 구간으로 봅니다. 둘 이상의 사용자가 넘으면 **가장 먼저 넘긴 사용자 하나**를 돌려줍니다.

확인 순서:

1. `npm run detect:test`: 아래 여섯 줄이 모두 `통과`여야 합니다.

```
통과 · 정상 조회 30건
통과 · 10분 안에 120건
통과 · 10분 안에 121건
통과 · 폭주 조회 200건
통과 · 서로 다른 사용자 각 100건
통과 · 10분 밖으로 흩어진 조회 200건
가상 사건 연습이며 실제 접속 회수나 심판 통과 증거가 아닙니다.
```

2. `npm run test:detect`: 세 값만 읽는지, 120건·121건 경계, 움직이는 창, 정확히 10분 경계, 다른 사용자 비합산, `GET`만 세는지, 입력 순서와 상관없는지, 큰 입력(6만 건)을 빠르게 처리하는지를 확인합니다.

한계:

- 위 시험은 가상 사건 연습이며 심판의 판정이 아닙니다. **운영 반 엔진의 사건 전달과 실제 접속 회수는 시험하지 않았습니다.**
- 시각이 ISO 8601 문자열이 아닌 사건(예: 숫자 시각)은 읽을 수 없는 사건으로 버립니다. 엔진이 다른 시각 표기를 보내면 그 사건은 세지 않습니다.
- `method`는 대문자 `GET`만 읽기로 봅니다.
- 이 자료실의 서버(`api/`)는 `detect()`를 호출하지 않습니다. 탐지 결과가 자료실 접근에 영향을 주지 않습니다.
- 사건 수에 상한을 두지 않았습니다(6만 건을 2초 안에 처리하는 것까지 확인).

## 10단계: 백업에서 자료실을 되살립니다

**실제 운영 정책(`src/decider.mjs`, `aleph.config.json`)은 이 단계에서 바꾸지 않았습니다.** 정책 사본·침공 흉내·복원은 모두 `policy/` 폴더의 파일에서만 합니다. 판정기의 동작과 응답 형식은 그대로입니다.

### 제작 1: 안전 정책 사본과 침공 흉내

- `policy/safe-policy.json`: 1~9단계 접근 규칙(판정기 규칙 세 개와 기준값, 서비스별 구역 규칙, 메모 소유자 검사, `allowedRoutes`, DB 접근 정책)을 한 파일에 적은 **검증한 사본**(버전 `safe-1`). `policy/safe-policy.sha256`에 키를 정렬한 JSON의 SHA-256 해시를 따로 적었습니다.
- 사본이 없거나 해시가 맞지 않거나 형식이 이상하면 모든 명령이 **중단**합니다(`npm run policy:verify`).
- `npm run policy:drill`: 사본에서 **시험 정책**(`policy/drill/test-policy.json`, Git 제외)을 만들고 규칙 한 줄(`services.notes.ownerCheck: true → false`)만 바꿉니다. 사본과의 차이만 보여 줍니다. 이 시험 정책에서는 B가 A의 메모를 읽을 수 있게 됩니다. 이미 있는 시험 정책은 `--reset` 없이는 다시 만들지 않습니다(감사 이력 보호).
- `npm run policy:make`: 현재 코드에서 사본을 다시 만듭니다. 이미 사본이 있으면 `--force` 없이는 덮어쓰지 않습니다.
- 정책 계산기(`evaluate`)는 실제 판정기(`decide`)와 메모 API의 결과와 같은지 시험(`test/policy.test.mjs`)으로 묶었습니다.

### 제작 2: 검증한 버전으로 되돌리기

`npm run policy:restore`는 **미리보기**입니다. 실행 전에 복원할 버전·해시, 복원 범위(`services.notes`), 바뀔 항목(현재 → 복원 후), 그대로 둘 항목(범위 밖 차이, 감사 이력 건수)을 보여 줍니다. 맞으면 `npm run policy:restore -- --apply`로 실행합니다.

- 그 서비스의 규칙만 사본으로 되돌립니다. 다른 서비스 규칙과 범위 밖 차이는 건드리지 않고, 감사 이력은 지우지 않고 복원 기록을 덧붙입니다.
- 복원 뒤 같은 요청을 다시 넣어 **B의 A 자료 요청(읽기·수정·삭제)은 다시 거부되고 A의 정상 요청은 유지**되는지 보여 줍니다.
- 되돌릴 것이 없으면 아무것도 쓰지 않고 멈춥니다.

### 제작 3: 메모 한 건 복원 (B의 가상 메모)

- 복원할 메모(B 소유 가상 메모): ID `5b2d7f10-3c4e-4a6b-9d1e-0b5a7c9e1f20`, 제목 "B의 가상 메모 (복원 시험)".
- 설정: `aleph.config.json`의 `restoreRoute`에 `"POST /api/restore/notes"`를 등록했습니다.
- 서비스·경로: **`notes` 서비스의 `POST /api/restore/notes`**, 본문 `{"id": "<메모 UUID>"}`. 로그인(`Authorization: Bearer`)이 필요합니다(`api/restore/notes.js`, 로직은 `src/restore-api.mjs`).
- 비공개 백업: 표 `public.notes_backup`(RLS 켜기, `anon`·`authenticated` 권한 없음, 서버 전용 키만 읽음). 백업 행에는 id·owner_id·제목·본문과 내용 해시(`id`·제목·본문의 정렬 JSON SHA-256)가 있습니다. 표와 시험 메모는 `supabase/notes-restore.sql`(Git 제외, 이 컴퓨터에만 있음)로 만듭니다.
- 절차: ① 백업을 `id`와 `owner_id=로그인한 사용자`로 한 질의에 조회(남의 백업은 없는 백업과 같은 `404`) → ② ID·소유자·내용 해시 비교(해시가 다르면 `409 BACKUP_CORRUPT`) → ③ 같은 ID의 메모가 이미 있으면 덮어쓰지 않고 `409 ALREADY_EXISTS` → ④ 그 한 건만 `notes`에 넣기 → ⑤ 다시 읽어 ID·소유자·내용 해시를 비교하고, 다르면 방금 넣은 한 건만 지우고 `502`.
- 다른 메모와 백업은 건드리지 않고, 본문의 `role`·`owner_id`는 `403`으로 거부합니다. 복원 사실은 서버 로그(`event: restore`, 자원 ID와 해시 앞 12자만)에 남기며 본문·토큰은 남기지 않습니다. 응답에는 `X-Resource-Id: memo:<id>`가 붙습니다.
- `npm run test:restore`(가짜 표 7항목)로 확인했습니다.

실제로 해 보려면(사람이 직접): ① Supabase SQL Editor에서 `supabase/notes-restore.sql` 실행(확인 조회에서 `backup_rows=1, note_rows=1`) → ② B로 로그인해 그 메모를 `DELETE /api/notes/<ID>`로 지움 → ③ `POST /api/restore/notes`로 `201` 확인 → ④ `GET /api/notes/<ID>`로 B에게만 보이는지, A에게는 `404`인지 확인.

### 제작 4: 복원 후 1~9단계 정상·금지 요청 다시 확인하는 순서

복원 직후 아래 순서로 다시 실행합니다. 이 저장소에서 **내가 실행한 것**과 **실행하지 않은 것**을 구분해 적습니다.

| 순서 | 단계 | 정상 요청(통과해야 함) | 금지 요청(거부되어야 함) | 확인 방법 | 상태 |
|---|---|---|---|---|---|
| 1 | 1·2 | 첫 화면 `/` 열림 | `/data.json` 404, 저장소에 가상 메모 문장 없음 | 배포 주소 요청, 검색 절차 | 배포 주소는 요청해 확인 |
| 2 | 3 | A 로그인·메모 읽기/추가/수정/삭제 | 비로그인 `GET·POST·PUT·DELETE /api/notes` → 401 | `npm run bundle`의 점검, 로그인은 사람이 | 비로그인은 실행, **로그인 동작은 미실행** |
| 3 | 4 | A가 자기 메모 | B가 A 메모 읽기·수정·삭제 → 404 | `npm run test:notes`(가짜 표) | 가짜 표만, **배포 서버 A·B 토큰은 미실행** |
| 4 | 5 | 서버 함수로 로그인 | `anon` 키 직접 읽기·삭제 거부, 화면에 키 없음 | `npm run bundle`의 점검 | 실행 |
| 5 | 6 | 등록 기기 allow | 미등록 기기 deny | `npm run decider:test` | 로컬 실행(심판 아님) |
| 6 | 7 | 정상·다시 확인한 요청 allow | 복합 이상은 step_up | `npm run decider:test`, `npm run test:decider` | 로컬 실행. **실제 재로그인 확인은 미실행** |
| 7 | 8 | 자기 메모 한 건 | 메모 목록·공지 쓰기·강사 자료 deny | `npm run test:decider`, `npm run test:notes` | 로컬 실행. **로그인한 사용자의 다른 구역 직접 요청은 미실행** |
| 8 | 9 | 120건은 observe | 121건 이상은 propose_revocation | `npm run detect:test`, `npm run test:detect` | 로컬 실행. **실제 접속 회수는 미실행** |
| 9 | 10 | 복원 후 A의 정상 요청 | 복원 후 B의 A 자료 요청 거부 | `npm run policy:restore -- --apply`, `npm run test:policy` | 로컬 실행 |
| 10 | 10 | B의 메모 한 건 복원 후 B에게만 보임 | A가 B의 백업 복원 요청 → 404 | `npm run test:restore`(가짜 표) | 가짜 표 + B 로그인 실제 호출(사용자 실행, 결과 전달). A가 B의 백업을 요청하면 404(사용자 실행, 결과 전달) |

### 한계

- 사본의 `db`(DB 접근 정책)는 운영 DB를 읽은 값이 아니라 5단계에서 적용하도록 안내한 SQL 기록을 옮겨 적은 선언입니다. 실제 DB가 이 선언과 같은지는 확인하지 않았습니다.
- 시험 정책은 파일일 뿐 실제 서버의 동작을 바꾸지 않습니다. 침공 흉내와 복원은 정책 계산기에서만 일어납니다.
- 복원 API는 `allowedRoutes`와 판정기 구역 규칙에 넣지 않았습니다(복원은 운영 보조 경로). 판정기를 거치지 않습니다.
- 백업은 사람이 SQL로 만든 한 건뿐이며 자동 백업이 아닙니다. 백업 표와 `notes`가 같은 DB에 있어, DB 전체가 사라지면 복원할 수 없습니다.
- 복원 API를 배포 후 B로 실제 호출한 결과는 사용자가 직접 실행해 전해 주었습니다(복원 `restored: true`, 같은 요청 반복 시 `409 ALREADY_EXISTS`, B가 읽기 `200`). A로 B의 백업 복원을 요청하면 `404 NOT_FOUND`가 나온 것도 사용자가 직접 실행해 알려 주었습니다. 이전에 지워진 메모의 최신 수정본이 아니라 백업 시점의 내용을 되살립니다.

## 11단계: 나만의 접속 앱

**운영 정책(`src/decider.mjs`의 규칙 세 개와 응답 형식)은 바꾸지 않았습니다.** 판정기의 `deviceRegistered`는 운영 엔진이 정하는 값이라, 아래 기기 승인 기록과 연결하지도 값을 보내지도 않습니다. 기기 승인은 이 자료실 서버의 자체 기록입니다.

### 제작 1: 설치형 웹앱 설정과 승인 상태 표시

- `public/manifest.webmanifest`: 앱 이름 "BYTE BACK 내 자료실"(짧은 이름 "내 자료실"), 시작 주소 `/`, `display: standalone`, 아이콘 192·512 PNG(`public/icon-*.png`). 키·토큰·비밀번호는 넣지 않았습니다.
- `public/sw.js`(서비스 워커): **오프라인 안내 페이지(`/offline.html`) 하나만** 보관합니다. 화면 이동이 네트워크 오류로 실패할 때만 그 안내를 보여 주고, `/api` 요청·로그인·메모는 가로채지도 저장하지도 않습니다.
- 오프라인 안내(화면과 `offline.html`): "오프라인이면 메모는 보이지 않고 안내 화면만 열립니다. 이 기기에는 메모를 저장해 두지 않습니다. 앱으로 설치했다는 표시만으로는 기기를 믿지 않으며, 승인은 서버가 확인합니다."
- 화면(`public/index.html`)의 "기기 승인 상태" 표시: 승인 필요 / 승인 대기 / 요청 만료 / 승인됨. 설치했다는 사실은 승인 상태에 아무 영향이 없습니다. 따로 설치하는 접속 프로그램은 만들지 않았습니다.

### 제작 2: 기기 승인 요청과 서버 확인

`GET·POST /api/device`(로그인 필요, `api/device.js`, 로직 `src/device-api.mjs`).

1. 로그인하면 화면이 `GET /api/device`로 이 기기의 상태를 묻습니다. 승인됨이 아니면 **메모를 불러오지 않고** 승인 요청 버튼만 보입니다.
2. "이 기기 승인 요청" → `POST {action:'request'}`: 서버가 무작위 기기 값(32바이트)을 만들어 **`HttpOnly`·`Secure`·`SameSite=Strict` 쿠키**(`vault-device`, 경로 `/api`)로 내려 주고, DB에는 그 **SHA-256 해시와 계정 ID**만 `pending`으로 저장합니다. 기기 값 원문은 화면 스크립트가 읽을 수 없고 `localStorage`·`sessionStorage`에도 넣지 않습니다.
3. "이 기기 승인" → `POST {action:'approve', password}`: 서버가 이 로그인 토큰의 계정 이메일과 보낸 비밀번호로 **Supabase에 다시 로그인해 보고**, 확인된 사용자가 이 로그인의 사용자와 같을 때만 `approved`로 바꿉니다. 승인 버튼만 눌러서는 승인되지 않습니다(비밀번호 없음 → 400, 틀림 → 403).
4. 승인 요청은 15분이 지나면 만료됩니다. 한 계정의 대기 요청은 5건까지입니다(만료된 것은 세지 않음). 본문의 `status`·`userId`·`deviceId`·`role` 같은 값은 403으로 거부합니다.
5. 기기 기록은 계정에 묶입니다. A가 승인한 기기에서 B로 로그인하면 승인되지 않은 기기로 봅니다.
6. 로그에는 비밀번호·기기 값·토큰·사용자 ID를 남기지 않고 사건 이름과 상태 번호만 남깁니다.

DB 표는 `supabase/device-approvals.sql`(Git 제외, 이 컴퓨터에만 있음)로 만듭니다. RLS를 켜고 `anon`·`authenticated` 권한을 모두 회수하며 서버 전용 키만 읽고 씁니다.

### 확인

1. `npm run test:device`: 가짜 표로 승인 흐름(요청·재확인·만료·다른 계정·위조 쿠키·한도·로그)과 앱 설정 파일(manifest·서비스 워커·화면)을 확인합니다.
2. 직접 해 볼 순서(사람이): ① Supabase SQL Editor에서 `supabase/device-approvals.sql` 실행(확인 조회에서 `anon_select`·`auth_select`는 `false`, `service_select`는 `true`) → ② 배포 주소에 로그인하면 "승인 필요"이고 메모가 보이지 않음 → ③ "이 기기 승인 요청" → 비밀번호 입력 후 "이 기기 승인" → "승인됨"과 메모 표시 → ④ 브라우저 주소창의 설치 아이콘이나 메뉴의 "앱 설치"로 설치해도, 새 기기·새 브라우저에서는 다시 승인이 필요해야 함.

### 한계

- **서버 API 자체는 기기 승인으로 막지 않습니다.** 승인되지 않은 기기도 유효한 로그인 토큰만 있으면 `/api/notes`를 직접 부를 수 있습니다. 기기 승인으로 막는 것은 이 화면이 메모를 불러오는 것까지입니다. 기존 단계의 점검(심판의 호출 포함)이 깨지지 않게 메모 API에는 기기 조건을 넣지 않았습니다. 브라우저에서 버튼을 숨기는 것만으로 서버 접근이 차단된 것은 아닙니다.
- 기기 쿠키를 가진 사람은 그 기기로 행세할 수 있습니다. 쿠키는 `HttpOnly`라 화면 스크립트가 읽을 수 없지만, 기기 안의 개인키로 서명하는 방식(WebAuthn 등)은 아닙니다. 승인은 비밀번호 재확인에 의존합니다.
- 비밀번호 재확인은 로그인 시도 횟수 제한을 Supabase 기본 제한에 맡깁니다.
- 승인 취소(회수)와 승인된 기기 목록 화면은 만들지 않았습니다. 승인을 지우려면 DB의 `device_approvals` 행을 직접 지워야 합니다.
- 서비스 워커·설치는 브라우저마다 동작이 다르며, 실제 설치와 오프라인 화면은 **미실행**입니다. 아이콘은 단색 도형입니다.
- Vercel 서버 함수는 이 단계에서 12개가 되어 무료 한도(12개)에 닿았습니다. 더 만들려면 합쳐야 합니다.
- 실제 승인 흐름은 사용자가 배포 주소에서 직접 해 보았고 결과를 전해 주었습니다(승인됨, 메모 추가 칸과 메모 목록 표시). 새 기기·새 브라우저에서 다시 승인이 필요한지, 앱 설치, 오프라인 화면은 **미실행**입니다.

## 12단계: 탈환 작전실

**판정기 규칙·응답 형식은 바꾸지 않았습니다.** 화면의 성공 문구를 통과 근거로 쓰지 않습니다. 이 단계의 "통과"는 심판이 정하며, 여기 적은 확인은 모두 내 쪽 점검입니다.

### 제작 1: 작전실 화면과 요약

- 화면 `/ops.html`(로그인한 같은 탭에서 자료실의 "탈환 작전실 열기" 링크로 이동)은 `GET /api/device?view=ops`의 응답을 **그대로** 그립니다. 값을 화면에서 계산하거나 지어내지 않고, 문자열은 `textContent`로만 넣습니다. "서버 응답 그대로 보기"를 펼쳐 화면의 값과 대조할 수 있습니다.
- 요약 API는 서버 함수 한도(12개) 때문에 새 함수를 만들지 않고 기기 승인 함수(`api/device.js`)에 `view=ops`로 붙였습니다. 로그인이 필요하며(없으면 `401`), 모르는 `view` 값은 기존 기기 상태 응답을 돌려줍니다.
- 항목마다 구분이 붙습니다. **실측**은 서버가 이번 요청에서 직접 읽거나 계산한 값이고, **미실행**은 이 자료실에 연결하지 않았거나 실행하지 않은 것이라 값을 비워 둡니다(0으로 채우지 않음).

| 항목 | 구분 | 값의 출처 |
|---|---|---|
| 판정기 규칙 | 실측 | `src/decider.mjs`의 `RULE_IDS` |
| 탐지 규칙 | 실측 | `src/detect.mjs`의 `burst_read`(GET, 600초, 120건 초과) |
| 탐지 사건 | **미실행** | 자료실 서버는 `detect()`를 호출하지 않고 사건 저장소도 없어 사건 수를 알 수 없음 |
| 회수 상태 | **미실행** | 접속 회수는 연결하지 않음(`detect()`는 회수 제안만 돌려줌) |
| 복구 버전 | 실측 | `policy/safe-policy.json`의 버전, 해시 앞 12자, 현재 코드·설정과 다른 곳의 수 |
| 내 메모 건수·내 백업 건수 | 실측 | `notes`·`notes_backup` 표에서 내 계정 행만 센 건수(표를 읽지 못하면 미실행) |
| 이 기기 승인 상태 | 실측 | `device_approvals` 표 |

- 메모 제목·본문, 소유자 ID, 기기 값, 토큰은 응답에도 화면에도 없습니다(`test/ops-api.test.mjs`가 확인). 응답에는 요청 ID(서버가 만든 UUID), 호스팅 서비스의 요청 ID(`x-vercel-id`), 확인 시각이 들어 있습니다.
- "화면의 수치와 서버 기록이 맞는지": 건수는 서버가 센 값을 그대로 보여 주며, 시험(가짜 표)에서 계정별 건수가 표의 행 수와 같은 것을 확인했습니다. 실제 DB 값과의 대조는 사용자가 직접 했습니다: 로그인한 계정의 작전실 "내 메모 건수" 6건이, SQL Editor에서 `auth.users`와 `notes`를 계정별로 센 값(6건)과 같았습니다(캡처는 받았으나 저장소에는 넣지 않음, 이 절차가 다시 확인한 것은 아님). B 계정으로도 사용자가 직접 열어 보았고 메모 2건·백업 1건·기기 승인됨이 나왔습니다(메모 2건은 같은 DB 조회 결과와 같고, 백업 1건은 10단계 SQL의 확인 조회 결과와 같음, 스크린샷만 받음). 백업 건수를 DB에서 직접 센 대조는 **미실행**입니다.

### 제작 2: 정상·금지 요청 실측 표 절차

`npm run ops:table` (배포 주소가 아닌 곳을 보려면 환경변수 `OPS_BASE_URL`).

1. 배포 주소에 **실제 요청**을 보내고(로그인 없이 보낼 수 있는 정상·금지 요청), 판정기·탐지 함수를 이 컴퓨터에서 직접 부릅니다.
2. 표의 열은 단계, 구분(정상/금지), 요청, 기대 결과, 실제 결과, 요청 ID, 확인 시각, 상태, 일치입니다. 요청 ID는 배포 요청은 응답 머리 `x-vercel-id`(호스팅 서비스가 붙인 값), 로컬 호출은 판정 요청에 넣은 UUID입니다.
3. 상태는 네 가지입니다: **실측(배포)**, **실측(로컬)**(심판의 판정이 아님), **사용자 보고**(사용자가 직접 해 보고 알려 준 결과, 캡처 없음, 이 절차가 다시 확인하지 않음), **미실행**. 미실행·사용자 보고는 일치로 세지 않고, 기대와 다른 실측이 하나라도 있으면 명령이 실패 코드로 끝납니다.
4. 결과는 `artifacts/ops-table.md`(Git 제외)에 저장됩니다. 로그인 토큰이 필요한 요청(로그인한 A의 정상 요청, B의 A 자료 요청 등)과 **심판의 41종 공격 방어 시험은 실행하지 않고 미실행으로 남깁니다. 임의로 통과 처리하지 않습니다.**
5. 표에는 토큰·키·메모 본문이 들어가지 않습니다(`npm run test:ops`가 확인).

### 제작 3: 설치·실행·중지·복구 안내

기준: 검사한 커밋은 `/aleph.json`의 `commit`과 `git log -1`로 확인합니다(이 파일이 자기 커밋 번호를 적을 수 없어서 적지 않았습니다).

**출처 구분**

| 구분 | 무엇 | 위치 |
|---|---|---|
| ALEPH SDP 엔진(제공, 이 저장소 밖) | 요청의 신원·기기·경로를 확인해 판정기에 전달하는 운영 엔진, 심판 접수 서버(`judgeIssuer`), 41종 공격 시험. 판정 요청의 `deviceRegistered`·`stepUp`·`recentEvents`·`signals` 값은 이 엔진이 정함 | 이 저장소에 없음. 요청·응답 계약은 `docs/DECIDER_REQUEST.md`가 설명 |
| 시작 틀(제공) | `aleph.config.json` 뼈대, `docs/`, `scripts/`의 시험·묶음 도구, `src/verify-login.mjs`, `xdr/` 안내와 시험 자료, `package/` 양식, 미구현 뼈대 `api/ai.js`·`api/threat-intel.js`(지금도 `501`, 구현하지 않음) | 첫 커밋 `ce0237b` |
| 학생 작성(AI 코딩 도구와 함께 작성) | 판정기 규칙 세 개(`src/decider.mjs`), 탐지 `burst_read`(`src/detect.mjs`), 메모·로그인·구역·복원·기기 승인·작전실 API와 화면, 안전 정책 도구(`scripts/policy.mjs`), 정상·금지 요청 표(`scripts/ops-table.mjs`), 보너스 xdr 대응 코드 | `src/`, `api/`, `public/`, `scripts/`, `xdr/` 일부, `test/` |

비밀값(서버 전용 키, 비밀번호, 토큰)은 이 저장소 어디에도 없고, Vercel 환경변수에만 둡니다. 환경변수 이름은 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`입니다(값을 받는 곳: Supabase 프로젝트 설정의 API 화면. 값은 직접 입력).

**설치**
1. Node 22 이상. `git clone <저장소>` → `npm install` (오류 없이 끝나야 함).
2. Supabase 학습용 프로젝트를 만들고 아래 표를 만듭니다. **이 저장소에는 `supabase/` 폴더가 없습니다**(메모 문장이 들어 있어 Git에서 뺌). 처음 받는 사람은 SQL Editor에서 직접 만들어야 합니다.
   - `public.notes(id uuid primary key default gen_random_uuid(), owner_id uuid, title text not null, content text not null, created_at timestamptz not null default now())` + RLS 켜기 + `PUBLIC`·`anon`·`authenticated` 권한 회수 + `service_role`에 SELECT·INSERT·UPDATE·DELETE.
   - `public.notes_backup`(10단계)과 `public.device_approvals`(11단계)는 위 절의 열 이름대로 만들고 같은 방식으로 RLS를 켜고 `service_role`만 허용합니다.
3. Supabase Authentication에서 시험 계정(A, B)을 만들고, `aleph.config.json`의 `identityProvider`·`originalApiUrl`·`publicAppUrl`을 내 프로젝트 값으로 맞춥니다. 공개용 키(publishable)는 `src/supabase-public.mjs`에 둡니다.
4. 새 Vercel 프로젝트에 저장소를 연결하고 환경변수 두 개를 비밀 입력란에 직접 넣어 배포합니다(서버 함수 12개, Hobby 한도).

**실행(확인)**: `/`에서 로그인 → 기기 승인 → 메모 → `/ops.html`. 로컬 확인은 `npm run test:policy`, `test:restore`, `test:device`, `test:ops`, `test:decider`, `test:notes`, `test:detect`, `decider:test`, `detect:test`, `ops:table`.

**중지**
- 서버 함수만 멈추기: Vercel 환경변수 `SUPABASE_SECRET_KEY`를 지우고 다시 배포하면 자료 API가 `500 SERVER_NOT_CONFIGURED`를 돌려줍니다(데이터는 그대로).
- 특정 기기만 거두기: DB의 `device_approvals`에서 그 행을 지웁니다(화면에서 취소하는 기능은 없음).
- 로그인 하나 끊기: 화면의 로그아웃(`/api/logout`).
- 접속 회수 자동화는 연결하지 않았습니다(9단계, 미실행).

**복구**
- 규칙 복구: `npm run policy:restore`(미리보기) → `-- --apply`(10단계 절). 검증한 사본(`policy/safe-policy.json`)과 해시가 맞아야만 진행합니다.
- 메모 한 건 복구: `POST /api/restore/notes`(10단계 절).
- 코드 되돌리기: `git revert <커밋>`으로 새 커밋을 만들어 push합니다. `git reset --hard`는 쓰지 않습니다.

**재현 순서(처음 받는 사람)**: 설치 1~4 → `/`에서 로그인 → 기기 승인 → 메모 추가 → `/ops.html`에서 실측·미실행 구분 확인 → `npm run ops:table`로 표 만들기 → 시험 명령 실행.

### 한계

- 작전실의 "탐지 사건"과 "회수 상태"는 값이 없습니다. 자료실이 탐지·회수를 실제 요청에 연결하지 않았기 때문이며, 지어낸 숫자를 넣지 않았습니다.
- 작전실 요약은 로그인한 사용자 본인 계정의 건수만 봅니다. 운영자 전체 현황이 아닙니다.
- 표 절차는 로그인 토큰이 필요한 요청을 보내지 않습니다(토큰을 다루지 않기 위해서). 그 줄은 미실행이거나 사용자 보고입니다.
- 심판의 41종 공격 방어 시험은 실행하지 않았습니다. 이 저장소의 점검은 심판 판정이 아니며, 통과 여부를 알 수 없습니다.
- 서버 함수는 12개로 한도에 닿아 있습니다.
- 위 설치 절차는 새 Vercel 프로젝트에서 처음부터 따라 해 보지 않았습니다(**미실행**).

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

- **ZTNA 판정기에 연결되지 않았습니다.** `src/decider.mjs`는 6단계 기기 등록 규칙만 있어 거부 규칙 파일을 읽지 않으며, 판정 요청(`docs/DECIDER_REQUEST.md`)에는 출발 주소가 없어 주소 기준 규칙을 맞출 수 없습니다. `deny-rules.json`은 넣을 규칙을 적어 둔 기록이고 `connectedToDecider: false`로 표시했습니다. 판정기의 기존 규칙은 고치지 않았습니다.
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

- **ZTNA 판정기에 연결되지 않았습니다.** xdr-01과 같은 이유입니다. `src/decider.mjs`는 기기 등록 규칙뿐이고 판정 요청에 출발 주소·주소(URL)가 없습니다. `deny-rules.json`은 `connectedToDecider: false`인 기록입니다.
- 이 경보 묶음의 요청 주소(`data.url`)는 `doc-sql-chain` 같은 문서용 표기라서, 실제 판단은 설명 문장과 반복 횟수(8번 이상이면 반복)로 했습니다. 주소에 실제 주입 형태가 있을 때를 대비한 `payload_in_url_repeat`는 시험 문자열로만 확인했고 이 경보 26건에는 해당이 없습니다.
- 정상과 애매한 경보를 가른 기준은 경보의 모양입니다. 정답은 저장소에 없으므로 심판의 구분과 다를 수 있습니다. 설명 문장의 단어(`SQL`, `스크립트`, `경로`)를 찾는 패턴은 문장이 바뀌면 맞지 않습니다.
- `npm run test:xdr`은 로컬 시험이며 심판의 판정이 아닙니다.
