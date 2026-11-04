import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReport, MathError, MathPracticeClient, parseNames, kstDayRange, absentKey, FINAL_LEVEL, FINAL_PASS_SCORE,
  STRICT_FROM, LEVEL_FROM, DONE_RULE, requiredLevel, addPasses,
} from '../public/js/lib/mathpractice.js';
import { SchoolCalendar } from '../public/js/lib/schoolday.js';
import { fakeFirestoreFetch, sampleDb, kstMillis, weekDb, WEEK_DAYS as DAYS } from './fake-firestore.js';

// 한국 시간 2026-10-11(일) 오전 → 이전 등교일 10/8(목)
const NOW = new Date('2026-10-11T00:30:00Z');

test('이전 등교일에 안 한 학생', async () => {
  const r = await buildReport({ classCode: 'test01', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.equal(r.classCode, 'TEST01');
  assert.equal(r.dateKey, '2026-10-08');
  assert.equal(r.dateLabel, '10/8 (목)');
  // 12번은 마지막 레벨(L36) 통과라 빠지고, '테스트'(99번)는 아직 제외 목록이 없어서 남음
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '7', '99']);
  assert.deepEqual(r.graduated.map((s) => s.no), ['12']);
  assert.equal(r.total, 18);
  assert.equal(r.done, 15); // 10/8 은 예전 기준이라 4번은 기록이 없어도 접속해서 '했다'로 셈
  assert.equal(r.accessOnly, 0, '예전 기준 날짜는 접속만 한 학생이 안 한 사람에 없음');
  assert.equal(r.todayOff, '주말');
});

test('예전 기준(STRICT_FROM 전): 접속만 해도 했다, 다른 날 접속(7번)은 안 셈', async () => {
  const r = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.ok(!r.missing.some((s) => s.no === '4'));
  assert.ok(r.missing.some((s) => s.no === '7'));
});

// ---------------------------------------------------------------------------
// 새 기준 (STRICT_FROM 부터): 접속만 한 학생은 '안 함'
// ---------------------------------------------------------------------------

// 한국 시간 2026-11-03(화) 08:30 → 이전 등교일 11/2(월)
const NOV3 = new Date('2026-11-02T23:30:00Z');

test('새 기준: 접속만 한 학생(4번)은 안 함으로 표시하고 accessOnly 를 붙임', async () => {
  assert.equal(STRICT_FROM, '2026-11-02');
  const r = await buildReport({ classCode: 'TEST01', now: NOV3, excludeNames: ['테스트'], fetchImpl: fakeFirestoreFetch(sampleDb('2026-11-02')) });
  assert.equal(r.dateKey, '2026-11-02');
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '4', '7']);
  assert.deepEqual(r.missing.map((s) => s.accessOnly), [false, true, false]);
  assert.equal(r.accessOnly, 1);
  assert.equal(r.total, 17);
  assert.equal(r.done, 14);
  assert.ok(!r.progress.some((s) => s.no === '4'), '레벨·점수에도 안 나옴');
});

// 10/29(목)·10/30(금)·11/2(월)·11/3(화). 4번은 매일 접속만 함
const NOV_DAYS = ['2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03'];
const NOV4 = new Date('2026-11-03T23:30:00Z'); // 한국 시간 11/4(수) 08:30 → 이전 등교일 11/3

test('새 기준 누적: STRICT_FROM 전 날짜는 접속만 해도 한 날, 그 뒤는 안 한 날', async () => {
  const r = await buildReport({
    classCode: 'TEST01', now: NOV4, excludeNames: ['테스트'], countStart: '2026-10-29',
    fetchImpl: fakeFirestoreFetch(weekDb({}, NOV_DAYS)),
  });
  assert.equal(r.countedDays, 4);
  assert.equal(r.counts['4'], 2, '11/2, 11/3 두 번만 (10/29, 10/30 은 예전 기준)');
  assert.equal(r.counts['1'], 0);
});

