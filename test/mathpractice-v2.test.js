// mathpractice 개편(2026-11-17)에 맞춘 통과 판정과 '했다'(HIT_FROM 부터) 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReport, buildTodayReport, addProgress, passWindow, bestWindow, todayLevel, judgeDay, parseBasicStart, nextLevel, lastHit,
  HIT_FROM, DONE_RULE, TRACKS_FROM,
} from '../public/js/lib/mathpractice.js';
import { fakeFirestoreFetch, SAMPLE_NAMES, kstMillis } from './fake-firestore.js';

const ones = (n) => '1'.repeat(n);
const row = (no, dateKey, level, seq, extra = {}) => ({
  no, dateKey, level, seq, mode: 'aborted', score: null, ...(seq ? { totalQuestions: seq.length } : {}), ts: 0, ...extra,
});

test('통과 창: 분수 20문제 중 18개(10문제 레벨은 10 중 9), 기초는 한 판 안', () => {
  assert.deepEqual(passWindow('L10'), { size: 20, need: 18, run: false });
  assert.deepEqual(passWindow('L15'), { size: 10, need: 9, run: false }, '문제 8개 과정형');
  assert.deepEqual(passWindow('B1'), { size: 20, need: 18, run: true });
  assert.deepEqual(passWindow('B9'), { size: 10, need: 9, run: true });
});

test('분수: 중간에 그만둔 판과 일찍 통과한 판(점수 없음)을 이어 붙여 최근 20문제 중 18개면 통과', () => {
  const passes = {};
  const windows = {};
  addProgress(passes, windows, [
    row('1', '2026-11-18', 'L10', ones(10), { ts: 1 }),
    row('1', '2026-11-18', 'L10', '0', { ts: 2 }),
    row('1', '2026-11-19', 'L10', ones(6), { ts: 3 }), // 16/17 → 아직
  ]);
  assert.equal(passes['1']?.L10, undefined);
  assert.equal(windows['1'].L10, `${ones(10)}0${ones(6)}`);
  addProgress(passes, windows, [row('1', '2026-11-20', 'L10', ones(2), { resultStatus: 'passed_early' })]);
  assert.equal(passes['1'].L10, '2026-11-20', '18/19 → 통과 (날짜는 그 기록의 날)');
});

test('분수: 오답이 창 안에 3개 있으면 통과 못 하고, 밀려나면 통과', () => {
  const passes = {};
  const windows = {};
  addProgress(passes, windows, [row('2', '2026-11-18', 'L10', `000${ones(17)}`)]);
  assert.equal(passes['2']?.L10, undefined, '17/20');
  addProgress(passes, windows, [row('2', '2026-11-19', 'L10', '1')]);
  assert.equal(passes['2'].L10, '2026-11-19', '맨 앞 오답이 밀려나 18/20');
});

test('기초: 한 판에서 18개면 통과, 판을 이어 붙이지 않음, 시간은 안 봄', () => {
  const passes = {};
  addProgress(passes, {}, [
    row('3', '2026-11-18', 'B1', `${ones(10)}000`, { resultStatus: 'failed_wrong' }),
    row('3', '2026-11-18', 'B1', ones(8)), // 앞 판과 합치면 18이지만 판 안 규칙이라 아님
  ]);
  assert.equal(passes['3']?.B1, undefined);
  addProgress(passes, {}, [row('3', '2026-11-19', 'B1', `${ones(17)}01`, { mode: 'challenge', score: 80, isOvertime: true })]);
  assert.equal(passes['3'].B1, '2026-11-19', '시간이 지나도 18개면 통과');
  addProgress(passes, {}, [row('4', '2026-11-19', 'B9', `${ones(8)}01`)]);
  assert.equal(passes['4'].B9, '2026-11-19', '10문제 레벨은 9개');
});

test('seq 없는 예전 기록은 예전 규칙(끝까지 푼 판의 점수 ≥ 통과 점수)', () => {
  const passes = {};
  addProgress(passes, {}, [
    row('5', '2026-10-01', 'L1', null, { mode: 'challenge', score: 86 }),
    row('5', '2026-10-02', 'L2', null, { mode: 'challenge', score: 90 }),
    row('5', '2026-10-02', 'L3', null, { mode: 'aborted', score: null }),
  ]);
  assert.deepEqual(passes['5'], { L1: '2026-10-01' }, 'L1 통과 86, L2 통과 91');
});

