import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');
const text = path => readFile(join(root, path), 'utf8');

test('manifest 는 앱 이름·시작 주소·아이콘을 갖고 키나 토큰이 없다', async () => {
  const raw = await text('public/manifest.webmanifest');
  const manifest = JSON.parse(raw);
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192') && manifest.icons.some(icon => icon.sizes === '512x512'));
  assert.doesNotMatch(raw, /sb_publishable_|sb_secret_|eyJ[A-Za-z0-9_-]{12,}|token|password/iu);
  for (const icon of manifest.icons) {
    const bytes = await readFile(join(root, 'public', icon.src.slice(1)));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${icon.src} 는 PNG`);
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});

test('서비스 워커는 오프라인 안내 하나만 보관하고 /api 와 자료는 건드리지 않는다', async () => {
  const sw = await text('public/sw.js');
  assert.match(sw, /\/offline\.html/u);
  assert.match(sw, /request\.mode !== 'navigate'/u);
  const code = sw.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\/api|localStorage|sessionStorage|authorization/iu);
  assert.equal((sw.match(/cache\.add\(/gu) ?? []).length, 1, '캐시에 넣는 것은 한 건');
  assert.doesNotMatch(sw, /cache\.put|addAll/u);
  const offline = await text('public/offline.html');
  assert.match(offline, /인터넷에 연결되어 있지 않습니다/u);
  assert.doesNotMatch(offline, /<script/iu);
});

test('화면은 manifest 를 잇고, 기기 값을 브라우저 저장소에 넣지 않으며, 승인 전에는 메모를 불러오지 않는다', async () => {
  const html = await text('public/index.html');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/u);
  assert.match(html, /기기 승인 상태/u);
  assert.match(html, /오프라인이면 메모는 보이지 않고/u);
  assert.match(html, /앱으로 설치했다는 표시만으로는 기기를 믿지 않으며/u);
  // 브라우저 저장소에 쓰는 곳은 로그인 세션 하나뿐이다(기기 값·승인 상태는 저장하지 않는다).
  const storageUses = html.match(/(?:local|session)Storage\.[a-zA-Z]+\([^)]*\)/gu) ?? [];
  assert.ok(storageUses.every(use => use.includes('SESSION_KEY')), storageUses.join(' | '));
  assert.doesNotMatch(html, /localStorage|document\.cookie|indexedDB/u);
  // loadNotes 는 승인된 상태(showDevice('approved'))에서만 부른다.
  const calls = [...html.matchAll(/loadNotes\(\)/gu)].length;
  const approvedBranch = html.indexOf("if (status === 'approved') {\n        loadNotes();");
  assert.ok(approvedBranch > 0);
  const others = html.slice(0, approvedBranch) + html.slice(approvedBranch + 60);
  assert.ok(calls >= 3);
  assert.ok(!/showSession[\s\S]{0,400}loadNotes\(\)/u.test(html.slice(html.indexOf('const showSession'))), 'showSession 는 메모를 바로 불러오지 않는다');
  assert.ok(others.length > 0);
});