test('새 기준 누적: 예전 기준으로 저장한 새 날짜(11/2)는 버리고 다시 받고, 그 전 날짜는 그대로 씀', async () => {
  const old = Object.fromEntries(NOV_DAYS.slice(0, 3).map((d) => [d, ['1', '2', '4', '5']])); // 예전 기준: 4번 포함
  let saved = { ...old };
  const dayCache = { load: async () => ({ ...saved }), save: async (_c, all) => { saved = all; } };
  const fetch = fakeFirestoreFetch(weekDb({}, NOV_DAYS));
  const r = await buildReport({
    classCode: 'TEST01', now: NOV4, excludeNames: ['테스트'], countStart: '2026-10-29', fetchImpl: fetch, dayCache,
  });
  assert.equal(fetch.calls.length, 5 + 1, '반·명단·마지막 레벨·이전 등교일(기록·접속) + 11/2 기록만 (접속은 안 받음)');
  assert.equal(r.counts['4'], 2);
  assert.equal(r.counts['3'], 2, '10/29·10/30 저장본엔 3번이 없어서 안 한 날 그대로');
  assert.equal(saved.rule, DONE_RULE);
  assert.ok(!saved['2026-11-02'].includes('4'), '11/2 는 새 기준으로 다시 저장');
  assert.deepEqual(saved['2026-10-30'], ['1', '2', '4', '5'], '예전 날짜는 그대로');
});

// ---------------------------------------------------------------------------
// 자기 최고 레벨 (LEVEL_FROM 부터): 통과한 가장 높은 레벨의 다음 레벨을 풀어야 '했다'
// ---------------------------------------------------------------------------

test('자기 최고 레벨 = 그날 전까지 통과한 가장 높은 레벨의 다음 레벨', () => {
  const passes = addPasses({}, [
    { no: '1', dateKey: '2026-10-01', mode: 'challenge', level: 'L19', score: 180 },  // L19 통과 점수 176
    { no: '1', dateKey: '2026-10-02', mode: 'challenge', level: 'L20', score: 185 },  // L20 통과 점수 181
    { no: '1', dateKey: '2026-10-03', mode: 'challenge', level: 'L21', score: 150 },  // 통과 못 함
    { no: '1', dateKey: '2026-11-03', mode: 'challenge', level: 'L21', score: 190 },  // 이날 통과
    { no: '2', dateKey: '2026-10-01', mode: 'free', level: 'L5', score: null },       // 연습은 통과 아님
  ]);
  assert.deepEqual(passes, { 1: { L19: '2026-10-01', L20: '2026-10-02', L21: '2026-11-03' } });
  assert.equal(requiredLevel(passes['1'], '2026-11-03'), 'L21', '그날 통과한 것은 그날 기준에 안 들어감');
  assert.equal(requiredLevel(passes['1'], '2026-11-04'), 'L22');
  assert.equal(requiredLevel(passes['2'], '2026-11-04'), 'L1', '통과한 레벨이 없으면 L1');
  assert.equal(requiredLevel({ L9: '2026-09-01' }, '2026-11-04'), 'L9-2');
  assert.equal(requiredLevel({ L36: '2026-09-01' }, '2026-11-04'), '', '마지막 레벨 통과');
});

// 한국 시간 2026-11-04(수) 08:30 → 이전 등교일 11/3(화)
const NOV4_AM = new Date('2026-11-03T23:30:00Z');

function levelDb() {
  const db = sampleDb('2026-11-03');
  const res = db.TEST01.results;
  // 1번: L20 까지 통과 → L21 을 해야 함. 이날 L21 도전(통과 못 함) → 했다
  // 2번: L20 까지 통과, 이날 L10 연습·L8 도전만 → 안 함
  // 6번: L20 까지 통과, 이날 L21 연습만 → 했다 (연습도 그 레벨이면 인정)
  for (const no of ['1', '2', '6']) {
    for (const r of res.filter((x) => x.studentNo === no)) r.dateKey = '2026-10-01'; // 이날 L3 기록은 옛날로
    res.push({ dateKey: '2026-10-20', studentNo: no, mode: 'challenge', level: 'L20', score: 190 });
  }
  res.push(
    { dateKey: '2026-11-03', studentNo: '1', mode: 'challenge', level: 'L21', score: 150 },
    { dateKey: '2026-11-03', studentNo: '2', mode: 'free', level: 'L10', score: null },
    { dateKey: '2026-11-03', studentNo: '2', mode: 'challenge', level: 'L8', score: 120 },
    { dateKey: '2026-11-03', studentNo: '6', mode: 'free', level: 'L21', score: null },
  );
  return db;
}