test('그날 맞힌 개수: 연속 20문제 중 가장 많이 맞힌 개수, 푼 문제 수', () => {
  assert.equal(bestWindow('1101', 20), 3);
  assert.equal(bestWindow(`0${ones(19)}0${ones(5)}`, 20), 19);
  const hits = {};
  addProgress({}, {}, [row('6', '2026-11-18', 'L10', ones(5), { ts: 1 }), row('6', '2026-11-18', 'L10', '0011', { ts: 2 })], hits);
  assert.deepEqual(hits['6'].L10['2026-11-18'], { c: 7, n: 9, s: 20 });
  assert.deepEqual(lastHit(hits['6'].L10, '2026-11-19'), { date: '2026-11-18', c: 7 });
  assert.equal(lastHit(hits['6'].L10, '2026-11-18'), null, '그날 것은 안 봄');
});

test('오늘 할 것 레벨: 기초 먼저(시작점 앞은 통과로 침) → 분수에서 열린 첫 레벨', () => {
  const start = parseBasicStart({ 3: { sub: 'B1', mul: 'B2', div: 'B6', g: '가' }, 6: { sub: '-', mul: '-', div: '-', g: '라' } });
  assert.equal(todayLevel({}, null, '2026-11-18'), 'B1', '시작점이 없으면 B1 부터');
  assert.equal(todayLevel({}, start['6'], '2026-11-18'), 'B9', '약수와 배수는 모두 거침');
  assert.equal(todayLevel({ B1: '2026-11-18' }, start['3'], '2026-11-19'), 'B2');
  assert.equal(todayLevel({ B1: '2026-11-18' }, start['3'], '2026-11-18'), 'B1', '그날 통과한 것은 그날 기준에 안 들어감');
  assert.equal(todayLevel({ B5: '2026-11-18' }, start['3'], '2026-11-19'), 'B1', '시작점(B6) 앞 B5 는 상관없음');
  const basicDone = { B9: '2026-11-01', B10: '2026-11-01' };
  assert.equal(todayLevel({ ...basicDone, L1: '2026-10-01', L2: '2026-10-02' }, start['6'], '2026-11-18'), 'L3');
  assert.equal(todayLevel({ ...basicDone, L9: '2026-10-01', L10: '2026-10-02' }, start['6'], '2026-11-18'), 'L1', 'L1 부터 통과해야 열림');
  const all = Object.fromEntries(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'].map((l) => [l, '2026-10-01']));
  assert.equal(todayLevel({ ...basicDone, ...all }, start['6'], '2026-11-18'), 'L11', 'L9-2 는 뒤 레벨을 통과했으면 통과로 침');
  assert.equal(nextLevel('B4'), '', '기초는 같은 줄 안에서만');
  assert.equal(nextLevel('B2'), 'B3');
  assert.equal(nextLevel('L9'), 'L9-2');
});

test('HIT_FROM 부터: 오늘 할 것 레벨을 통과했거나 어제 n개 → 오늘 n+1개 이상이면 했다', () => {
  assert.equal(HIT_FROM, '2026-11-18');
  assert.match(DONE_RULE, /hit-from-2026-11-18/);
  const day = '2026-11-19';
  const start = { 1: { sub: '-', mul: '-', div: '-' } };
  for (const no of ['1', '2', '3', '4', '5', '6', '7']) start[no] = { sub: '-', mul: '-', div: '-' };
  const basicDone = { B9: '2026-11-01', B10: '2026-11-01' };
  for (const l of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9']) basicDone[l] = '2026-10-01'; // → L9-2 해야
  const passes = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((no) => [no, { ...basicDone }]));
  passes['1']['L9-2'] = day; // 1번: 그날 통과
  const hits = {
    2: { 'L9-2': { '2026-11-18': { c: 6, n: 10 } } },
    3: { 'L9-2': { '2026-11-18': { c: 6, n: 10 } } },
    6: { 'L9-2': { '2026-11-13': { c: 8, n: 10 } } },
  };
  const rows = [
    row('1', day, 'L9-2', '111111111'),
    row('2', day, 'L9-2', '1111111000'), // 7 > 6 → 했다
    row('3', day, 'L9-2', '1111110000'), // 6 = 6 → 못 넘음
    row('4', day, 'L9-2', '11111'),      // 처음, 5문제 → 10문제 채워야
    row('5', day, 'L9-2', '0000011111'), // 처음, 10문제 채움 → 했다
    row('6', day, 'L3', ones(20)),       // 다른 레벨만 → 안 함
    row('7', day, 'L9-2', null, { mode: 'challenge', score: 120 }), // seq 없는 기록(옛 화면)만 → 0개
  ];
  const j = judgeDay(day, rows, new Set(), passes, {}, hits, start);
  assert.deepEqual([...j.done].sort(), ['1', '2', '5']);
  assert.deepEqual(j.notBeat.get('3'), { level: 'L9-2', hits: 6, solved: 10, size: 10, prev: 6, prevDate: '2026-11-18' });
  assert.deepEqual(j.notBeat.get('4'), { level: 'L9-2', hits: 5, solved: 5, size: 10, prev: null, prevDate: '' });
  assert.deepEqual(j.lower.get('6'), { did: 'L3', need: 'L9-2' });
  assert.equal(j.notBeat.get('7').hits, 0);
});

test('HIT_FROM 부터: 통과 못 한 기초가 있으면 분수를 아무리 해도 안 함', () => {
  const day = '2026-11-19';
  const passes = { 1: { L20: '2026-10-01' } };
  const j = judgeDay(day, [row('1', day, 'L21', ones(20))], new Set(), passes, {}, {}, { 1: { sub: 'B1', mul: 'B3', div: 'B6' } });
  assert.deepEqual(j.lower.get('1'), { did: 'L21', need: 'B1' });
  const j2 = judgeDay(day, [row('1', day, 'B1', `${ones(15)}000`, { resultStatus: 'failed_wrong' })], new Set(), passes, {}, {}, { 1: { sub: 'B1' } });
  assert.equal(j2.notBeat.get('1').solved, 18, 'B1 처음: 3개 틀려 18문제에서 끝남 → 20문제 못 채움');
  const j3 = judgeDay(day, [
    row('1', day, 'B1', `${ones(15)}000`, { ts: 1 }), row('1', day, 'B1', `${ones(4)}0`, { ts: 2 }),
  ], new Set(), passes, {}, {}, { 1: { sub: 'B1' } });
  assert.ok(j3.done.has('1'), '다시 하기로 한 판 더 풀어 그날 20문제를 넘기면 했다');
});

test('전날 점수 넘기 날짜(11/16~17)에도 그날 통과(점수 없는 자동 통과)는 했다', () => {
  const day = '2026-11-17';
  const passes = { 1: { L20: '2026-10-01', L21: day } };
  const best = { 1: { L21: { '2026-11-16': 170 } } };
  const j = judgeDay(day, [row('1', day, 'L21', ones(18), { resultStatus: 'passed_early' })], new Set(), passes, best);
  assert.ok(j.done.has('1'));
});

// ---- 끝에서 끝까지 (가짜 분수 연산 마스터) ----

function hitDb() {
  const students = [...SAMPLE_NAMES.slice(0, 6).map((name, i) => ({ no: String(i + 1), name }))];
  const r = (no, dateKey, level, seq, extra = {}) => ({
    studentNo: no, dateKey, level, seq, mode: 'aborted', score: null, totalQuestions: seq.length, ts: kstMillis(dateKey, 10), ...extra,
  });
  const results = [
    // 1번: 기초 시작점 B1. 11/18 B1 12/20 → 11/19 B1 13개 → 했다
    r('1', '2026-11-18', 'B1', `${ones(12)}000`), r('1', '2026-11-19', 'B1', `${ones(13)}000`),
    // 2번: 기초 다 '-'·B9·B10 통과 → L1 해야. 11/19 L1 18개 자동 통과 → 했다, 레벨 상승
    r('2', '2026-11-18', 'B9', ones(9)), r('2', '2026-11-18', 'B10', ones(9)),
    r('2', '2026-11-19', 'L1', ones(18), { resultStatus: 'passed_early' }),
    // 3번: B1 해야 하는데 L1 만 → 안 함
    r('3', '2026-11-19', 'L1', ones(5)),
    // 4번: L36 통과(옛날) 했지만 기초가 남음 → 졸업 아님, 11/19 기록 없음 → 안 함
    { studentNo: '4', dateKey: '2026-09-01', level: 'L36', mode: 'challenge', score: 262 },
    // 5번: L36 통과 + 기초 모두 끝 → 졸업
    { studentNo: '5', dateKey: '2026-09-01', level: 'L36', mode: 'challenge', score: 262 },
    r('5', '2026-11-18', 'B9', ones(9)), r('5', '2026-11-18', 'B10', ones(9)),
    // 6번: B1 11/18 15개 → 11/19 15개 → 못 넘음
    r('6', '2026-11-18', 'B1', `${ones(15)}000`), r('6', '2026-11-19', 'B1', `${ones(15)}000`),
  ];
  const basicStart = {
    1: { sub: 'B1', mul: 'B2', div: 'B6', g: '가' }, 2: { sub: '-', mul: '-', div: '-', g: '라' },
    3: { sub: 'B1', mul: 'B3', div: 'B6', g: '나' }, 4: { sub: 'B1', mul: 'B3', div: 'B8', g: '나' },
    5: { sub: '-', mul: '-', div: '-', g: '라' }, 6: { sub: 'B1', mul: 'B4', div: 'B6', g: '다' },
  };
  return { TEST01: { name: '5학년 4반', offDays: [], students, results, logs: [], basicStart } };
}

test('끝에서 끝까지: 11/20 아침 화면 = 11/19 판정 (기초 시작점·자동 통과·졸업)', async () => {
  let saved = null;
  const passCache = { load: async () => saved && JSON.parse(JSON.stringify(saved)), save: async (_c, v) => { saved = JSON.parse(JSON.stringify(v)); } };
  const r = await buildReport({
    classCode: 'TEST01', now: new Date('2026-11-19T23:30:00Z'), countStart: '2026-11-18', fetchImpl: fakeFirestoreFetch(hitDb()), passCache,
  });
  assert.equal(r.dateKey, '2026-11-19');
  assert.deepEqual(r.graduated.map((s) => s.no), ['5'], 'L36 + 기초 끝 → 졸업, 4번은 기초가 남아 계속 셈');
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '4', '6']);
  const by = Object.fromEntries(r.missing.map((s) => [s.no, s]));
  assert.deepEqual(by['3'].lower, { did: 'L1', need: 'B1' });
  assert.equal(by['6'].notBeat.prev, 15);
  const up = r.progress.find((s) => s.no === '2');
  assert.deepEqual(up.levelUp, { passed: 'L1', next: 'L2' });
  assert.equal(saved.v, 4);
  assert.deepEqual(saved.hits['1'].B1, { '2026-11-18': { c: 12, n: 15, s: 20 }, '2026-11-19': { c: 13, n: 16, s: 20 } });
  assert.equal(r.counts['1'], 1, '11/18 은 B1 처음인데 15문제라 20문제 못 채움 → 안 함');
});

