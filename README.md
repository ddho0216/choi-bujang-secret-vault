# BYTE BACK 방어전 — 내 자료실

방어전 시작 틀 R5에서 만든 학생 본인의 저장소입니다. 자료실의 메모 네 건은 모두 실습용 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요. 코딩 도구에는 [AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청합니다.

## 단계 기록

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 시작 틀로 GitHub 저장소와 Vercel 배포를 만들고, `/data.json`에 메모가 공개된 상태를 확인 | 완료(첫 커밋 `ce0237b`) |
| 2 | 메모를 코드 밖(Supabase 표)으로 옮기고 `api/notes.js`를 통해 읽음. 보안 헤더(`nosniff`) 추가 | 완료·배포 확인(`b823ec1`, `4678663`) |
| 3 | Supabase Auth 이메일·비밀번호 로그인·로그아웃 화면 | 화면만 구현. 서버의 토큰 검증, 메모 추가·수정·삭제, `aleph.config.json`의 `identityProvider`·`allowedRoutes`는 아직 안 함 |

## 현재 기능

- `/`: 화면이 `/api/notes`를 불러 가상 메모 네 건을 카드로 보여 줍니다.
- 로그인: `/`의 로그인 칸에서 Supabase 공식 SDK(`signInWithPassword`, `signOut`)로 로그인·로그아웃합니다. 로그인하면 계정 이메일과 로그아웃 버튼이, 로그아웃하면 입력 폼이 보입니다. 실패하면 Supabase가 준 이유를 화면에 보여 줍니다. 화면 코드의 Project URL과 publishable key는 공개용 값이며, 서버 전용 secret 키는 넣지 않았습니다. 비밀번호·JWT는 직접 만들지 않습니다.
- `api/notes.js`: Vercel 서버 함수. 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`로 Supabase `notes` 표를 읽어 `{ notes: [{ title, content }] }`만 돌려줍니다. 키는 응답·로그에 쓰지 않습니다.
- `supabase/notes.sql`: 표 생성(`owner_id uuid`, `auth.users` 외래키 없음), RLS 켜기, `anon`·`authenticated` 권한 회수, 가상 메모 네 건 입력, 확인용 조회. 메모 문장이 들어 있어 `.gitignore`로 Git에서 뺐습니다. 이 컴퓨터에만 있습니다.
- `vercel.json`의 `headers`로 모든 응답에 `X-Content-Type-Options: nosniff`를 붙입니다. 확인: `curl -sI https://choi-bujang-secret-vault-hailey17.vercel.app/ | grep -i x-content-type-options`
- 공개 `/data.json`과 저장소의 `data.json`은 없앴습니다. 빌드(`npm run build`)는 `public/aleph.json`(저장소·커밋·배포 주소)만 만듭니다.

## 다시 실행하는 방법

1. Supabase 학습용 프로젝트의 **SQL Editor**에 `supabase/notes.sql` 내용을 붙여 넣고 Run합니다. 마지막 확인 조회에서 `owner_id`가 보이고, 제약에 `FOREIGN KEY`가 없고, `rowsecurity`가 `true`이고, `anon`·`authenticated` 권한 조회가 0행이어야 합니다.
2. Vercel 프로젝트 **Settings → Environment Variables**에 `SUPABASE_URL`과 `SUPABASE_SECRET_KEY`를 직접 넣습니다. 값은 채팅·코드·Git에 적지 않습니다. 서버 전용 키(secret)이며, 공개용 키(anon/publishable)와 구분하세요.
3. 이 저장소를 GitHub에 push하면 Vercel이 다시 배포합니다.
4. 시크릿 창에서 배포 주소 `/`를 열어 카드 네 장이 보이는지, `/data.json`이 404인지 확인합니다.
5. 로그인 확인: Supabase 대시보드 Authentication → Users에서 시험 계정을 만들고(Auto Confirm 체크), 시크릿 창에서 `/`를 열어 로그인합니다. 틀린 비밀번호는 실패 이유가 보여야 하고, 맞으면 계정 이메일과 로그아웃 버튼이 보이며, 로그아웃하면 입력 폼으로 돌아와야 합니다.
6. 제출 묶음은 `bundle-notes.json`(Git 제외)을 만든 뒤 `npm run bundle`로 만듭니다. 이 명령은 Node 22 이상이 필요하고, 변경을 모두 커밋한 상태에서만 실행됩니다.

## 남은 약점

- **`/api/notes`는 여전히 공개 주소입니다.** 화면에 로그인을 붙였지만 서버가 토큰을 확인하지 않아서, 로그인하지 않아도 누구나 호출하면 메모 네 건을 받습니다. 로그인 화면은 신원 확인 연습일 뿐 자료를 막지 않습니다. 서버의 토큰 검증과 타인 자료 접근 차단은 다음 제작 단위·4단계에서 합니다.
- 서버 함수는 서버 전용 키로 읽으므로 RLS를 건너뜁니다. 이 키가 새면 표 전체가 열립니다. 키는 Vercel 환경변수에만 둡니다.
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
| 공개 API | `curl -s https://choi-bujang-secret-vault-hailey17.vercel.app/api/notes` | 메모가 **나옵니다**. 3단계 전까지 남는 약점입니다 |

`supabase/notes.sql`은 Git에서 빼 두었으므로 위 검색에 걸리지 않습니다. 이 파일을 커밋하면 GitHub 최신 파일에 메모 문장이 생기니, 커밋하지 마세요.

## 시작 틀 메모

`vercel.json`은 `public`을 배포하고 `npm run build`로 `public/aleph.json`을 만듭니다. `aleph.json`은 Vercel이 주는 저장소 소유자·이름, 커밋, 배포 주소를 담을 뿐이며, 이것만으로 저장소 소유나 방어 성공이 인정되지는 않습니다. `npm run build -- --local`은 이 파일을 만들지 않으므로 배포나 심판 접수를 증명하지 않습니다. `src/attack-check.mjs`는 `npm run bundle`이 실행하는 직접 점검이며 심판의 판정이 아닙니다. `src/decider.mjs`·`src/detect.mjs`의 로컬 시험도 반 엔진의 결과가 아닙니다.
