// mathpractice 개편(2026-11-17)에 맞춘 통과 판정과 '했다'(HIT_FROM 부터) 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReport, addProgress, passWindow, bestWindow, todayLevel, judgeDay, parseBasicStart, nextLevel, lastHit,
  HIT_FROM, DONE_RULE,
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
  assert.deepEqual(hits['6'].L10['2026-11-18'], { c: 7, n: 9 });
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
  assert.equal(saved.v, 2);
  assert.deepEqual(saved.hits['1'].B1, { '2026-11-18': { c: 12, n: 15 }, '2026-11-19': { c: 13, n: 16 } });
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