test('저장본에 오늘 기록은 넣지 않고, 다음 날 새 날짜만 더해도 창이 이어짐', async () => {
  const db = hitDb();
  let saved = null;
  const passCache = { load: async () => saved && JSON.parse(JSON.stringify(saved)), save: async (_c, v) => { saved = JSON.parse(JSON.stringify(v)); } };
  db.TEST01.results.push(
    { studentNo: '2', dateKey: '2026-11-20', level: 'L2', seq: ones(10), mode: 'aborted', score: null, ts: kstMillis('2026-11-20', 10) },
  );
  await buildReport({ classCode: 'TEST01', now: new Date('2026-11-20T01:00:00Z'), fetchImpl: fakeFirestoreFetch(db), passCache });
  assert.equal(saved.through, '2026-11-19');
  assert.equal(saved.windows['2']?.L2, undefined, '오늘(11/20) 기록은 아직 안 넣음');
  db.TEST01.results.push(
    { studentNo: '2', dateKey: '2026-11-23', level: 'L2', seq: ones(8), mode: 'aborted', score: null, ts: kstMillis('2026-11-23', 10) },
  );
  const r = await buildReport({ classCode: 'TEST01', now: new Date('2026-11-23T23:30:00Z'), fetchImpl: fakeFirestoreFetch(db), passCache });
  assert.equal(saved.passes['2'].L2, '2026-11-23', '11/20 의 10개 + 11/23 의 8개 = 18/18, 두 번 넣지 않음');
  assert.equal(saved.windows['2'].L2, ones(18));
  assert.ok(!r.missing.some((s) => s.no === '2'));
});

