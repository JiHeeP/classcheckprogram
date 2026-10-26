import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, MathError, MathPracticeClient, parseNames, kstDayRange } from '../public/js/lib/mathpractice.js';
import { fakeFirestoreFetch, sampleDb, kstMillis, weekDb, WEEK_DAYS as DAYS } from './fake-firestore.js';

// 한국 시간 2026-10-11(일) 오전 → 이전 등교일 10/8(목)
const NOW = new Date('2026-10-11T00:30:00Z');

test('이전 등교일에 안 한 학생', async () => {
  const r = await buildReport({ classCode: 'test01', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.equal(r.classCode, 'TEST01');
  assert.equal(r.dateKey, '2026-10-08');
  assert.equal(r.dateLabel, '10/8 (목)');
  // 12번은 L27 통과라 빠지고, '테스트'(99번)는 아직 제외 목록이 없어서 남음
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '7', '99']);
  assert.deepEqual(r.graduated.map((s) => s.no), ['12']);
  assert.equal(r.total, 18);
  assert.equal(r.done, 15); // 4번은 기록이 없어도 접속해서 '했다'로 셈
  assert.equal(r.accessOnly, 1);
  assert.equal(r.todayOff, '주말');
});

test('접속만 해도 했다: 4번 포함, 다른 날 접속(7번)은 안 셈', async () => {
  const r = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.ok(!r.missing.some((s) => s.no === '4'));
  assert.ok(r.missing.some((s) => s.no === '7'));
});

test('접속 기록의 하루 범위는 한국 시간 0시~24시', async () => {
  const [start, end] = kstDayRange('2026-10-08');
  assert.equal(start, kstMillis('2026-10-08', 0, 0));
  assert.equal(end, kstMillis('2026-10-09', 0, 0));
  const db = sampleDb('2026-10-08');
  db.TEST01.logs = [
    { studentNo: '3', ts: start },            // 0시 정각 → 포함
    { studentNo: '7', ts: end },              // 다음 날 0시 → 제외
    { studentNo: '4', ts: start - 1 },        // 전날 23:59:59.999 → 제외
  ];
  const r = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(db) });
  assert.ok(!r.missing.some((s) => s.no === '3'), '0시 정각 접속은 셈');
  assert.ok(r.missing.some((s) => s.no === '7'), '다음 날 접속은 안 셈');
  assert.ok(r.missing.some((s) => s.no === '4'), '전날 접속은 안 셈 (이날 기록도 없음)');
});

test('항상 제외할 이름은 세지 않음', async () => {
  const r = await buildReport({
    classCode: 'TEST01', now: NOW, excludeNames: ['테스트', '송예준'],
    fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')),
  });
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '7']);
  assert.deepEqual(r.excluded.map((s) => s.name), ['송예준', '테스트']);
  assert.equal(r.total, 16); // 19명 - L27 통과 1 - 제외 2
  assert.equal(r.done, 14);
});

test('L27 통과 점수(216) 미달이나 자유 연습은 통과로 안 봄', async () => {
  const r = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.ok(r.missing.some((s) => s.no === '3'));
  assert.ok(r.missing.some((s) => s.no === '7'));
});

test('이름 목록 읽기', () => {
  assert.deepEqual(parseNames('전지현\n테스트, 김민준 # 메모\n\n전지현'), ['전지현', '테스트', '김민준']);
});

test('우리 반 명단 이름이 우선', async () => {
  const r = await buildReport({
    classCode: 'TEST01', now: NOW, roster: [{ no: '3', name: '박도윤(우리반)' }],
    fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')),
  });
  assert.equal(r.missing[0].name, '박도윤(우리반)');
});

test('반 설정의 등교 안 하는 날 반영', async () => {
  const db = sampleDb('2026-10-07');
  db.TEST01.offDays = ['2026-10-08'];
  const r = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(db) });
  assert.equal(r.dateKey, '2026-10-07');
});

test('명단 여러 페이지', async () => {
  const fetch = fakeFirestoreFetch(sampleDb('2026-10-08'), { pageSize: 5 });
  const students = await new MathPracticeClient('TEST01', { fetchImpl: fetch }).fetchStudents();
  assert.equal(students.length, 19);
  assert.equal(students[18].no, '99');
});