test('자기 최고 레벨: 더 낮은 레벨만 풀면 안 함, 그 레벨을 풀면(통과 못 해도·연습이어도) 했다', async () => {
  assert.equal(LEVEL_FROM, '2026-11-03');
  const r = await buildReport({ classCode: 'TEST01', now: NOV4_AM, excludeNames: ['테스트'], fetchImpl: fakeFirestoreFetch(levelDb()) });
  assert.equal(r.dateKey, '2026-11-03');
  assert.equal(r.levelRule, true);
  assert.deepEqual(r.missing.map((s) => s.no), ['2', '3', '4', '7']);
  const two = r.missing.find((s) => s.no === '2');
  assert.deepEqual(two.lower, { did: 'L10', need: 'L21' }, '그날 푼 가장 높은 레벨과 해야 할 레벨');
  assert.equal(two.accessOnly, false);
  assert.equal(r.lowerLevel, 1);
  assert.equal(r.accessOnly, 1);
  const prog = Object.fromEntries(r.progress.map((s) => [s.no, s]));
  assert.equal(prog['2'].need, 'L21', '레벨·점수에도 남고 해야 할 레벨 표시');
  assert.equal(prog['1'].need, '');
  assert.equal(prog['6'].need, '');
});

test('자기 최고 레벨: LEVEL_FROM 전 날짜(11/2)는 낮은 레벨만 풀어도 했다', async () => {
  const db = levelDb();
  for (const r of db.TEST01.results) if (r.dateKey === '2026-11-03') r.dateKey = '2026-11-02';
  for (const l of db.TEST01.logs) l.ts -= 24 * 3600 * 1000;
  const r = await buildReport({ classCode: 'TEST01', now: NOV3, excludeNames: ['테스트'], fetchImpl: fakeFirestoreFetch(db) });
  assert.equal(r.dateKey, '2026-11-02');
  assert.equal(r.levelRule, false);
  assert.ok(!r.missing.some((s) => s.no === '2'));
});

test('자기 최고 레벨 누적: 11/3 부터 낮은 레벨만 푼 날을 센다', async () => {
  // 11/3, 11/4 둘 다 2번은 L8 만 함. 한국 시간 11/5(목) 08:30 → 이전 등교일 11/4
  const db = levelDb();
  db.TEST01.results.push({ dateKey: '2026-11-04', studentNo: '2', mode: 'challenge', level: 'L8', score: 120 });
  const r = await buildReport({
    classCode: 'TEST01', now: new Date('2026-11-04T23:30:00Z'), excludeNames: ['테스트'], countStart: '2026-11-03',
    fetchImpl: fakeFirestoreFetch(db),
  });
  assert.equal(r.countedDays, 2);
  assert.equal(r.counts['2'], 2);
  assert.equal(r.counts['1'], 1, '11/4 기록 없음 → 1번');
});

test('통과 기록은 저장해 두고 새 날짜 것만 더 읽음 (나눠 읽기도 끝까지)', async () => {
  const db = levelDb();
  // 1000건이 넘어도 끝까지 읽는지: 옛날 연습 기록 2500건
  for (let i = 0; i < 2500; i += 1) db.TEST01.results.push({ dateKey: '2026-09-15', studentNo: '9', mode: 'challenge', level: 'L1', score: 50 });
  db.TEST01.results.push({ dateKey: '2026-09-16', studentNo: '9', mode: 'challenge', level: 'L1', score: 90 });
  let saved = null;
  const passCache = { load: async () => saved && JSON.parse(JSON.stringify(saved)), save: async (_c, v) => { saved = JSON.parse(JSON.stringify(v)); } };
  const first = fakeFirestoreFetch(db);
  const r1 = await buildReport({ classCode: 'TEST01', now: NOV4_AM, excludeNames: ['테스트'], countStart: '2026-11-03', fetchImpl: first, passCache });
  assert.equal(saved.through, '2026-11-03', '어제까지 읽은 것으로');
  assert.equal(saved.passes['9'].L1, '2026-09-16', '1000건 넘게 나눠 읽어도 끝까지');
  const posts = (f) => f.calls.filter((c) => c.method === 'POST');
  const since = (f) => posts(f).filter((c) => c.body.includes('"op":"GREATER_THAN"'));
  assert.equal(posts(first).length, 3 + 2, '반 전체 도전 기록 3쪽(1000건씩) + 이전 등교일 기록·접속');
  assert.equal(since(first).length, 0);

  // 다음 날: 저장한 것에 11/4 기록만 더함. 11/4 에 2번이 L21 통과
  db.TEST01.results.push({ dateKey: '2026-11-04', studentNo: '2', mode: 'challenge', level: 'L21', score: 200 });
  const second = fakeFirestoreFetch(db);
  const r2 = await buildReport({
    classCode: 'TEST01', now: new Date('2026-11-04T23:30:00Z'), excludeNames: ['테스트'], countStart: '2026-11-04', fetchImpl: second, passCache,
  });
  assert.equal(since(second).length, 1, '반 전체를 다시 읽지 않고 11/3 다음 날부터만');
  assert.equal(posts(second).length, 1 + 2);
  assert.equal(saved.through, '2026-11-04');
  assert.equal(saved.passes['2'].L21, '2026-11-04');
  assert.ok(!r2.missing.some((s) => s.no === '2'), '11/4 에 L21 을 풀었으니 했다');
  assert.deepEqual(r1.missing.map((s) => s.no), ['2', '3', '4', '7']);
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
  assert.equal(r.total, 16); // 19명 - 마지막 레벨 통과 1 - 제외 2
  assert.equal(r.done, 14);
});