test('판단 보류: 11/17 한 것은 따지지 않음 (11/18 아침 화면은 명단 비움, 누적에서도 뺌)', async () => {
  const db = hitDb();
  const am18 = await buildReport({ classCode: 'TEST01', now: new Date('2026-11-17T23:30:00Z'), countStart: '2026-11-16', fetchImpl: fakeFirestoreFetch(db) });
  assert.equal(am18.dateKey, '2026-11-17');
  assert.equal(am18.hold, true);
  assert.deepEqual(am18.missing, []);
  assert.equal(am18.countedDays, 1, '11/16 만 셈');
  const am20 = await buildReport({ classCode: 'TEST01', now: new Date('2026-11-19T23:30:00Z'), countStart: '2026-11-16', fetchImpl: fakeFirestoreFetch(db) });
  assert.equal(am20.hold, false);
  assert.equal(am20.countedDays, 3, '11/16 · 11/18 · 11/19 (11/17 뺌)');
});

// ---- 오늘 현황 (버튼을 누를 때만) ----

test('오늘 현황: 오늘 기록만 새로 읽고 했음 / 하는 중 / 아직 안 함으로 나눔', async () => {
  const db = hitDb();
  const today = '2026-11-20';
  const r = (no, level, seq, extra = {}) => ({
    studentNo: no, dateKey: today, level, seq, mode: 'aborted', score: null, totalQuestions: seq.length, ts: kstMillis(today, 10), ...extra,
  });
  db.TEST01.results.push(
    r('1', 'B1', `${ones(14)}000`),                         // 11/19 13개 → 14개: 했음
    r('3', 'L1', ones(5)),                                   // B1 해야 하는데 L1: 하는 중(다른 레벨)
    r('6', 'B1', `${ones(18)}00`, { mode: 'challenge', score: 90 }), // 한 판 18개 → 통과: 했음, 레벨 상승
  );
  let base = null;
  let pass = null;
  const baseCache = { load: async () => base && JSON.parse(JSON.stringify(base)), save: async (_c, v) => { base = JSON.parse(JSON.stringify(v)); } };
  const passCache = { load: async () => pass && JSON.parse(JSON.stringify(pass)), save: async (_c, v) => { pass = JSON.parse(JSON.stringify(v)); } };
  const now = new Date('2026-11-20T05:00:00Z'); // 14:00 KST
  await buildReport({ classCode: 'TEST01', now: new Date('2026-11-19T23:30:00Z'), fetchImpl: fakeFirestoreFetch(db), baseCache, passCache });
  const savedBase = JSON.stringify(base);

  const fetch = fakeFirestoreFetch(db);
  const t = await buildTodayReport({
    classCode: 'TEST01', now, fetchImpl: fetch, baseCache, passCache, absent: { '2026-11-20_4': true },
  });
  assert.equal(fetch.calls.length, 1, '받아 둔 것이 있으면 오늘 기록만 한 번 읽음');
  assert.match(decodeURIComponent(fetch.calls[0].body), /2026-11-20/);
  assert.equal(t.dateKey, today);
  assert.deepEqual(t.done.map((s) => s.no), ['1', '6']);
  assert.deepEqual(t.done.find((s) => s.no === '6').levelUp, { passed: 'B1', next: '' });
  assert.deepEqual(t.trying.map((s) => s.no), ['3']);
  assert.deepEqual(t.trying[0].lower, { did: 'L1', need: 'B1' });
  assert.deepEqual(t.notYet.map((s) => s.no), ['2'], '4번은 오늘 결석, 5번은 졸업');
  assert.equal(t.notYet[0].need, 'L2');
  assert.deepEqual(t.absent.map((s) => s.no), ['4']);
  assert.deepEqual(t.graduated.map((s) => s.no), ['5']);
  assert.equal(t.total, 4);
  assert.equal(t.records, 3);
  assert.equal(JSON.stringify(base), savedBase, '받아 둔 것은 바꾸지 않음');
});

