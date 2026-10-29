# BYTE BACK 방어전 — 내 자료실

방어전 시작 틀 R5에서 만든 학생 본인의 저장소입니다. 자료실의 메모 네 건은 모두 실습용 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요. 코딩 도구에는 [AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청합니다.

## 단계 기록

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 시작 틀로 GitHub 저장소와 Vercel 배포를 만들고, `/data.json`에 메모가 공개된 상태를 확인 | 완료(첫 커밋 `ce0237b`) |
| 2 | 메모를 코드 밖(Supabase 표)으로 옮기고 `api/notes.js`를 통해 읽음. 보안 헤더(`nosniff`) 추가 | 완료·배포 확인(`b823ec1`, `4678663`) |
| 3 | Supabase Auth 이메일·비밀번호 로그인·로그아웃 화면, 로그인한 사용자의 메모 추가·수정·삭제 화면과 서버 API(서버가 토큰 검증), `aleph.config.json`에 `identityProvider`·`allowedRoutes` | 배포 완료(`7b9e987`). 로그인해 추가한 메모가 A의 `owner_id`로 저장된 것은 DB 조회로 확인 |
| 4 | 서버 API의 소유자 검사(검증한 사용자 ID와 `owner_id` 비교)와 Supabase의 GRANT·RLS를 본인 행만 허용하도록 적용 | 완료·배포(`ed3c069`, `7918c83`). DB 정책 네 개를 Supabase에서 실행하고 `pg_policies` 조회로 확인, `anon` 키 직접 요청 거부 확인. 배포 서버에서 A·B 토큰으로 직접 확인한 점검은 **미실행** |
| 5 | 자료 요청을 서버 한곳으로 모음: 브라우저의 직접 자료 호출 점검(없음), 학습 DB의 PUBLIC·anon·authenticated 직접 권한 회수, `originalApiUrl` 기입 | 구현·DB 적용 확인. 권한 조회에서 `anon`·`authenticated`는 모두 `false`, `service_role`은 `true`. 적용 뒤 A 화면의 읽기·추가·수정·삭제 정상은 사람이 확인 |

## 현재 기능

- `/`: 로그인하면 내 가상 메모 목록을 보여 주고, 메모를 추가·수정·삭제할 수 있습니다. 로그인하지 않으면 안내 문구만 보입니다.
- 로그인: `/`의 로그인 칸에서 Supabase 공식 SDK(`signInWithPassword`, `signOut`)로 로그인·로그아웃합니다. 로그인하면 계정 이메일과 로그아웃 버튼이, 로그아웃하면 입력 폼이 보입니다. 실패하면 Supabase가 준 이유를 화면에 보여 줍니다. 화면 코드의 Project URL과 publishable key는 공개용 값이며, 서버 전용 secret 키는 넣지 않았습니다. 비밀번호·JWT는 직접 만들지 않습니다.
- 서버 API(`api/notes.js`, `api/notes/[id].js`, 로직은 `src/notes-api.mjs`): 모든 요청에서 `Authorization: Bearer` 토큰을 `src/verify-login.mjs`로 검증하고, 서버가 확인한 사용자 ID로 로그인 여부를 판단합니다. 실패하면 `401`입니다. 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`는 서버에서만 읽고 응답·로그에 쓰지 않습니다.
  - `GET /api/notes`: 로그인 사용자의 메모 배열 `[{id,title,body}]`
  - `POST /api/notes`: `{id?,title,body}` 추가. `id`는 UUID이고 없으면 서버가 만들어 `{id}`로 돌려줍니다(`201`). 서버가 확인한 사용자 ID를 `owner_id`로 저장합니다.
  - `GET·PUT·DELETE /api/notes/:id`: 한 건 조회 `{id,title,body}`·수정(본문 `{title,body}`)·삭제. 지운 뒤 GET은 `404`입니다.
  - 소유자 검사: 한 건 읽기·수정·삭제는 `id`와 `owner_id = 검증된 사용자 ID`를 한 질의에 함께 걸어, 남의 메모는 없는 메모와 똑같이 `404`로 거부합니다. 추가는 본문의 `owner_id`를 쓰지 않고 항상 검증된 사용자 ID로 저장합니다. 수정 본문에 내 ID가 아닌 `owner_id`가 있으면 `403`으로 거부하고 소유자는 바뀌지 않습니다.
  - `aleph.config.json`의 `identityProvider`(Supabase 발급자·대상·공개키 주소)와 `allowedRoutes`(위 다섯 경로)에 같은 내용을 적었습니다.
- `supabase/notes.sql`: 표 생성(`owner_id uuid`, `auth.users` 외래키 없음), RLS 켜기, `anon`·`authenticated` 권한 회수, 가상 메모 네 건 입력, 확인용 조회. 메모 문장이 들어 있어 `.gitignore`로 Git에서 뺐습니다. 이 컴퓨터에만 있습니다.
- DB 권한(`supabase/notes-permissions.sql`, 로컬 기록): `notes`에 RLS를 켜고 `anon`·`authenticated`·`public`의 권한을 모두 회수한 뒤 `authenticated`에만 SELECT·INSERT·UPDATE·DELETE를 부여합니다. 정책은 네 개이고 모두 `auth.uid() = owner_id`일 때만 허용합니다(SELECT·DELETE는 기존 행, INSERT는 새 행, UPDATE는 기존 행과 새 행 모두). 5단계에서 이 직접 권한은 다시 회수했고 정책만 남아 있습니다.
- 직접 권한 회수(`supabase/notes-revoke-direct.sql`, 로컬 기록): `public.notes`의 `PUBLIC`·`anon`·`authenticated` 권한을 모두 회수했습니다. 이제 `notes`는 서버 함수(서버 전용 키, `service_role`)만 읽고 씁니다. 화면 코드는 Supabase를 `auth`로만 부르고 자료는 `/api/notes`로만 요청합니다(직접 자료 호출은 점검 결과 없음). `aleph.config.json`의 `originalApiUrl`은 쿼리 없는 원본 경로 `https://meupslbrbesjtyuwpske.supabase.co/rest/v1/notes`이며, 이 경로를 `anon` 키로 직접 부르면 `permission denied`(HTTP 401)입니다.
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
- **화면 코드의 공개 키**: 로그인은 브라우저가 Supabase Auth를 직접 부르므로 `index.html`에 publishable 키가 들어 있습니다. 로그인까지 서버 함수로 옮기는 가점은 하지 않았습니다.
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