test('마지막 레벨 통과 점수(261) 미달이나 자유 연습은 통과로 안 봄', async () => {
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
  assert.deepEqual(Object.keys(saved).filter((k) => k !== 'rule').sort(), DAYS);
  assert.equal(saved.rule, DONE_RULE);
  assert.equal(first.calls.length, 5 + 4 * 2, '반·명단·이전 등교일(기록·접속)·마지막 레벨 + 지난 4일 × 2');

  const second = fakeFirestoreFetch(weekDb(MISSES));
  const r2 = await buildReport({ ...baseArgs(), fetchImpl: second, dayCache });
  assert.equal(second.calls.length, 5, '저장된 날짜는 다시 안 부름');
  assert.deepEqual(r2.counts, r1.counts);
});

test('오늘 받은 반·명단·마지막 레벨·이전 등교일 기록은 하루 동안 다시 안 부름 (새로고침·다음 날은 다시)', async () => {
  let saved = null;
  const baseCache = {
    load: async () => saved,
    save: async (_code, b) => { saved = JSON.parse(JSON.stringify(b)); },
  };
  const first = fakeFirestoreFetch(sampleDb('2026-10-08'));
  const r1 = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: first, baseCache });
  assert.equal(first.calls.length, 5, '반·명단·통과 기록(반 전체 도전)·이전 등교일(기록·접속)');
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
  assert.equal(third.calls.length, 5, '새로고침은 새로 받음');

  const offDay = fakeFirestoreFetch(sampleDb('2026-10-08'));
  const r4 = await buildReport({ classCode: 'TEST01', now: later, fetchImpl: offDay, baseCache, offDays: ['2026-10-08'] });
  assert.equal(offDay.calls.length, 2, '쉬는 날을 고쳐 이전 등교일이 바뀌면 그날 기록만 새로');
  assert.equal(r4.dateKey, '2026-10-07');

  const tomorrow = fakeFirestoreFetch(sampleDb('2026-10-08'));
  await buildReport({ classCode: 'TEST01', now: new Date('2026-10-11T23:30:00Z'), fetchImpl: tomorrow, baseCache });
  assert.equal(tomorrow.calls.length, 5, '다음 날은 새로 받음');

  saved = { ...saved, date: '2026-10-12', finalPassed: ['12'], levelUps: [] }; // 통과 기록 넣기 전 형식
  delete saved.passes;
  const oldFormat = fakeFirestoreFetch(sampleDb('2026-10-08'));
  const r5 = await buildReport({ classCode: 'TEST01', now: new Date('2026-10-11T23:30:00Z'), fetchImpl: oldFormat, baseCache });
  assert.equal(oldFormat.calls.length, 5, '예전 형식으로 저장된 것은 버리고 새로 받음');
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
  assert.ok(!by['4'], '기록 없이 접속만 한 학생은 레벨·점수에 없음');
  assert.ok(!by['3'] && !by['7'], '안 한 학생은 없음');
  assert.equal(r.levelUps, 12, '기록 있는 14명 중 1번(전에 통과)·5번(연습) 빼고');
  assert.equal(r.progress[0].no, '2', '레벨 상승이 먼저');
  assert.deepEqual(r.progress.slice(-1).map((s) => s.no), ['5'], '점수 없는 학생은 뒤로');
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
// 모든 레벨 통과 학생 자동 제외
// ---------------------------------------------------------------------------

test('마지막 레벨은 L36 이고 통과 점수는 261', () => {
  assert.equal(FINAL_LEVEL, 'L36');
  assert.equal(FINAL_PASS_SCORE, 261);
});