test('오늘 현황: 분수 레벨은 어제까지의 창에 오늘 기록을 이어 붙여 통과를 봄', async () => {
  const db = hitDb();
  db.TEST01.results.push(
    { studentNo: '2', dateKey: '2026-11-20', level: 'L2', seq: ones(10), mode: 'aborted', score: null, ts: kstMillis('2026-11-20', 10) },
    { studentNo: '2', dateKey: '2026-11-23', level: 'L2', seq: ones(8), mode: 'aborted', score: null, ts: kstMillis('2026-11-23', 10) },
  );
  let base = null;
  let pass = null;
  const baseCache = { load: async () => base, save: async (_c, v) => { base = JSON.parse(JSON.stringify(v)); } };
  const passCache = { load: async () => pass && JSON.parse(JSON.stringify(pass)), save: async (_c, v) => { pass = JSON.parse(JSON.stringify(v)); } };
  await buildReport({ classCode: 'TEST01', now: new Date('2026-11-22T23:30:00Z'), fetchImpl: fakeFirestoreFetch(db), baseCache, passCache });
  const t = await buildTodayReport({ classCode: 'TEST01', now: new Date('2026-11-23T03:00:00Z'), fetchImpl: fakeFirestoreFetch(db), baseCache, passCache });
  const two = t.done.find((s) => s.no === '2');
  assert.ok(two, '11/20 의 10개 + 오늘 8개 = 18/18 → 통과');
  assert.deepEqual(two.levelUp, { passed: 'L2', next: 'L3' });
});

test('오늘 현황: 받아 둔 것이 없으면 반 정보·명단·통과 기록도 받아 옴', async () => {
  const fetch = fakeFirestoreFetch(hitDb());
  const t = await buildTodayReport({ classCode: 'TEST01', now: new Date('2026-11-20T05:00:00Z'), fetchImpl: fetch });
  assert.ok(fetch.calls.length > 1);
  assert.equal(t.total, 5);
  assert.equal(t.notYet.length, 5, '오늘 기록 없음');
  await assert.rejects(buildTodayReport({ classCode: '' }), (e) => e.code === 'nocode');
});