test('오류 구분: 없는 반 / 사용량 초과 / 연결 실패', async () => {
  await assert.rejects(buildReport({ classCode: 'NOPE00', now: NOW, fetchImpl: fakeFirestoreFetch({}) }),
    (e) => e instanceof MathError && e.code === 'notfound');
  await assert.rejects(buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch({}, { status: 429 }) }),
    (e) => e.code === 'quota' && /오후 4시/.test(e.message));
  await assert.rejects(buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    (e) => e.code === 'network');
  await assert.rejects(buildReport({ classCode: '', now: NOW }), (e) => e.code === 'nocode');
});

// ---------------------------------------------------------------------------
// 누적 (벌 대상)
// ---------------------------------------------------------------------------

// 한국 시간 2026-10-16(금) 08:30 → 이전 등교일 10/15. 10/8 부터 등교일: 10/8, 10/12, 10/13, 10/14, 10/15 (10/9 한글날)
const FRI = new Date('2026-10-15T23:30:00Z');

const MISSES = {
  3: DAYS,                                           // 5번 안 함
  5: ['2026-10-12', '2026-10-13', '2026-10-14'],     // 3번
  6: ['2026-10-08', '2026-10-12'],                   // 2번
  7: DAYS,                                           // 5번이지만 10/13 까지 해제
  12: DAYS,                                          // 통과한 학생이라 세지 않음
  99: DAYS,                                          // 제외 이름
};
const baseArgs = () => ({
  classCode: 'TEST01', now: FRI, excludeNames: ['테스트'], fetchImpl: fakeFirestoreFetch(weekDb(MISSES)),
});

test('누적: 10/8 부터 등교일마다 안 한 날을 센다 (접속만 한 학생은 안 센다)', async () => {
  const r = await buildReport(baseArgs());
  assert.equal(r.dateKey, '2026-10-15');
  assert.equal(r.countedDays, 5);
  assert.equal(r.counts['3'], 5);
  assert.equal(r.counts['5'], 3);
  assert.equal(r.counts['6'], 2);
  assert.equal(r.counts['7'], 5);
  assert.equal(r.counts['4'], 0, '접속만 해도 한 날');
  assert.equal(r.counts['1'], 0);
  assert.equal(r.counts['12'], undefined, '마지막 단계 통과 학생은 세지 않음');
  assert.equal(r.counts['99'], undefined, '제외 이름은 세지 않음');
});

test('누적 3번 이상은 overLimit 에 많은 순으로', async () => {
  const r = await buildReport(baseArgs());
  assert.deepEqual(r.overLimit.map((s) => [s.no, s.count]), [['3', 5], ['7', 5], ['5', 3]]);
  assert.deepEqual(r.watch.map((s) => [s.no, s.count]), [['6', 2]], '1회 이상 기준 미만은 지켜보기');
  assert.equal(r.limit, 3);
  const two = await buildReport({ ...baseArgs(), limit: 2 });
  assert.deepEqual(two.overLimit.map((s) => s.no), ['3', '7', '5', '6']);
});

test('해제: 그 날까지의 횟수는 지우고 다음 등교일부터 다시 센다', async () => {
  const r = await buildReport({ ...baseArgs(), cleared: { 7: '2026-10-13', 3: '2026-10-15' } });
  assert.equal(r.counts['7'], 2, '10/14, 10/15 두 번만');
  assert.equal(r.counts['3'], 0, '마지막 날까지 해제 → 0부터');
  assert.deepEqual(r.overLimit.map((s) => s.no), ['5']);
});

test('누적 시작일이 이전 등교일보다 뒤면 아직 세지 않음, 시작일이 중간이면 그 날부터', async () => {
  const none = await buildReport({ ...baseArgs(), countStart: '2026-10-16' });
  assert.equal(none.countedDays, 0);
  assert.equal(none.counts['3'], 0);
  assert.deepEqual(none.overLimit, []);
  const mid = await buildReport({ ...baseArgs(), countStart: '2026-10-13' });
  assert.equal(mid.countedDays, 3);
  assert.equal(mid.counts['3'], 3);
  assert.equal(mid.counts['6'], 0);
});

test('지난 날짜는 저장해 두고 다시 조회하지 않음', async () => {
  const saved = {};
  const dayCache = {
    load: async () => ({ ...saved }),
    save: async (_code, all) => { Object.assign(saved, all); },
  };
  const first = fakeFirestoreFetch(weekDb(MISSES));
  const r1 = await buildReport({ ...baseArgs(), fetchImpl: first, dayCache });
  assert.deepEqual(Object.keys(saved).sort(), DAYS);
  assert.equal(first.calls.length, 5 + 4 * 2, '반·명단·이전 등교일(기록·접속)·L27 + 지난 4일 × 2');

  const second = fakeFirestoreFetch(weekDb(MISSES));
  const r2 = await buildReport({ ...baseArgs(), fetchImpl: second, dayCache });
  assert.equal(second.calls.length, 5, '저장된 날짜는 다시 안 부름');
  assert.deepEqual(r2.counts, r1.counts);
});