test('마지막 레벨(L36)을 통과한 학생은 자동으로 빠지고, L27 만 통과한 학생은 센다', async () => {
  const days = ['2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27'];
  const students = [
    { no: '1', name: '김민준' }, { no: '12', name: '오수아' }, { no: '13', name: '서이준' }, { no: '14', name: '한지우' },
  ];
  const results = [
    { dateKey: '2026-10-20', studentNo: '12', mode: 'challenge', level: 'L36', score: 262 }, // 끝까지 통과
    { dateKey: '2026-10-20', studentNo: '13', mode: 'challenge', level: 'L27', score: 218 }, // L27 만 통과
    { dateKey: '2026-10-20', studentNo: '14', mode: 'challenge', level: 'L36', score: 250 }, // L36 도전했지만 미달
  ];
  for (const d of days) results.push({ dateKey: d, studentNo: '1', mode: 'free', level: 'L3', score: null });
  const db = { TEST01: { name: '5학년 4반', offDays: [], students, results, logs: [] } };
  const r = await buildReport({
    classCode: 'TEST01', countStart: '2026-10-22', now: new Date('2026-10-27T23:30:00Z'), fetchImpl: fakeFirestoreFetch(db),
  });
  assert.equal(r.dateKey, '2026-10-27');
  assert.deepEqual(r.graduated.map((s) => s.no), ['12']);
  assert.deepEqual(r.missing.map((s) => s.no), ['13', '14']);
  assert.equal(r.total, 3);
  assert.equal(r.counts['12'], undefined, '끝까지 통과한 학생은 누적도 안 셈');
  assert.equal(r.counts['13'], 4);
  assert.equal(r.counts['14'], 4);
});

// ---------------------------------------------------------------------------
// 결석 차감
// ---------------------------------------------------------------------------

test('결석 처리한 학생은 그날 명단·인원에서 빠지고 누적도 안 셈', async () => {
  const MISSES = { 3: [DAYS[2], DAYS[3], DAYS[4]], 7: [DAYS[4]] };
  const args = { classCode: 'TEST01', now: new Date('2026-10-15T23:30:00Z'), countStart: DAYS[0], excludeNames: ['테스트'], limit: 3 };
  assert.equal(new SchoolCalendar().prevSchoolDay('2026-10-16'), DAYS[4]);
  const before = await buildReport({ ...args, fetchImpl: fakeFirestoreFetch(weekDb(MISSES)) });
  assert.equal(before.dateKey, DAYS[4]);
  assert.deepEqual(before.missing.map((s) => s.no), ['3', '7']);
  assert.equal(before.counts['3'], 3);
  assert.deepEqual(before.overLimit.map((s) => s.no), ['3']);
  assert.equal(before.total, 17);

  // 3번이 이전 등교일(DAYS[4])과 그 전날(DAYS[3])에 결석
  const absent = { [absentKey(DAYS[4], '3')]: true, [absentKey(DAYS[3], '3')]: true, [absentKey(DAYS[4], '99')]: false };
  const after = await buildReport({ ...args, absent, fetchImpl: fakeFirestoreFetch(weekDb(MISSES)) });
  assert.deepEqual(after.missing.map((s) => s.no), ['7']);
  assert.deepEqual(after.absent.map((s) => s.no), ['3']);
  assert.equal(after.total, 16);
  assert.equal(after.done, 15);
  assert.equal(after.counts['3'], 1, '3일 중 결석 2일을 빼고 1회');
  assert.deepEqual(after.overLimit, []);
  assert.deepEqual(after.watch.map((s) => [s.no, s.count]), [['3', 1], ['7', 1]]);
  assert.ok(after.students.some((s) => s.no === '3'), '결석 처리 화면에는 결석한 학생도 나옴');
});

test('다른 날 결석이나 취소(false)한 결석은 이전 등교일 명단에 영향이 없음', async () => {
  const absent = { [absentKey('2026-10-07', '3')]: true, [absentKey('2026-10-08', '7')]: false };
  const r = await buildReport({ classCode: 'TEST01', now: NOW, absent, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '7', '99']);
  assert.deepEqual(r.absent, []);
});

test('결석은 하루 저장 자료(baseCache)와 상관없이 바로 반영됨', async () => {
  let saved = null;
  const baseCache = { load: async () => saved, save: async (_c, b) => { saved = JSON.parse(JSON.stringify(b)); } };
  await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')), baseCache });
  const next = fakeFirestoreFetch(sampleDb('2026-10-08'));
  const r = await buildReport({ classCode: 'TEST01', now: NOW, absent: { [absentKey('2026-10-08', '7')]: true }, fetchImpl: next, baseCache });
  assert.equal(next.calls.length, 0);
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '99']);
});