// ---- B3·B7 한 판 10문제 (mathpractice 2026-11-19) ----

test('B3: 11/19 부터 한 판 10문제 중 9개면 통과, 예전 20문제 판은 그때 규칙(18개)', () => {
  assert.deepEqual(passWindow('B3'), { size: 10, need: 9, run: true });
  assert.deepEqual(passWindow('B7'), { size: 10, need: 9, run: true });
  const passes = {};
  addProgress(passes, {}, [row('9', '2026-11-18', 'B3', `${ones(9)}000${ones(8)}`)]); // 예전 20문제 판 17개
  assert.equal(passes['9']?.B3, undefined, '예전 판은 9개 넘어도 18개가 아니면 통과 아님');
  addProgress(passes, {}, [row('9', '2026-11-23', 'B3', `${ones(9)}0`)]);
  assert.equal(passes['9'].B3, '2026-11-23', '새 판 10문제 중 9개 → 통과');
});

test('B3: 문제 수가 바뀌기 전 날(20문제 창)과는 맞힌 개수를 비교하지 않음', () => {
  const hits = {};
  addProgress({}, {}, [row('9', '2026-11-18', 'B3', `${ones(17)}000`)], hits);
  assert.equal(hits['9'].B3['2026-11-18'].s, 20, '예전 20문제 판은 20문제 창으로 잼');
  const passes = { 9: { B1: '2026-10-01', B2: '2026-10-01' } };
  const start = { 9: { sub: '-', mul: 'B2', div: 'B5' } };
  // 11/23: 10문제 판에서 8개 (통과 아님). 예전 17개와는 비교 안 하고 '처음'으로 봄 → 10문제 채웠으니 했다
  const j = judgeDay('2026-11-23', [row('9', '2026-11-23', 'B3', `${ones(8)}00`)], new Set(), passes, {}, hits, start);
  assert.ok(j.done.has('9'));
  assert.equal(lastHit(hits['9'].B3, '2026-11-23', 10), null);
  assert.deepEqual(lastHit(hits['9'].B3, '2026-11-23', 20), { date: '2026-11-18', c: 17 });
});

test('B3: 오늘 현황에서 10문제 판 통과를 했음으로 봄', async () => {
  const db = hitDb();
  const start = db.TEST01.basicStart;
  start['3'] = { sub: '-', mul: 'B3', div: 'B6', g: '나' };
  const r = (no, dateKey, level, seq) => ({
    studentNo: no, dateKey, level, seq, mode: 'aborted', score: null, totalQuestions: seq.length, ts: kstMillis(dateKey, 10),
  });
  db.TEST01.results.push(r('3', '2026-11-18', 'B3', `${ones(17)}000`), r('3', '2026-11-23', 'B3', `0${ones(9)}`));
  const t = await buildTodayReport({ classCode: 'TEST01', now: new Date('2026-11-23T03:00:00Z'), fetchImpl: fakeFirestoreFetch(db) });
  const three = t.done.find((s) => s.no === '3');
  assert.ok(three, '10문제 중 9개 → 통과');
  assert.deepEqual(three.levelUp, { passed: 'B3', next: 'B4' });
});

test('기준이 바뀌면 11/19 부터의 날만 다시 셈 (그 전 저장본은 그대로 씀)', async () => {
  const db = hitDb();
  let known = { rule: 'record-from-2026-11-02-level-from-2026-11-03-score-from-2026-11-16-hit-from-2026-11-18', '2026-11-18': ['1', '2', '3', '4', '6'], '2026-11-19': [], settledOn: '2026-11-21' }; // 다시 세기는 이미 함 → 기준 바뀜만 봄
  const dayCache = { load: async () => JSON.parse(JSON.stringify(known)), save: async (_c, v) => { known = v; } };
  const fetch = fakeFirestoreFetch(db);
  const rep = await buildReport({ classCode: 'TEST01', now: new Date('2026-11-20T23:30:00Z'), countStart: '2026-11-18', fetchImpl: fetch, dayCache });
  assert.equal(rep.dateKey, '2026-11-20');
  assert.equal(known.rule, DONE_RULE);
  assert.deepEqual(known['2026-11-18'], ['1', '2', '3', '4', '6'], '11/18 은 다시 세지 않음');
  assert.ok(known['2026-11-19'].includes('1'), '11/19 는 다시 셈 (1번 했다)');
  const dayQueries = fetch.calls.filter((c) => c.body.includes('"op":"EQUAL"')).map((c) => JSON.parse(c.body).structuredQuery.where.fieldFilter.value.stringValue);
  assert.ok(!dayQueries.includes('2026-11-18') && dayQueries.includes('2026-11-19'));
});