test('오늘 받은 반·명단·L27·이전 등교일 기록은 하루 동안 다시 안 부름 (새로고침·다음 날은 다시)', async () => {
  let saved = null;
  const baseCache = {
    load: async () => saved,
    save: async (_code, b) => { saved = JSON.parse(JSON.stringify(b)); },
  };
  const first = fakeFirestoreFetch(sampleDb('2026-10-08'));
  const r1 = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: first, baseCache });
  assert.equal(first.calls.length, 6, '반·명단·L27·이전 등교일(기록·접속)·그날 통과한 L3 의 예전 기록');
  assert.equal(saved.date, '2026-10-11');
  assert.equal(saved.prev, '2026-10-08');

  const later = new Date(NOW.getTime() + 5 * 3600 * 1000);
  const second = fakeFirestoreFetch(sampleDb('2026-10-08'));
  const r2 = await buildReport({ classCode: 'TEST01', now: later, fetchImpl: second, baseCache, excludeNames: ['테스트'] });
  assert.equal(second.calls.length, 0, '같은 날은 저장한 것으로 계산');
  assert.deepEqual(r2.missing.map((s) => s.no), ['3', '7'], '설정(제외 이름)이 바뀌어도 다시 계산됨');
  assert.deepEqual(r2.graduated, r1.graduated);
  assert.equal(r2.accessOnly, r1.accessOnly);
  assert.deepEqual(r2.progress, r1.progress, '레벨·점수도 저장한 것으로');

  const third = fakeFirestoreFetch(sampleDb('2026-10-08'));
  await buildReport({ classCode: 'TEST01', now: later, fetchImpl: third, baseCache, refresh: true });
  assert.equal(third.calls.length, 6, '새로고침은 새로 받음');

  const offDay = fakeFirestoreFetch(sampleDb('2026-10-08'));
  const r4 = await buildReport({ classCode: 'TEST01', now: later, fetchImpl: offDay, baseCache, offDays: ['2026-10-08'] });
  assert.equal(offDay.calls.length, 2, '쉬는 날을 고쳐 이전 등교일이 바뀌면 그날 기록만 새로');
  assert.equal(r4.dateKey, '2026-10-07');

  const tomorrow = fakeFirestoreFetch(sampleDb('2026-10-08'));
  await buildReport({ classCode: 'TEST01', now: new Date('2026-10-11T23:30:00Z'), fetchImpl: tomorrow, baseCache });
  assert.equal(tomorrow.calls.length, 6, '다음 날은 새로 받음');

  saved = { ...saved, date: '2026-10-12', finalPassed: ['12'], withRecord: ['1'] }; // 레벨·점수 넣기 전 형식
  delete saved.prevRows;
  const oldFormat = fakeFirestoreFetch(sampleDb('2026-10-08'));
  const r5 = await buildReport({ classCode: 'TEST01', now: new Date('2026-10-11T23:30:00Z'), fetchImpl: oldFormat, baseCache });
  assert.equal(oldFormat.calls.length, 6, '예전 형식으로 저장된 것은 버리고 새로 받음');
  assert.ok(r5.progress.length > 0);
});

// ---------------------------------------------------------------------------
// 레벨·점수
// ---------------------------------------------------------------------------

