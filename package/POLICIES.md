# 검문소·탐지 규칙

실제로 구현한 규칙만 아래 표에 추가하세요. 규칙 이름, 단계, 어떤 요청을 막는지, 확인한 방법을 함께 적으세요.

| 규칙 | 단계 | 막는 공격 | 확인 방법 |
|---|---|---|---|
| `burst_failures` | 보너스 xdr-01 | T1110.001 비밀번호 추측: 규칙 수준 10 이상, 짧은 시간에 로그인 실패 30건 이상 | `npm run test:xdr` 시험 경보 28건에서 block (확신도 0.92) 확인. 심판의 판정이 아니라 로컬 확인 |
| `spray_many_accounts` | 보너스 xdr-01 | T1110.003 스프레이: 규칙 수준 10 이상, 여러 계정에 같은 비밀번호 대입 | `npm run test:xdr` 시험 경보 28건에서 block (0.90) 확인. 심판의 판정이 아니라 로컬 확인 |
| `failures_then_success` | 보너스 xdr-01 | T1110: 실패 뒤 성공, 규칙 수준 5~9, 건수가 적어 사용자 오타와 구분되지 않음 | `npm run test:xdr` 시험 경보 28건에서 alert (0.58) 확인. 심판의 판정이 아니라 로컬 확인 |
| `lockout_retry` | 보너스 xdr-01 | T1110: 계정 잠금 뒤 재시도, 건수가 적어 단정하지 않음 | `npm run test:xdr` 시험 경보 28건에서 alert (0.62) 확인. 심판의 판정이 아니라 로컬 확인 |
| `low_volume_failures` | 보너스 xdr-01 | T1110: 적은 건수(3~29)의 실패, 자동 대입과 사용자 실수를 구분할 수 없음 | `npm run test:xdr` 시험 경보 28건에서 alert (0.50) 확인. 심판의 판정이 아니라 로컬 확인 |
| `repeated_injection_marks` | 보너스 xdr-02 | T1190: 규칙 수준 10 이상, 같은 주소에서 주입 표기가 8번 이상 반복 | `npm run test:xdr` 시험 경보 26건에서 block (확신도 0.88) 확인. 심판의 판정이 아니라 로컬 확인 |
| `sql_injection_repeat` | 보너스 xdr-02 | T1190: 요청 인자에 SQL 구문을 이어 붙인 시도의 반복 | `npm run test:xdr` 시험 경보 26건에서 block (0.92 이상) 확인. 심판의 판정이 아니라 로컬 확인 |
| `script_tag_repeat` | 보너스 xdr-02 | T1190: 요청 인자에 스크립트 태그를 넣는 시도의 반복 | `npm run test:xdr` 시험 경보 26건에서 block (0.92 이상) 확인. 심판의 판정이 아니라 로컬 확인 |
| `path_traversal_repeat` | 보너스 xdr-02 | T1190: 경로를 거슬러 올라가는 ../ 표기의 반복 | `npm run test:xdr` 시험 경보 26건에서 block (0.92 이상) 확인. 심판의 판정이 아니라 로컬 확인 |
| `payload_in_url_repeat` | 보너스 xdr-02 | T1190: 요청 주소를 디코딩하면 SQL 구문·스크립트 태그·../ 반복이 있고 5번 이상 반복(시험 문자열로만 확인, 경보 26건에는 해당 없음) | `npm run test:xdr` 시험 경보 26건에서 block (0.92) 확인. 심판의 판정이 아니라 로컬 확인 |
| `single_injection_mark` | 보너스 xdr-02 | T1190: 주입처럼 보이는 표기가 1~3번뿐이라 수업 단어와 구분할 수 없음 | `npm run test:xdr` 시험 경보 26건에서 alert (0.50) 확인. 심판의 판정이 아니라 로컬 확인 |
| `device_registered` | 6단계 | 등록하지 않은 기기의 요청(`deviceRegistered`가 `true`가 아님) | `npm run decider:test`에서 등록 기기 `allow`, 미등록 가상 요청 `deny`·`device_not_registered` 확인. 심판의 판정이 아니라 로컬 확인 |
| `step_up_required` | 7단계 | 평소와 다른 시각(23~5시)·처음 보는 네트워크(`unusual`)·최근 5분 사건 10건 이상이 함께 있는 가상 사건(막지 않고 추가 확인) | `npm run decider:test`(복합 이상 `step_up`, 다시 확인 `allow`), `npm run fixture:7`, `npm run test:decider`. 심판의 판정이 아니라 로컬 확인. 실제 재로그인 확인·자료 차단은 미실행 |
| `resource_zone` | 8단계 | 허용 목록에 없는 구역·경로·메서드(메모 전체 목록·추가, 반 공지 쓰기, 강사 자료 전체, 알 수 없는 경로) | `npm run test:decider`(구역 시험 10개)·`npm run decider:test`. 메모는 자료 ID 하나를 고르는 경로만, 반 공지는 읽기만 허용. 심판의 판정이 아니라 로컬 확인 |
| `burst_read` | 9단계 | 같은 가상 사용자(`identity.sub`)의 `GET`이 어느 10분 구간에서든 120건을 넘는 폭주 조회(회수 제안) | `npm run detect:test` 6항목, `npm run test:detect`. 가상 사건 연습이며 심판의 판정도 실제 접속 회수도 아님 |

브라우저에서 버튼을 숨기는 것만으로 서버 접근이 차단됐다고 적지 마세요.