// ---- 소수의 곱셈 · 도형의 넓이 트랙까지 세기 (11/23 부터) ----

const ALL_BASIC = { sub: '-', mul: '-', div: '-' };
const passedAll = (levels, date = '2026-10-01') => Object.fromEntries(levels.map((lv) => [lv, date]));
const L_ALL = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L9-2', 'L10', 'L11', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17', 'L18',
  'L19', 'L20', 'L21', 'L22', 'L23', 'L24', 'L25', 'L26', 'L27', 'L28', 'L29', 'L30', 'L31', 'L32', 'L33', 'L34', 'L35', 'L36'];

test('오늘 할 것: 11/23 부터 분수·소수 다음은 소수의 곱셈 → 도형의 넓이 (그 전 날은 다 끝냄)', () => {
  assert.equal(TRACKS_FROM, '2026-11-23');
  const p = passedAll([...L_ALL, 'B9', 'B10']);
  assert.equal(todayLevel(p, ALL_BASIC, '2026-11-20'), '', '11/20 은 예전처럼 L36 + 기초 끝 = 다 끝냄');
  assert.equal(todayLevel(p, ALL_BASIC, '2026-11-23'), 'D1');
  assert.equal(todayLevel({ ...p, D1: '2026-11-20', D2: '2026-11-21' }, ALL_BASIC, '2026-11-23'), 'D3');
  const dDone = passedAll(['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
  assert.equal(todayLevel({ ...p, ...dDone, A1: '2026-11-01' }, ALL_BASIC, '2026-11-23'), 'A2');
  assert.equal(todayLevel({ ...p, ...dDone, ...passedAll(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) }, ALL_BASIC, '2026-11-23'), '');
  assert.equal(todayLevel({ ...p, D1: '2026-11-01' }, ALL_BASIC, '2026-11-23'), 'D2', 'D 를 먼저 했어도 순서대로');
  assert.equal(todayLevel({ L1: '2026-11-01', D1: '2026-11-01' }, ALL_BASIC, '2026-11-23'), 'B9', '기초가 남으면 기초');
  assert.equal(nextLevel('D6'), '');
  assert.equal(nextLevel('A1'), 'A2');
});

test('소수의 곱셈: 이어 붙이는 창으로 통과, D3 예전 20문제 판은 20문제 중 18개', () => {
  const passes = {};
  const windows = {};
  addProgress(passes, windows, [row('1', '2026-11-23', 'D1', ones(10), { ts: 1 }), row('1', '2026-11-23', 'D1', ones(8), { ts: 2 })]);
  assert.equal(passes['1'].D1, '2026-11-23', '20문제 레벨: 이어서 18개');
  addProgress(passes, windows, [row('2', '2026-11-19', 'D3', `${ones(9)}${'0'.repeat(11)}`)]);
  assert.equal(passes['2']?.D3, undefined, '예전 20문제 판: 9개로는 통과 아님');
  addProgress(passes, windows, [row('2', '2026-11-23', 'D3', `${ones(9)}0`)]);
  assert.equal(passes['2'].D3, '2026-11-23', '10문제 레벨: 최근 10문제 중 9개');
});

test('11/23 부터 L36 + 기초를 끝낸 학생도 셈 (소수의 곱셈 D1 해야), 그 전 날 화면은 그대로 뺌', async () => {
  const db = hitDb(); // 5번: L36 통과 + 기초 끝 → L1~L35 통과 기록도 넣음 (실제로는 앞 레벨을 통과해야 L36 이 열림)
  for (const lv of L_ALL.slice(0, -1)) db.TEST01.results.push({ studentNo: '5', dateKey: '2026-09-01', level: lv, mode: 'challenge', score: 300 });
  const am20 = await buildReport({ classCode: 'TEST01', now: new Date('2026-11-19T23:30:00Z'), countStart: '2026-11-18', fetchImpl: fakeFirestoreFetch(db) });
  assert.deepEqual(am20.graduated.map((s) => s.no), ['5']);
  db.TEST01.results.push({ studentNo: '5', dateKey: '2026-11-23', level: 'L36', seq: ones(10), mode: 'aborted', score: null, ts: kstMillis('2026-11-23', 10) });
  const am24 = await buildReport({ classCode: 'TEST01', now: new Date('2026-11-23T23:30:00Z'), countStart: '2026-11-18', fetchImpl: fakeFirestoreFetch(db) });
  assert.equal(am24.dateKey, '2026-11-23');
  assert.deepEqual(am24.graduated, []);
  const five = am24.missing.find((s) => s.no === '5');
  assert.deepEqual(five.lower, { did: 'L36', need: 'D1' }, 'L36 만 다시 풂 → D1 해야');
  assert.equal(am24.finalLevel, 'A6');
  assert.equal(am24.counts['5'], 1, '11/23 하루만 셈 (11/18~20 은 다 끝낸 학생이라 안 셈)');
  const t = await buildTodayReport({ classCode: 'TEST01', now: new Date('2026-11-23T03:00:00Z'), fetchImpl: fakeFirestoreFetch(db) });
  assert.deepEqual(t.graduated, []);
  assert.equal(t.trying.find((s) => s.no === '5').need, 'D1');
});

// ---- 늦게 올라온 기록 (학생 앱 오프라인 보관함: 지난 날짜 기록이 다음 날 8:30 뒤에 올라옴) ----

test('늦게 올라온 기록: 다음 등교일에 그 전 날을 다시 세서 누적에서 빠지고, 통과 기록에도 한 번만 들어감', async () => {
  const B = (no) => ({ studentNo: no, dateKey: '2026-09-01', mode: 'aborted', seq: ones(9), ts: 1 });
  const db = {
    TEST01: {
      name: '5학년 4반', offDays: [], logs: [],
      students: [{ no: '1', name: SAMPLE_NAMES[0] }, { no: '2', name: SAMPLE_NAMES[1] }],
      basicStart: { 1: ALL_BASIC, 2: ALL_BASIC },
      results: [
        { ...B('1'), level: 'B9' }, { ...B('1'), level: 'B10' }, { ...B('2'), level: 'B9' }, { ...B('2'), level: 'B10' },
        { studentNo: '2', dateKey: '2026-11-23', level: 'L1', seq: ones(20), mode: 'aborted', ts: kstMillis('2026-11-23', 10) },
      ],
    },
  };
  const box = (init = null) => {
    let v = init;
    return { load: async () => v && JSON.parse(JSON.stringify(v)), save: async (_c, x) => { v = JSON.parse(JSON.stringify(x)); }, get: () => v };
  };
  const passCache = box();
  const dayCache = box({});
  const baseCache = box();
  const args = { classCode: 'TEST01', countStart: '2026-11-23', passCache, dayCache, baseCache };

  const am24 = await buildReport({ ...args, now: new Date('2026-11-23T23:30:00Z'), fetchImpl: fakeFirestoreFetch(db) });
  assert.deepEqual(am24.missing.map((s) => s.no), ['1'], '8:30 에는 1번 기록이 아직 안 올라옴');
  assert.equal(am24.counts['1'], 1);

  // 1번의 11/23 기록이 11/24 낮에 올라옴 (L1 20문제 다 맞힘 → 그날 통과)
  db.TEST01.results.push({ studentNo: '1', dateKey: '2026-11-23', level: 'L1', seq: ones(20), mode: 'aborted', ts: kstMillis('2026-11-23', 11) });

  const fetch25 = fakeFirestoreFetch(db);
  const am25 = await buildReport({ ...args, now: new Date('2026-11-24T23:30:00Z'), fetchImpl: fetch25 });
  assert.equal(am25.dateKey, '2026-11-24');
  assert.equal(am25.counts['1'], 1, '11/23 은 다시 세서 했다 → 11/24 하루만');
  assert.equal(passCache.get().passes['1'].L1, '2026-11-23', '늦게 온 기록도 통과 기록에 들어감');
  assert.equal(passCache.get().hits['2'].L1['2026-11-23'].n, 20, '이미 넣은 2번 기록은 다시 읽어도 두 번 넣지 않음');
  assert.deepEqual(dayCache.get()['2026-11-23'].sort(), ['1', '2']);
  const dayQueries = (f) => f.calls.filter((c) => c.body.includes('"op":"EQUAL"'))
    .map((c) => JSON.parse(c.body).structuredQuery.where.fieldFilter.value.stringValue);
  assert.ok(dayQueries(fetch25).includes('2026-11-23'), '11/23 을 다시 읽음');

  const fetchAgain = fakeFirestoreFetch(db);
  const again = await buildReport({ ...args, now: new Date('2026-11-25T01:00:00Z'), fetchImpl: fetchAgain, refresh: true });
  assert.ok(!dayQueries(fetchAgain).includes('2026-11-23'), '같은 날 두 번째부터는 다시 세지 않음');
  assert.equal(again.counts['1'], 1);
});
