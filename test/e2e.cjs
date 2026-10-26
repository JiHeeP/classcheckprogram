// 브라우저로 사이트 전체를 눌러 보는 테스트 (Playwright + Firestore 에뮬레이터)
//   1) 에뮬레이터:   npx firebase emulators:start --only firestore --project demo-classroom
//   2) 사이트:       npm run dev
//   3) 이 테스트:    node test/e2e.cjs [스크린샷 폴더]
// 분수 연산 마스터는 가짜 응답으로 바꿔서 확인한다.

const { chromium } = require('playwright');
const path = require('node:path');

const SITE = process.env.SITE || 'http://localhost:3000';
const EMU = process.env.EMU || 'localhost:8080';
const SHOTS = process.argv[2] || null;
const ROOM = `e2e${Date.now()}`;
const URL0 = `${SITE}/?emulator=${EMU}&room=${ROOM}`;

const assert = (cond, msg) => {
  if (!cond) throw new Error(`실패: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function main() {
  const { fakeFirestoreFetch, sampleDb, SAMPLE_NAMES } = await import('./fake-firestore.js');
  const { SchoolCalendar, todayKST } = await import('../public/js/lib/schoolday.js');
  const { ALL_COUNT_FROM } = await import('../public/js/lib/mathpractice.js');
  const prev = new SchoolCalendar().prevSchoolDay(todayKST());
  // 10/28 화면부터는 L27 통과 학생(12번 오수아)도 세서 안 한 학생이 3명
  const allCount = todayKST() >= ALL_COUNT_FROM;
  const missingCount = allCount ? 3 : 2;
  const fakeMath = fakeFirestoreFetch(sampleDb(prev));

  // 프록시가 있는 환경이면 localhost 만 프록시를 거치지 않게 (Playwright 의 proxy 옵션은 localhost 도 프록시로 보냄)
  const args = process.env.HTTPS_PROXY
    ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1']
    : [];
  const browser = await chromium.launch({ args });
  const board = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, hasTouch: true, isMobile: true });

  for (const c of [board, phone]) {
    await c.route('https://firestore.googleapis.com/v1/projects/mathpractice-1d8f9/**', async (route) => {
      const req = route.request();
      const res = await fakeMath(req.url(), { method: req.method(), body: req.postData() });
      await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    });
  }

  const page = await board.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  console.log('우리 반: 명단 넣기');
  await page.goto(`${URL0}#check`);
  await page.getByText('학생 명단이 아직 없어요').waitFor();
  await shot(page, '00-empty');
  await page.getByRole('button', { name: '명단 넣으러 가기' }).click();
  await page.getByText('여러 명 한꺼번에 붙여넣기').click();
  await page.locator('textarea.paste').fill(SAMPLE_NAMES.map((n, i) => `${i + 1} ${n}`).join('\n'));
  await page.getByRole('button', { name: '붙여넣은 명단 적용' }).click();
  await page.getByRole('button', { name: '바꾸기', exact: true }).click();
  await page.getByRole('button', { name: '명단 저장' }).click();
  await page.getByText('학생 명단 (18명)').waitFor();
  assert(true, '18명 명단 저장');

  await page.locator('input.code-input').nth(1).fill('test01');
  await page.getByLabel('반 이름 (맨 위에 보여요)').fill('5학년 4반');
  await page.getByRole('button', { name: '설정 저장' }).click();
  await page.locator('#class-name', { hasText: '5학년 4반' }).waitFor();
  assert(true, '반 이름·수학 반 코드 저장');
  await shot(page, '04-class');

  console.log('과제 체크');
  await page.getByRole('link', { name: '과제 체크' }).click();
  await page.getByRole('button', { name: '+ 과제 만들기' }).click();
  await page.getByLabel('과제 이름').fill('수학 익힘책 34쪽');
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await page.locator('.page-title', { hasText: '수학 익힘책 34쪽' }).waitFor();
  const tiles = page.locator('.tile-grid .tile');
  assert(await tiles.count() === 18, '이름 칸 18개');

  // 폰에서도 같이 열어 둔다 (실시간 반영 확인)
  const p2 = await phone.newPage();
  await p2.goto(`${URL0}#check`);
  await p2.locator('.page-title', { hasText: '수학 익힘책 34쪽' }).waitFor();

  for (const i of [0, 1, 2, 4, 5]) await tiles.nth(i).click();
  await page.waitForTimeout(500);
  assert(await page.locator('.tile.done').count() === 5, '5칸 터치 → 완료 5');
  await tiles.nth(4).click(); // 다시 누르면 해제
  await page.locator('.count strong', { hasText: '4' }).waitFor();
  assert(true, '다시 터치 → 해제 (4 / 18)');

  // 같은 칸을 아주 빠르게 두 번(전자칠판 이중 입력) → 한 번만 반영
  await tiles.nth(8).dblclick();
  await page.waitForTimeout(600);
  assert(await tiles.nth(8).evaluate((n) => n.classList.contains('done')), '이중 터치는 한 번으로 처리');

  await p2.locator('.count strong', { hasText: '5' }).waitFor({ timeout: 6000 });
  assert(true, '폰 화면에 실시간 반영 (5 / 18)');
  await shot(page, '01-check');
  await shot(p2, '01-check-phone');

  // 두 번째 과제: 과제별로 따로 체크
  await page.getByRole('button', { name: '+ 새 과제' }).click();
  await page.getByLabel('과제 이름').fill('받아쓰기');
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await page.locator('.page-title', { hasText: '받아쓰기' }).waitFor();
  assert(await page.locator('.tile.done').count() === 0, '새 과제는 따로 체크');
  await page.locator('.chip', { hasText: '수학 익힘책 34쪽' }).click();
  assert(await page.locator('.tile.done').count() === 5, '과제를 바꿔도 기록 유지');

  console.log('번호 뽑기');
  await page.getByRole('link', { name: '번호 뽑기' }).click();
  await page.getByRole('button', { name: '+ 새 뽑기' }).first().click();
  await page.getByLabel('이름', { exact: true }).fill('10월 자리');
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await page.locator('.page-title', { hasText: '10월 자리' }).waitFor();
  await page.locator('.pick-grid .tile').first().click();
  await page.locator('.reveal-number.spinning').waitFor();
  await shot(page, '02-draw-spinning');
  await page.locator('.reveal-number.done').waitFor({ timeout: 6000 });
  const n1 = Number(await page.locator('.reveal-number').textContent());
  assert(n1 >= 1 && n1 <= 18, `김민준 → ${n1}번`);
  await shot(page, '02-draw-reveal');
  await page.getByRole('button', { name: '확인', exact: true }).click();

  // 같은 학생 다시 → 막힘
  await page.locator('.pick-grid .tile').first().click();
  await page.locator('.toast', { hasText: '이미' }).waitFor();
  assert(true, '같은 학생은 다시 못 뽑음');

  // 폰에서 다른 학생이 동시에 뽑기
  await p2.getByRole('link', { name: '번호 뽑기' }).click();
  await p2.locator('.pick-grid .tile').nth(1).click();
  await p2.locator('.reveal-number.done').waitFor({ timeout: 6000 });
  const n2 = Number(await p2.locator('.reveal-number').textContent());
  assert(n2 !== n1, `폰에서 이서연 → ${n2}번 (겹치지 않음)`);
  await p2.getByRole('button', { name: '확인', exact: true }).click();

  await page.getByRole('tab', { name: '결과' }).click();
  await page.locator('.result-cell.taken').nth(1).waitFor({ timeout: 6000 });
  assert(await page.locator('.result-cell').count() === 18, '결과표 1~18번');
  assert(await page.locator('.result-cell.taken').count() === 2, '뽑은 2명 자동 기록');
  await shot(page, '02-draw-result');

  console.log('수학 확인');
  await page.getByRole('link', { name: '수학 확인' }).click();
  await page.locator('.name-chip').first().waitFor({ timeout: 10000 });
  const names = await page.locator('.name-chip').allTextContents();
  assert(names.length === missingCount && names.join(',').includes('박도윤'), `안 한 학생 ${missingCount}명: ${names.join(', ')}`);
  const skip = await page.locator('.math-notes', { hasText: '세지 않음' }).textContent();
  if (allCount) assert(!skip.includes('오수아') && skip.includes('테스트'), `제외 이름만 빠짐 (${skip.trim()})`);
  else assert(skip.includes('오수아') && skip.includes('테스트'), `L27 통과·제외 학생은 빠짐 (${skip.trim()})`);
  const prog = await page.locator('.progress-row').allTextContents();
  assert(prog.length === 15, `레벨·점수: 한 학생 15명 (${prog.length}명)`);
  assert(await page.locator('.progress-row.up').count() === 13, '그날 처음 L3 를 통과한 13명은 레벨 상승');
  assert(prog[0].includes('L3 통과 → L4') && prog[0].includes('L3 100점'), `레벨 상승·점수 같이 보임 (${prog[0]})`);
  assert(prog.some((t) => t.includes('L3 연습')) && prog.some((t) => t.includes('접속만')), '연습만·접속만도 구분');
  await shot(page, '03-math');

  console.log('누적 벌 대상: 설정 → 큰 이름 → 해제');
  await page.getByRole('link', { name: '우리 반' }).click();
  await page.getByLabel('누적 세기 시작일').fill(prev);
  await page.getByLabel('벌 기준 횟수').fill('1');
  await page.getByRole('button', { name: '설정 저장' }).click();
  await page.locator('.toast', { hasText: '설정을 저장했어요' }).waitFor();
  await page.getByRole('link', { name: '수학 확인' }).click();
  await page.locator('.penalty-card').first().waitFor({ timeout: 10000 });
  const cards = await page.locator('.penalty-card').allTextContents();
  assert(cards.length === missingCount && cards.join(' ').includes('박도윤') && cards.join(' ').includes('조하준'), `누적 1회 이상 ${missingCount}명이 아래에 따로: ${cards.join(' / ')}`);
  assert(cards[0].includes('누적 1회'), '누적 횟수가 같이 보임');
  const bigName = await page.locator('.penalty-name').first().evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  const chipName = await page.locator('.name-chip').first().evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  assert(bigName > chipName, `벌 대상 이름이 위쪽 목록보다 큼 (${bigName}px > ${chipName}px)`);
  await shot(page, '03-math-penalty');
  await page.locator('.penalty-card', { hasText: '박도윤' }).getByRole('button', { name: /해제/ }).click();
  await page.getByRole('button', { name: '해제하고 0부터', exact: true }).click();
  await page.locator('.penalty-card', { hasText: '박도윤' }).waitFor({ state: 'detached', timeout: 10000 });
  await page.waitForFunction((n) => document.querySelectorAll('.penalty-card').length === n, missingCount - 1, { timeout: 10000 });
  assert(await page.locator('.penalty-card', { hasText: '조하준' }).count() === 1, '해제한 학생만 빠지고 다른 학생은 그대로');
  assert(await page.locator('.name-chip', { hasText: '박도윤' }).count() === 1, '위쪽 "안 한 학생"에는 그대로 있음 (해제는 누적만 0으로)');
  await shot(page, '03-math-cleared');

  console.log('오프라인');
  await board.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.locator('.banner-error').waitFor();
  assert(true, '인터넷이 끊기면 빨간 띠');
  await page.getByRole('link', { name: '과제 체크' }).click();
  await page.locator('.tile-grid .tile').nth(10).click();
  await page.waitForTimeout(300);
  assert(await page.locator('.tile.done').count() === 6, '오프라인에서도 체크가 바로 보임');
  await board.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await p2.getByRole('link', { name: '과제 체크' }).click();
  await p2.locator('.chip', { hasText: '수학 익힘책 34쪽' }).click();
  await p2.locator('.count strong', { hasText: '6' }).waitFor({ timeout: 30000 });
  assert(true, '다시 연결되면 다른 기기에 반영');

  console.log('과제 저장 · 지난 기록');
  await page.locator('.chip', { hasText: '수학 익힘책 34쪽' }).click();
  await page.getByRole('button', { name: '💾 저장하고 새 과제' }).click();
  await page.getByLabel('과제 이름').fill('일기 쓰기');
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await page.locator('.page-title', { hasText: '일기 쓰기' }).waitFor();
  assert(await page.locator('.chip', { hasText: '수학 익힘책 34쪽' }).count() === 0, '저장한 과제는 체크 화면에서 빠지고 새 과제가 열림');
  await shot(page, '01-check-after-save');
  await page.getByRole('button', { name: /지난 기록/ }).click();
  await page.locator('.record-card', { hasText: '수학 익힘책 34쪽' }).waitFor();
  await shot(page, '01-records');
  await page.locator('.record-card', { hasText: '수학 익힘책 34쪽' }).click();
  assert(await page.locator('.tile.done').count() === 6, '지난 기록에 체크 6개 그대로');
  await page.locator('.tile-grid .tile').nth(16).click();
  await page.locator('.count strong', { hasText: '7' }).waitFor();
  assert(true, '저장한 기록에서도 늦게 낸 학생 체크');
  await shot(page, '01-record-detail');
  await page.getByRole('button', { name: '다시 열기' }).click();
  await page.locator('.save-btn').waitFor();
  assert(await page.locator('.chip', { hasText: '수학 익힘책 34쪽' }).count() === 1, '다시 열면 체크 화면으로 돌아옴');

  console.log('학교 PC 팝업 (?popup=1)');
  const pop = await board.newPage();
  await pop.setViewportSize({ width: 560, height: 760 });
  await pop.goto(`${SITE}/?emulator=${EMU}&room=${ROOM}&popup=1`);
  await pop.locator('.name-chip').first().waitFor({ timeout: 10000 });
  assert(await pop.locator('.tabs').isHidden(), '팝업에는 메뉴 탭이 없음');
  const popNames = await pop.locator('.name-chip').allTextContents();
  assert(popNames.length === missingCount && popNames.join(',').includes('조하준'), `팝업에 안 한 학생 ${missingCount}명: ${popNames.join(', ')}`);
  await pop.locator('.progress-row.up').first().waitFor({ timeout: 10000 });
  assert(await pop.locator('.progress-row').count() === 15, '팝업에도 레벨·점수가 같이 보임');
  const popUp = await pop.locator('.progress-row.up').first().textContent();
  assert(popUp.includes('L3 통과 → L4') && popUp.includes('100점'), `팝업 레벨 상승·점수 (${popUp})`);
  await shot(pop, '05-popup');
  await pop.close();

  assert(errors.filter((e) => !/offline|ERR_INTERNET_DISCONNECTED|Could not reach Cloud Firestore/i.test(e)).length === 0,
    `페이지 오류 없음 ${errors.length ? `(무시한 오프라인 오류 ${errors.length}건)` : ''}`);
  await browser.close();
  console.log('모두 통과');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