test('레벨·점수: 그날 처음 통과한 레벨은 레벨 상승, 전에 통과한 레벨은 점수만', async () => {
  const db = sampleDb('2026-10-08');
  const res = db.TEST01.results;
  res.push(
    { dateKey: '2026-09-01', studentNo: '1', mode: 'challenge', level: 'L3', score: 98 },  // 1번은 L3 를 전에 통과
    { dateKey: '2026-10-08', studentNo: '2', mode: 'challenge', level: 'L4', score: 80 },  // 같은 날 L4 도전 (통과 미달)
    { dateKey: '2026-10-08', studentNo: '2', mode: 'challenge', level: 'L4', score: 90 },  // 같은 레벨은 높은 점수만
    { dateKey: '2026-10-08', studentNo: '6', mode: 'challenge', level: 'L5', score: 110, totalQuestions: 10 }, // 문제 수 미달
    { dateKey: '2026-10-08', studentNo: '6', mode: 'aborted', level: 'L5', score: null },
  );
  const r = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(db) });
  const by = Object.fromEntries(r.progress.map((s) => [s.no, s]));

  assert.equal(by['1'].levelUp, null, '전에 통과한 레벨은 상승 아님');
  assert.deepEqual(by['1'].scores, [{ level: 'L3', score: 100 }]);
  assert.deepEqual(by['2'].levelUp, { passed: 'L3', next: 'L4' });
  assert.deepEqual(by['2'].scores, [{ level: 'L3', score: 100 }, { level: 'L4', score: 90 }]);
  assert.deepEqual(by['5'].scores, [], '자유 연습은 점수 없음');
  assert.deepEqual(by['5'].practice, ['L3']);
  assert.equal(by['5'].levelUp, null);
  assert.deepEqual(by['6'].practice, ['L5'], '중도 포기·문제 수 미달은 점수로 안 침');
  assert.equal(by['4'].accessOnly, true);
  assert.ok(!by['3'] && !by['7'], '안 한 학생은 없음');
  assert.equal(r.levelUps, 12, '기록 있는 14명 중 1번(전에 통과)·5번(연습) 빼고');
  assert.equal(r.progress[0].no, '2', '레벨 상승이 먼저');
  assert.deepEqual(r.progress.slice(-2).map((s) => s.no), ['4', '5'], '점수 없는 학생은 뒤로');
});

test('레벨 상승 판정: 통과 점수는 만점 - 허용 오답 × 2 (문제 10개 이하는 1개)', async () => {
  const { passScore, nextLevel } = await import('../public/js/lib/mathpractice.js');
  assert.equal(passScore('L27'), 216);
  assert.equal(passScore('L28'), 223, 'L28 만점 225, 10문제라 오답 1개');
  assert.equal(passScore('L36'), 261);
  assert.equal(passScore('L9-2'), 131);
  assert.equal(nextLevel('L27'), 'L28');
  assert.equal(nextLevel('L9'), 'L9-2');
  assert.equal(nextLevel('L36'), '');
});

// ---------------------------------------------------------------------------
// L28~L36 추가: 10/28 화면(10/27 기록)부터 L27 통과 학생도 센다
// ---------------------------------------------------------------------------

test('L27 통과 학생: 10/27 화면까지는 빼고, 10/28 화면부터 센다 (누적은 10/27 기록부터)', async () => {
  const days = ['2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27'];
  const students = [{ no: '1', name: '김민준' }, { no: '12', name: '오수아' }, { no: '13', name: '서이준' }, { no: '99', name: '테스트' }];
  const results = [
    { dateKey: '2026-09-01', studentNo: '12', mode: 'challenge', level: 'L27', score: 220 },
    { dateKey: '2026-10-27', studentNo: '13', mode: 'challenge', level: 'L27', score: 218 }, // 10/27 에 처음 통과
  ];
  for (const d of days) results.push({ dateKey: d, studentNo: '1', mode: 'free', level: 'L3', score: null });
  const db = { TEST01: { name: '5학년 4반', offDays: [], students, results, logs: [] } };
  const args = { classCode: 'TEST01', excludeNames: ['테스트'], countStart: '2026-10-22', fetchImpl: fakeFirestoreFetch(db) };

  const tue = await buildReport({ ...args, now: new Date('2026-10-26T23:30:00Z') }); // 10/27(화) 화면 → 10/26 기록
  assert.equal(tue.dateKey, '2026-10-26');
  assert.deepEqual(tue.graduated.map((s) => s.no), ['12'], '10/27 화면은 지금처럼 L27 통과 학생을 뺌');
  assert.deepEqual(tue.missing.map((s) => s.no), ['13']);
  assert.equal(tue.counts['12'], undefined);
  assert.equal(tue.counts['13'], 3, '13번은 아직 L27 통과 전이라 원래대로 셈');

  const wed = await buildReport({ ...args, now: new Date('2026-10-27T23:30:00Z') }); // 10/28(수) 화면 → 10/27 기록
  assert.equal(wed.dateKey, '2026-10-27');
  assert.deepEqual(wed.graduated, [], '10/28 화면부터는 항상 뺄 이름만 빼고 모두 셈');
  assert.deepEqual(wed.missing.map((s) => s.no), ['12']);
  assert.equal(wed.total, 3);
  assert.equal(wed.counts['12'], 1, '누적은 10/27 기록부터 (그 전은 빠지던 날)');
  assert.equal(wed.counts['13'], 3, '10/27 이후 통과한 학생은 그 전 날도 원래대로 셈');
  assert.deepEqual(wed.excluded.map((s) => s.name), ['테스트']);
});
