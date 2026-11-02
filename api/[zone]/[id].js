// /api/<구역>/<id> 두 단계 가운데 다른 파일이 받지 않는 경로(공지·강사 자료 등)를 JSON 으로 거부한다.
// /api/notes/<id> 는 api/notes/[id].js 가 먼저 받는다.
export { default } from '../../src/zones-function.mjs';
