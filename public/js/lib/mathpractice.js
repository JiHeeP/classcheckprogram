// 분수 연산 마스터(mathpractice) 읽기 — 예전 math_alert.py 를 옮긴 것
// mathpractice 의 Firestore 는 반 코드만 알면 명단·기록을 읽을 수 있다 (REST, 키는 공개용 웹 키).
// 브라우저와 Node(테스트) 양쪽에서 동작한다.

import { SchoolCalendar, parseOffDays, todayKST, timeKST, label, addDays } from './schoolday.js';

export const DEFAULT_PROJECT_ID = 'mathpractice-1d8f9';
export const DEFAULT_API_KEY = 'AIzaSyD-0OnV9CfNbglUojNh1Sz-WpVzZImereY';
const TIMEOUT_MS = 15000;

// 분수 연산 마스터의 레벨 (mathpractice js/levels.js 기준). 값은 도전 문제 수(chalQ)
//   만점: L1 90점부터 레벨당 +5 (L9-2 는 나중에 끼워 넣어 133 고정)
//   통과(다음 레벨 도전이 열림): 만점 - 허용 오답 × 2점. 허용 오답은 문제 10개 이하면 1개, 아니면 2개
export const LEVEL_CHAL_Q = {
  L1: 20, L2: 20, L3: 20, L4: 20, L5: 20, L6: 20, L7: 20, L8: 20, L9: 20, 'L9-2': 10, L10: 20, L11: 10,
  L12: 20, L13: 10, L14: 20, L15: 8, L16: 15, L17: 8, L18: 15, L19: 20, L20: 20, L21: 20, L22: 20,
  L23: 10, L24: 20, L25: 8, L26: 8, L27: 15,
  L28: 10, L29: 20, L30: 8, L31: 8, L32: 15, L33: 10, L34: 20, L35: 8, L36: 15,
};
export const LEVEL_ORDER = Object.keys(LEVEL_CHAL_Q);
const LEVEL_MAX = {};
LEVEL_ORDER.filter((lv) => lv !== 'L9-2').forEach((lv, i) => { LEVEL_MAX[lv] = 90 + i * 5; });
LEVEL_MAX['L9-2'] = 133;

export function passScore(level) {
  if (!LEVEL_MAX[level]) return Infinity;
  return LEVEL_MAX[level] - (LEVEL_CHAL_Q[level] <= 10 ? 1 : 2) * 2;
}

// 기초 연산 B1~B10 (mathpractice 2026-11-17 추가). 항상 열려 있고, 줄(뺄셈·곱셈·나눗셈·약수와 배수)마다 쉬운 것부터.
//   값은 도전 문제 수(chalQ). 통과는 '한 판 안'에서만 판정한다 (아래 passWindow)
export const BASIC_LINES = { sub: ['B1'], mul: ['B2', 'B3', 'B4'], div: ['B5', 'B6', 'B7', 'B8'], fm: ['B9', 'B10'] };
export const BASIC_ORDER = [...BASIC_LINES.sub, ...BASIC_LINES.mul, ...BASIC_LINES.div, ...BASIC_LINES.fm];
const BASIC_CHAL_Q = { B1: 20, B2: 20, B3: 20, B4: 10, B5: 20, B6: 20, B7: 20, B8: 10, B9: 10, B10: 10 };
const CHAL_Q = { ...LEVEL_CHAL_Q, ...BASIC_CHAL_Q };
const isBasic = (level) => Object.prototype.hasOwnProperty.call(BASIC_CHAL_Q, level);

/** 같은 트랙(기초는 같은 줄) 안에서 다음 레벨 이름 (마지막이면 '') — mathpractice levels.js nextInTrack 과 같음 */
export function nextLevel(level) {
  const list = isBasic(level) ? Object.values(BASIC_LINES).find((l) => l.includes(level)) : LEVEL_ORDER;
  const i = list.indexOf(level);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : '';
}

// ---------------------------------------------------------------------------
// 통과 판정 — mathpractice js/levels.js 의 computeProgress 와 똑같이 센다 (2026-11-17 개편)
//   시간은 통과에 넣지 않는다. 맞힌 개수만 본다.
//   - 분수·소수(L): 문제별 정오(seq '1101…')를 여러 판에 걸쳐 시간 순서대로 이어 붙여
//                    최근 20문제 중 18개(문제 10개 이하 레벨은 최근 10문제 중 9개)를 맞히면 통과.
//                    중간에 그만둔 판(aborted)과 일찍 통과한 판(passed_early, 점수 없음)도 들어간다.
//   - 기초(B): 한 판 안에서만. 20문제 중 18개(10문제 레벨은 10문제 중 9개)
//   - seq 가 없는 예전 기록: 예전 규칙(끝까지 푼 판의 점수 ≥ 통과 점수)
//   mathpractice 의 규칙이 바뀌면 여기도 같이 바꿔야 한다.
// ---------------------------------------------------------------------------

const allowedWrong = (level) => (CHAL_Q[level] <= 10 ? 1 : 2);

/** 통과 판정 창 {size, need, run}. run: 한 판 안에서만 판정(기초) */
export function passWindow(level) {
  if (isBasic(level)) {
    const size = CHAL_Q[level];
    return { size, need: size - allowedWrong(level), run: true };
  }
  const size = CHAL_Q[level] <= 10 ? 10 : 20;
  return { size, need: size - allowedWrong(level), run: false };
}

const SEQ_RE = /^[01]{1,400}$/;
const countOnes = (s) => [...s].reduce((n, c) => n + (c === '1' ? 1 : 0), 0);

/** 연속 size 문제 안에서 가장 많이 맞힌 개수 (푼 문제가 size 보다 적으면 푼 것 전체에서) */
export function bestWindow(seq, size) {
  if (seq.length <= size) return countOnes(seq);
  let n = countOnes(seq.slice(0, size));
  let best = n;
  for (let i = size; i < seq.length; i += 1) {
    n += (seq[i] === '1' ? 1 : 0) - (seq[i - size] === '1' ? 1 : 0);
    if (n > best) best = n;
  }
  return best;
}

/** 기록을 날짜·시각 순서로 (통과 창은 푼 순서대로 이어 붙여야 해서) */
const byTime = (a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : (a.ts || 0) - (b.ts || 0));

/**
 * 기록 → 통과 기록에 더하기 (mathpractice 와 같은 규칙, 위 설명).
 *   passes  = {번호: {레벨: 처음 통과한 날}}
 *   windows = {번호: {레벨: 최근 문제 정오 '1101…'}} — 분수·소수 레벨의 이어 붙이는 창 (다음에 이어서 셈)
 *   hits    = {번호: {레벨: {날짜: {c: 그날 연속 창 안에서 가장 많이 맞힌 개수, n: 그날 푼 문제 수}}}} — '했다' 판정용
 * 같은 기록을 두 번 넣으면 창이 틀어지므로, 부르는 쪽이 한 번씩만 넣는다.
 */
export function addProgress(passes, windows, rows, hits = {}) {
  const daySeq = new Map(); // '번호|레벨|날짜' → 그날 이어 붙인 seq
  for (const r of [...rows].sort(byTime)) {
    if (!CHAL_Q[r.level] || !r.dateKey || (r.mode !== 'challenge' && r.mode !== 'aborted')) continue;
    const mine = passes[r.no] || (passes[r.no] = {});
    const pass = () => { if (!mine[r.level] || r.dateKey < mine[r.level]) mine[r.level] = r.dateKey; };
    if (typeof r.seq === 'string' && SEQ_RE.test(r.seq)) {
      const key = `${r.no}|${r.level}|${r.dateKey}`;
      daySeq.set(key, (daySeq.get(key) || '') + r.seq);
      const w = passWindow(r.level);
      if (w.run) {
        if (countOnes(r.seq) >= w.need) pass();
      } else {
        const myWin = windows[r.no] || (windows[r.no] = {});
        let h = myWin[r.level] || '';
        for (const c of r.seq) {
          h = (h + c).slice(-w.size);
          if (h.length >= w.need && countOnes(h) >= w.need) pass();
        }
        myWin[r.level] = h;
      }
    } else if (r.seq == null) {
      const score = challengeScore(r);
      if (score != null && score >= passScore(r.level)) pass();
    }
  }
  for (const [key, seq] of daySeq) {
    const [no, level, date] = key.split('|');
    const byDate = ((hits[no] || (hits[no] = {}))[level] || (hits[no][level] = {}));
    const prev = byDate[date] || { c: 0, n: 0 };
    // 같은 날 기록이 나눠 들어와도(드묾) 창은 그날 몫끼리만 — 뒤에 온 몫은 따로 재서 큰 값을 남긴다
    byDate[date] = { c: Math.max(prev.c, bestWindow(seq, passWindow(level).size)), n: prev.n + seq.length };
  }
  return { passes, windows, hits };
}

const levelIndex = (level) => {
  const i = LEVEL_ORDER.indexOf(level);
  return i < 0 ? LEVEL_ORDER.length : i;
};

/** 점수로 인정되는 도전 기록이면 점수, 아니면 null (중도 포기·문제 수 미달은 점수로 안 침) */
function challengeScore(r) {
  if (r.mode !== 'challenge' || r.score == null || Number.isNaN(Number(r.score))) return null;
  if (typeof r.totalQuestions === 'number' && CHAL_Q[r.level] && r.totalQuestions < CHAL_Q[r.level]) return null;
  return Number(r.score);
}

// 마지막 레벨(지금은 L36). 이 레벨을 통과한 학생은 모든 레벨을 끝낸 것이라 수학 확인에서 자동으로 뺀다.
// 레벨이 더 늘면 마지막 레벨도 따라서 바뀐다.
export const FINAL_LEVEL = LEVEL_ORDER[LEVEL_ORDER.length - 1];
export const FINAL_PASS_SCORE = passScore(FINAL_LEVEL); // L36: 261

// 누적 세기: 이 날부터 등교일마다 '안 한 날'을 세고, 이 횟수 이상이면 벌 대상으로 따로 보여 준다
export const DEFAULT_COUNT_START = '2026-10-08';
export const DEFAULT_LIMIT = 3;

// '했다' 기준 (날짜마다 그날 쓰던 기준으로 센다 → 이미 쌓인 누적은 바뀌지 않는다)
//   ~ 11/1        : 접속만 해도 '했다'
//   STRICT_FROM ~ : 연습·도전 기록이 있어야 '했다'. 접속만 한 학생은 '안 함' (11/3 에 바뀜, 11/2 부터)
//   LEVEL_FROM ~  : 게다가 '자기 최고 레벨'(그날 전까지 통과한 가장 높은 레벨의 다음 레벨)을 풀어야 '했다'.
//                   그보다 낮은 레벨만 풀었으면 '안 함' (11/4 에 바뀜, 11/3 부터)
//   SCORE_FROM ~  : 게다가 자기 최고 레벨을 '도전'해서 전날 점수를 넘어야 '했다'.
//                   전날 점수 = 그 레벨을 도전한 가장 최근 날(그날 전)의 가장 높은 점수. 같으면 못 넘은 것.
//                   그 레벨 도전이 처음이면 도전만 끝까지 하면 '했다'. 연습만 했으면 '안 함' (11/16 에 바뀜, 11/16 부터 — 11/17 아침 화면부터 보임)
//   HIT_FROM ~    : mathpractice 개편(11/17)에 맞춘 기준. '어제보다 상승'은 그대로, 재는 것을 점수 → 맞힌 개수로.
//                   자기 레벨 = 학생 화면 '오늘 할 것' 첫째 레벨 (통과 못 한 기초가 있으면 기초, 없으면 분수 다음 레벨).
//                   그 레벨을 그날 ① 통과했거나 ② 연속 20문제(10문제 레벨은 10문제) 안에서 가장 많이 맞힌 개수가
//                   그 레벨을 마지막으로 푼 날보다 많으면 '했다'. 같으면 못 넘은 것.
//                   ③ 그 레벨을 처음 푸는 날(맞힌 개수 기록이 없으면)은 20문제(10문제 레벨은 10문제)를 채우면 '했다'.
//                   (점수를 안 쓰는 까닭: 새 앱은 통과한 판을 점수 없이 저장하고, 점수는 통과 못 한 판에만 남는다)
export const STRICT_FROM = '2026-11-02';
export const LEVEL_FROM = '2026-11-03';
export const SCORE_FROM = '2026-11-16';
export const HIT_FROM = '2026-11-18';
// 기준이 바뀌면 이 값도 바뀐다. 결과 캐시와, 새 기준 날짜의 지난 저장본(dayCache)을 버리고 다시 센다.
export const DONE_RULE = `record-from-${STRICT_FROM}-level-from-${LEVEL_FROM}-score-from-${SCORE_FROM}-hit-from-${HIT_FROM}`;
// 통과 계산 방식이 바뀌면 이 값도 바뀐다. 저장해 둔 통과 기록(passCache)을 버리고 반 전체를 다시 읽는다.
export const PASS_VERSION = 2;
// 판단 보류한 날: 분수 연산 마스터가 바뀐 날(11/17)이라 그날 한 것은 따지지 않는다 (선생님 결정).
//   그날 기준 화면(11/18 아침)은 안 한 학생 명단을 비우고 '판단 보류'로 보여 주고, 누적에도 세지 않는다.
//   11/19 아침 화면(11/18 한 것)부터 '오늘 할 것' 레벨 기준으로 판정한다.
export const HOLD_DAYS = ['2026-11-17'];

/**
 * 반 문서의 기초 시작점 basicStart = {'번호': {sub, mul, div, g}} (값 'B1'~'B8' 또는 '-' = 그 줄은 통과).
 * 학생 이름은 없고 번호만 있다. 모양이 이상한 값은 버린다.
 */
export function parseBasicStart(raw) {
  const out = {};
  if (!isObj(raw) || Array.isArray(raw)) return out;
  for (const [no, e] of Object.entries(raw)) {
    if (!isObj(e)) continue;
    const v = {};
    for (const line of ['sub', 'mul', 'div']) if (typeof e[line] === 'string') v[line] = e[line];
    if (typeof e.g === 'string') v.g = e.g;
    out[String(Number(no))] = v;
  }
  return out;
}

/** 시작점 앞이거나 '-'(통과)로 정한 줄의 레벨인가 — mathpractice levels.js basicSkipped 와 같음 */
function basicSkipped(start, level) {
  if (!start) return false;
  const line = Object.keys(BASIC_LINES).find((k) => BASIC_LINES[k].includes(level));
  if (!line || line === 'fm') return false;
  const st = start[line];
  if (st === '-') return true;
  const list = BASIC_LINES[line];
  return list.indexOf(st) > list.indexOf(level);
}

/**
 * day 에 '오늘 할 것' 첫째 레벨 (mathpractice app.js todayLevels()[0] 과 같음). 통과 기록은 day 전 것만 본다.
 *   통과 못 한 기초 레벨(시작점 앞은 통과로 침)이 있으면 그것, 없으면 분수·소수에서 아직 통과 못 했고 도전이 열린 첫 레벨.
 *   L9-2 는 그 뒤 레벨을 통과했으면 통과로 친다(나중에 끼워 넣은 레벨). 모두 끝냈으면 ''.
 */
export function todayLevel(passesOfStudent, start, day) {
  const passed = {};
  for (const [level, date] of Object.entries(passesOfStudent || {})) if (date < day) passed[level] = true;
  const i92 = LEVEL_ORDER.indexOf('L9-2');
  if (!passed['L9-2'] && Object.keys(passed).some((lv) => LEVEL_ORDER.indexOf(lv) > i92)) passed['L9-2'] = true;
  const basic = BASIC_ORDER.find((lv) => !passed[lv] && !basicSkipped(start, lv));
  if (basic) return basic;
  return LEVEL_ORDER.find((lv, i) => !passed[lv] && (i === 0 || passed[LEVEL_ORDER[i - 1]])) || '';
}

// 수학 확인에서 항상 빼는 이름 (우리 반 탭에서 바꿀 수 있음)
export const DEFAULT_EXCLUDE_TEXT = '전지현\n테스트';

/** 한국 시간 하루 [시작, 다음 날 시작) 의 밀리초. 접속 기록(logs)의 ts 가 밀리초라서 필요 */
export function kstDayRange(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d) - 9 * 3600 * 1000;
  return [start, start + 24 * 3600 * 1000];
}

/** 결석 기록의 열쇠: 날짜와 번호를 이어 붙인 것 ('2026-11-02_3'). 학생 이름은 저장하지 않는다 */
export const absentKey = (dateKey, no) => `${dateKey}_${no}`;

/** 줄·쉼표로 나뉜 이름 목록. '#' 뒤는 메모 */
export function parseNames(text) {
  const out = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    for (const part of line.split('#')[0].split(',')) {
      const name = part.trim();
      if (name) out.add(name);
    }
  }
  return [...out];
}

export class MathError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;     // nocode | notfound | quota | denied | network | http
    this.status = status;
  }
}

export const DEFAULT_BASE = `https://firestore.googleapis.com/v1/projects/${DEFAULT_PROJECT_ID}/databases/(default)/documents`;

/** 오래된 브라우저(전자칠판)에는 AbortSignal.timeout 이 없을 수 있다. */
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  if (typeof AbortController === 'undefined') return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** Firestore 값 객체 → JS 값 */
export function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) {
    const out = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) out[k] = decodeValue(x);
    return out;
  }
  return null;
}

function fields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc?.fields || {})) out[k] = decodeValue(v);
  return out;
}

function numKey(no) {
  const n = Number(no);
  return Number.isInteger(n) ? [0, n] : [1, 0];
}

export function sortByNo(list) {
  return [...list].sort((a, b) => {
    const [ka, kb] = [numKey(a.no), numKey(b.no)];
    return ka[0] - kb[0] || ka[1] - kb[1] || String(a.no).localeCompare(String(b.no));
  });
}

/** Firestore 기록 → {no, dateKey, level, mode, score, totalQuestions} (번호 없으면 null) */
function resultRow(f) {
  if (f.studentNo == null) return null;
  return {
    no: String(f.studentNo), dateKey: String(f.dateKey || ''), level: String(f.level || ''), mode: String(f.mode || ''),
    score: f.score ?? null, totalQuestions: typeof f.totalQuestions === 'number' ? f.totalQuestions : null,
    ts: typeof f.ts === 'number' ? f.ts : 0, seq: typeof f.seq === 'string' ? f.seq : null,
  };
}

/**
 * 기록 → 통과 기록에 더하기. passes = {번호: {레벨: 처음 통과한 날}}
 * 통과 = 도전 점수가 통과 점수 이상 (분수 연산 마스터에서 다음 레벨 도전이 열리는 기준)
 */
export function addPasses(passes, rows) {
  for (const r of rows) {
    const score = challengeScore(r);
    if (score == null || score < passScore(r.level) || !r.dateKey) continue;
    const mine = passes[r.no] || (passes[r.no] = {});
    if (!mine[r.level] || r.dateKey < mine[r.level]) mine[r.level] = r.dateKey;
  }
  return passes;
}

/**
 * 기록 → 날짜별 가장 높은 도전 점수에 더하기. best = {번호: {레벨: {날짜: 점수}}}
 * (중도 포기·문제 수 미달은 점수로 안 침)
 */
export function addBest(best, rows) {
  for (const r of rows) {
    const score = challengeScore(r);
    if (score == null || !r.dateKey || !r.level) continue;
    const byLevel = best[r.no] || (best[r.no] = {});
    const byDate = byLevel[r.level] || (byLevel[r.level] = {});
    if (!(byDate[r.dateKey] >= score)) byDate[r.dateKey] = score;
  }
  return best;
}

/** day 전에 그 레벨을 도전한 가장 최근 날과 그날 가장 높은 점수 {date, score} (없으면 null) */
export function lastScore(byDate, day) {
  let date = '';
  for (const d of Object.keys(byDate || {})) if (d < day && d > date) date = d;
  return date ? { date, score: byDate[date] } : null;
}

/**
 * day 에 풀어야 하는 '자기 최고 레벨': day 전까지 통과한 가장 높은 레벨의 다음 레벨.
 * 하나도 통과 못 했으면 L1, 마지막 레벨까지 통과했으면 ''.
 */
export function requiredLevel(passesOfStudent, day) {
  let top = -1;
  for (const [level, date] of Object.entries(passesOfStudent || {})) {
    const i = LEVEL_ORDER.indexOf(level);
    if (i > top && date < day) top = i;
  }
  return top < 0 ? LEVEL_ORDER[0] : (LEVEL_ORDER[top + 1] || '');
}

export class MathPracticeClient {
  constructor(classCode, { fetchImpl, base = DEFAULT_BASE, apiKey = DEFAULT_API_KEY } = {}) {
    this.code = String(classCode || '').trim().toUpperCase();
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.base = base;
    this.apiKey = apiKey;
  }

  url(path, params = {}) {
    const q = new URLSearchParams(params);
    if (this.apiKey) q.set('key', this.apiKey);
    const qs = q.toString();
    return `${this.base}/${path}${qs ? `?${qs}` : ''}`;
  }

  async call(path, { body, params } = {}) {
    let res;
    try {
      res = await this.fetch(this.url(path, params), {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: timeoutSignal(TIMEOUT_MS),
      });
    } catch {
      throw new MathError('network', '분수 연산 마스터에 연결하지 못했어요 (인터넷 연결 확인)');
    }
    if (res.status === 404) throw new MathError('notfound', `반 코드 '${this.code}'를 찾을 수 없어요`, 404);
    if (res.status === 429) {
      throw new MathError('quota', '분수 연산 마스터의 오늘 무료 사용량이 끝났어요. 오후 4시 이후 다시 됩니다.', 429);
    }
    if (res.status === 401 || res.status === 403) throw new MathError('denied', '분수 연산 마스터가 접근을 거부했어요', 403);
    if (!res.ok) throw new MathError('http', `분수 연산 마스터 오류 (HTTP ${res.status})`);
    return res.json();
  }

  async fetchClass() {
    const f = fields(await this.call(`classes/${encodeURIComponent(this.code)}`));
    return {
      name: f.name || '',
      archived: Boolean(f.archived),
      offDays: parseOffDays(f.offDays || []),
      basicStart: parseBasicStart(f.basicStart),
    };
  }

  async fetchStudents() {
    const out = [];
    let pageToken;
    do {
      const params = { pageSize: '300' };
      if (pageToken) params.pageToken = pageToken;
      const res = await this.call(`classes/${encodeURIComponent(this.code)}/students`, { params });
      for (const doc of res.documents || []) {
        const f = fields(doc);
        const no = String(f.number ?? doc.name.split('/').pop());
        out.push({ no, name: String(f.name || '') });
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
    return sortByNo(out);
  }

  /**
   * runQuery 를 끝까지 나눠 읽는다 (한 번에 PAGE 건). orderBy 마지막은 문서 이름이라 겹치거나 빠지지 않는다.
   * order: 범위 조건이 있는 필드 (그 필드로 먼저 정렬해야 함). 없으면 문서 이름 순.
   */
  async queryAll(where, order = '') {
    const PAGE = 1000;
    const orderBy = [...(order ? [{ field: { fieldPath: order }, direction: 'ASCENDING' }] : []),
      { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }];
    const out = [];
    let cursor = null;
    for (;;) {
      const structuredQuery = { from: [{ collectionId: 'results' }], where, orderBy, limit: PAGE };
      if (cursor) structuredQuery.startAt = { values: cursor, before: false };
      const rows = (await this.call(`classes/${encodeURIComponent(this.code)}:runQuery`, { body: { structuredQuery } })) || [];
      const docs = rows.filter((r) => r.document).map((r) => r.document);
      out.push(...docs);
      if (docs.length < PAGE) return out;
      const last = docs[docs.length - 1];
      cursor = [...(order ? [last.fields[order]] : []), { referenceValue: last.name }];
    }
  }

  /**
   * 반 전체 도전 기록(끝까지 푼 판 + 중간에 그만둔·일찍 통과한 판) — 통과 기록을 처음 만들 때 한 번만.
   * 새 통과 규칙은 중간에 그만둔 판의 문제도 이어 붙여 세서 aborted 도 읽는다.
   */
  async fetchChallengeHistory() {
    const docs = await this.queryAll({
      fieldFilter: {
        field: { fieldPath: 'mode' }, op: 'IN',
        value: { arrayValue: { values: [{ stringValue: 'challenge' }, { stringValue: 'aborted' }] } },
      },
    });
    return docs.map((d) => resultRow(fields(d))).filter(Boolean);
  }

  /** dateKey 가 since 보다 뒤인 모든 기록(연습·도전) [{no, dateKey, level, mode, score, totalQuestions}] */
  async fetchResultsSince(since) {
    const docs = await this.queryAll(
      { fieldFilter: { field: { fieldPath: 'dateKey' }, op: 'GREATER_THAN', value: { stringValue: since } } }, 'dateKey');
    return docs.map((d) => resultRow(fields(d))).filter(Boolean);
  }

  /**
   * dateKey(한국 시간) 하루 동안 분수 연산 마스터에 접속(로그인)한 학생 번호 Set.
   * 학생이 화면을 켜고 들어오면 연습·도전을 안 풀어도 접속 기록(logs)이 남는다.
   */
  async fetchAccessed(dateKey) {
    const [start, end] = kstDayRange(dateKey);
    const range = (op, v) => ({ fieldFilter: { field: { fieldPath: 'ts' }, op, value: { integerValue: String(v) } } });
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'logs' }],
        where: { compositeFilter: { op: 'AND', filters: [range('GREATER_THAN_OR_EQUAL', start), range('LESS_THAN', end)] } },
        limit: 5000,
      },
    };
    const rows = await this.call(`classes/${encodeURIComponent(this.code)}:runQuery`, { body });
    const accessed = new Set();
    for (const row of rows || []) {
      if (!row.document) continue;
      const f = fields(row.document);
      if (f.studentNo != null) accessed.add(String(f.studentNo));
    }
    return accessed;
  }

  /** dateKey 날짜의 연습·도전 기록(중간에 그만둔 것 포함) [{no, level, mode, score, totalQuestions}] */
  async fetchDayResults(dateKey) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'results' }],
        where: { fieldFilter: { field: { fieldPath: 'dateKey' }, op: 'EQUAL', value: { stringValue: dateKey } } },
        limit: 5000,
      },
    };
    const rows = await this.call(`classes/${encodeURIComponent(this.code)}:runQuery`, { body });
    return (rows || []).filter((row) => row.document).map((row) => resultRow(fields(row.document))).filter(Boolean);
  }
}

/**
 * 하루 기록 → 학생별 레벨·점수.
 *   scores: 레벨마다 그날 가장 높은 도전 점수 [{level, score}] (레벨 순)
 *   practice: 점수 없이 연습만 한 레벨
 */
export function summarizeDay(rows) {
  const by = new Map();
  for (const r of rows) {
    const e = by.get(r.no) || { scores: new Map(), practice: new Set() };
    by.set(r.no, e);
    const score = challengeScore(r);
    if (score == null) {
      if (r.level) e.practice.add(r.level);
    } else if (!e.scores.has(r.level) || score > e.scores.get(r.level)) {
      e.scores.set(r.level, score);
    }
  }
  const out = new Map();
  for (const [no, e] of by) {
    const byLevel = (a, b) => levelIndex(a) - levelIndex(b);
    const scores = [...e.scores.keys()].sort(byLevel).map((level) => ({ level, score: e.scores.get(level) }));
    out.set(no, {
      scores,
      practice: [...e.practice].filter((lv) => !e.scores.has(lv)).sort(byLevel),
    });
  }
  return out;
}

const isObj = (x) => Boolean(x) && typeof x === 'object';

/**
 * 통과 기록 passes {번호: {레벨: 처음 통과한 날}} 과 날짜별 도전 점수 best {번호: {레벨: {날짜: 점수}}} 를 받아 온다.
 * passCache({load(code)→{through, passes, best}|null, save(code, {through, passes, best})}) 가 있으면
 * 저장해 둔 것에 through 다음 날부터의 기록만 더한다 (처음 한 번만 반 전체 도전 기록을 읽음).
 * 점수 기록(best)이 없는 예전 저장본이면 한 번 반 전체를 다시 읽는다.
 */
async function loadPasses(client, passCache, today) {
  const saved = passCache ? await passCache.load(client.code).catch(() => null) : null;
  let passes, best, windows, hits, rows;
  // 통과 규칙이 바뀌기 전 저장본(PASS_VERSION 이 다름)은 버리고 반 전체를 다시 읽는다
  if (saved && saved.v === PASS_VERSION && typeof saved.through === 'string'
    && isObj(saved.passes) && isObj(saved.best) && isObj(saved.windows) && isObj(saved.hits)) {
    ({ passes, best, windows, hits } = saved);
    rows = await client.fetchResultsSince(saved.through);
  } else {
    passes = {}; best = {}; windows = {}; hits = {};
    rows = await client.fetchChallengeHistory();
  }
  // 오늘 기록은 넣지 않는다: 이어 붙이는 창이 다음에 오늘 것을 또 넣으면 틀어진다 (판정은 어제까지만 씀)
  rows = rows.filter((r) => r.dateKey && r.dateKey < today);
  addProgress(passes, windows, rows, hits);
  addBest(best, rows);
  if (passCache) {
    await passCache.save(client.code, { v: PASS_VERSION, through: addDays(today, -1), passes, best, windows, hits }).catch(() => {});
  }
  return { passes, best, hits };
}

const isStrict = (day) => day >= STRICT_FROM;
const isLevelRule = (day) => day >= LEVEL_FROM;
const isScoreRule = (day) => day >= SCORE_FROM;
const isHitRule = (day) => day >= HIT_FROM;

/** day 전에 그 레벨을 푼 가장 최근 날의 맞힌 개수 {date, c} (없으면 null) */
export function lastHit(byDate, day) {
  let date = '';
  for (const d of Object.keys(byDate || {})) if (d < day && d > date) date = d;
  return date ? { date, c: byDate[date].c } : null;
}

/** HIT_FROM 부터의 '했다' (위 설명). rows 는 그날 기록 */
function judgeHitDay(day, rows, passes, hits, basicStart) {
  const byNo = new Map();
  for (const r of rows) (byNo.get(r.no) || byNo.set(r.no, []).get(r.no)).push(r);
  const done = new Set();
  const lower = new Map();
  const notBeat = new Map();
  for (const [no, mine] of byNo) {
    const need = todayLevel(passes[no], basicStart[no], day);
    if (!need || passes[no]?.[need] === day) { done.add(no); continue; } // 다 끝냈거나 그날 통과
    const onNeed = mine.filter((r) => r.level === need && (r.mode === 'challenge' || r.mode === 'aborted')).sort(byTime);
    if (!onNeed.length) {
      const solved = new Map(); // 다른 레벨만 풂 → 가장 많이 푼 레벨을 보여 줌
      for (const r of mine) solved.set(r.level, (solved.get(r.level) || 0) + (r.seq?.length || r.totalQuestions || 1));
      const did = [...solved].sort((a, b) => b[1] - a[1])[0][0];
      lower.set(no, { did, need });
      continue;
    }
    const seq = onNeed.map((r) => (typeof r.seq === 'string' && SEQ_RE.test(r.seq) ? r.seq : '')).join('');
    const { size } = passWindow(need);
    const c = bestWindow(seq, size);
    const prev = lastHit(hits[no]?.[need], day);
    if (prev ? c > prev.c : seq.length >= size) done.add(no);
    else notBeat.set(no, { level: need, hits: c, solved: seq.length, size, prev: prev ? prev.c : null, prevDate: prev ? prev.date : '' });
  }
  return { done, lower, notBeat };
}

/**
 * day 하루의 기록·접속으로 '했다'인 학생과, 안 한 까닭.
 *   rows: 그날 기록, accessed: 그날 접속한 번호 Set, passes: 통과 기록, best: 날짜별 도전 점수
 *   → { done: Set, lower: Map 번호 → {did, need}, notBeat: Map 번호 → {level, score, prev, prevDate} }
 *     lower: 자기 최고 레벨보다 낮은 레벨만 풂
 *     notBeat: 자기 최고 레벨은 풀었지만 전날 점수를 못 넘음 (score 가 null 이면 연습만 하고 도전은 안 함)
 */
export function judgeDay(day, rows, accessed, passes, best = {}, hits = {}, basicStart = {}) {
  if (isHitRule(day)) return judgeHitDay(day, rows, passes, hits, basicStart);
  const withRecord = new Set(rows.map((r) => r.no));
  if (!isStrict(day)) return { done: new Set([...withRecord, ...accessed]), lower: new Map(), notBeat: new Map() };
  if (!isLevelRule(day)) return { done: withRecord, lower: new Map(), notBeat: new Map() };
  const top = new Map(); // 번호 → 그날 푼 가장 높은 레벨 순서
  for (const r of rows) top.set(r.no, Math.max(top.get(r.no) ?? -1, levelIndex(r.level)));
  const done = new Set();
  const lower = new Map();
  const notBeat = new Map();
  for (const [no, i] of top) {
    const need = requiredLevel(passes[no], day);
    const needIndex = LEVEL_ORDER.indexOf(need);
    if (!need || i > needIndex) done.add(no);
    else if (i < needIndex) lower.set(no, { did: LEVEL_ORDER[i], need });
    else if (!isScoreRule(day)) done.add(no);
    else if (passes[no]?.[need] === day) done.add(no); // 그날 통과(새 앱의 자동 통과는 점수가 없음)도 상승
    else {
      let score = null; // 그날 그 레벨 도전에서 가장 높은 점수
      for (const r of rows) {
        const s = r.no === no && r.level === need ? challengeScore(r) : null;
        if (s != null && (score == null || s > score)) score = s;
      }
      const prev = lastScore(best[no]?.[need], day);
      if (score != null && (!prev || score > prev.score)) done.add(no);
      else notBeat.set(no, { level: need, score, prev: prev ? prev.score : null, prevDate: prev ? prev.date : '' });
    }
  }
  return { done, lower, notBeat };
}

/**
 * 이전 등교일에 수학을 하지 않은 학생 목록.
 * - roster 가 있으면 번호가 같은 학생의 이름은 우리 반 명단 이름을 쓴다.
 * - excludeNames 에 있는 이름은 세지 않는다.
 * - 마지막 레벨(FINAL_LEVEL)을 통과한 학생은 모든 레벨을 끝낸 것이라 자동으로 세지 않는다 (누적도 안 셈).
 * - absent({'날짜_번호': true}) 에 있는 학생은 그날 결석이라 그날 명단·누적에서 뺀다 (차감).
 * - '했다' 기준은 날짜마다 다르다 (STRICT_FROM·LEVEL_FROM·SCORE_FROM 위 설명, judgeDay).
 *   안 한 학생에는 까닭을 붙인다: accessOnly(접속만), lower({did, need}: 낮은 레벨만 풂),
 *   notBeat({level, score, prev, prevDate}: 전날 점수를 못 넘음, score null 이면 도전 안 함)
 * - 누적: countStart 부터 이전 등교일까지 등교일마다 '안 한 날'을 학생별로 센다.
 *   cleared[번호] = 'YYYY-MM-DD' 이면 그 날까지의 횟수는 지운 것(해제)이라 다음 날부터 센다.
 *   limit 이상이면 overLimit 에 담는다.
 * - 레벨·점수: 이전 등교일에 기록이 있는 학생마다 그날 도전 점수와, 처음 통과한 레벨(레벨 상승)을 담는다.
 * - dayCache({load(classCode)→{날짜:[번호…]}, save(classCode, {날짜:[번호…]})}) 를 주면 지난 날짜의
 *   '한 학생' 목록을 저장해 두고 다시 조회하지 않는다 (분수 연산 마스터의 무료 읽기 한도 절약).
 * - passCache 를 주면 통과 기록을 저장해 두고 새 날짜 것만 더 읽는다 (loadPasses).
 * - baseCache({load(classCode)→base|null, save(classCode, base)}) 를 주면 오늘 한 번 받은
 *   반 정보·명단·통과 기록·이전 등교일 기록을 오늘 하루 동안 다시 쓴다. 이전 등교일은 이미 끝난 날이라
 *   하루 안에 결과가 바뀌지 않는다. refresh 면 무시하고 새로 받는다 (새로고침 버튼).
 */
export async function buildReport({
  classCode, offDays = [], roster = [], excludeNames = [], now = new Date(), fetchImpl, base,
  countStart = DEFAULT_COUNT_START, limit = DEFAULT_LIMIT, cleared = {}, absent = {}, dayCache = null,
  baseCache = null, passCache = null, refresh = false,
} = {}) {
  if (!classCode) throw new MathError('nocode', '우리 반 탭에서 수학 반 코드를 먼저 적어 주세요', 400);
  const client = new MathPracticeClient(classCode, { fetchImpl, base });
  const today = todayKST(now);

  // 오늘 이미 받아 둔 것이 있으면 분수 연산 마스터를 부르지 않는다
  let saved = null;
  if (baseCache && !refresh) {
    saved = await baseCache.load(client.code).catch(() => null);
    // 통과 기록이 없던 예전 형식이면 새로 받는다
    if (saved?.date !== today || !Array.isArray(saved.prevRows) || !isObj(saved.passes) || !isObj(saved.best)
      || saved.v !== PASS_VERSION || !isObj(saved.hits) || !isObj(saved.cls?.basicStart)) saved = null;
  }
  let cls, students, passes, best, hits;
  if (saved) {
    ({ cls, students, passes, best, hits } = saved);
  } else {
    let history;
    [cls, students, history] = await Promise.all([
      client.fetchClass(), client.fetchStudents(), loadPasses(client, passCache, today),
    ]);
    ({ passes, best, hits } = history);
  }
  const cal = new SchoolCalendar([...offDays, ...cls.offDays]);
  const prev = cal.prevSchoolDay(today);
  if (!prev) throw new MathError('http', '이전 등교일을 찾을 수 없어요');

  let prevRows, accessed;
  if (saved && saved.prev === prev) {
    prevRows = saved.prevRows;
    accessed = new Set(saved.accessed);
  } else {
    [prevRows, accessed] = await Promise.all([client.fetchDayResults(prev), client.fetchAccessed(prev)]);
  }
  if (baseCache && !(saved && saved.prev === prev)) {
    await baseCache.save(client.code, {
      v: PASS_VERSION, date: today, cls, students, passes, best, hits, prev, prevRows, accessed: [...accessed],
    }).catch(() => {});
  }
  const withRecord = new Set(prevRows.map((r) => r.no));
  const basicStart = cls.basicStart || {};
  const { done, lower, notBeat } = judgeDay(prev, prevRows, accessed, passes, best, hits, basicStart);

  const isAbsent = (no, day) => absent[absentKey(day, no)] === true;

  const nameByNo = new Map(roster.map((s) => [String(s.no), s.name]));
  const excludeSet = new Set(excludeNames.map((n) => String(n).trim()).filter(Boolean));
  const counted = [];
  const graduated = [];
  const excluded = [];
  for (const s of students) {
    const name = nameByNo.get(s.no) || s.name;
    const entry = { no: s.no, name };
    if (excludeSet.has(name) || excludeSet.has(s.name)) excluded.push(entry);
    // 다 끝낸 학생: L36 통과. HIT_FROM 부터는 게다가 통과 못 한 기초가 없어야 (학생 화면 '오늘 할 것'에 기초가 남음)
    else if (passes[s.no]?.[FINAL_LEVEL] && (!isHitRule(prev) || !isBasic(todayLevel(passes[s.no], basicStart[s.no], '9999-12-31')))) {
      graduated.push(entry);
    }
    else counted.push(entry);
  }
  // 이전 등교일에 결석으로 적어 둔 학생은 그날 명단에서 뺀다 (했어도 결석으로 적었으면 뺌)
  const absentPrev = counted.filter((s) => isAbsent(s.no, prev));
  const present = counted.filter((s) => !isAbsent(s.no, prev));
  const hold = HOLD_DAYS.includes(prev);
  const missing = present.filter((s) => !hold && !done.has(s.no)).map((s) => ({
    ...s,
    accessOnly: !withRecord.has(s.no) && accessed.has(s.no), // 접속만 하고 안 풂
    lower: lower.get(s.no) || null,                           // 자기 최고 레벨보다 낮은 레벨만 풂 {did, need}
    notBeat: notBeat.get(s.no) || null,                       // 전날 점수를 못 넘음 {level, score|null, prev|null, prevDate}
  }));
  const accessOnly = missing.filter((s) => s.accessOnly);

  // ---- 레벨·점수 (이전 등교일에 기록이 있는 학생, 항상 뺄 이름 제외) ----
  const day = summarizeDay(prevRows);
  const progress = [...counted, ...graduated]
    .filter((s) => withRecord.has(s.no))
    .map((s) => {
      const d = day.get(s.no) || { scores: [], practice: [] };
      // 그날 처음 통과한 레벨 중 가장 높은 것 = 레벨 상승
      const ups = Object.entries(passes[s.no] || {}).filter(([, date]) => date === prev).map(([level]) => level);
      const passed = ups.sort((a, b) => levelIndex(b) - levelIndex(a))[0] || '';
      return {
        ...s,
        levelUp: passed ? { passed, next: nextLevel(passed) } : null,
        scores: d.scores,
        practice: d.practice,
        need: lower.get(s.no)?.need || '', // 자기 최고 레벨을 안 풀었으면 그 레벨
        notBeat: notBeat.get(s.no) || null, // 자기 최고 레벨에서 전날 점수를 못 넘었으면 {level, score, prev, prevDate}
      };
    })
    .sort((a, b) => Number(Boolean(b.levelUp)) - Number(Boolean(a.levelUp))
      || Number(b.scores.length > 0) - Number(a.scores.length > 0)
      || Number(a.no) - Number(b.no));

  // ---- 누적 ----
  const days = (countStart <= prev ? cal.daysBetween(countStart, prev) : []).filter((d) => !HOLD_DAYS.includes(d));
  const doneByDay = new Map([[prev, done]]);
  const known = dayCache ? await dayCache.load(client.code) : {};
  if (known.rule !== DONE_RULE) { // 예전 기준으로 저장한 새 기준 날짜는 버리고 다시 센다
    for (const d of Object.keys(known)) if (isStrict(d)) delete known[d];
  }
  const todo = days.filter((d) => d !== prev && !doneByDay.has(d));
  const fromCache = todo.filter((d) => Array.isArray(known[d]));
  for (const d of fromCache) doneByDay.set(d, new Set(known[d]));
  const toFetch = todo.filter((d) => !Array.isArray(known[d]));
  const fresh = {};
  for (let i = 0; i < toFetch.length; i += 5) { // 5일씩 묶어서 동시에
    await Promise.all(toFetch.slice(i, i + 5).map(async (d) => {
      const [rows, acc] = await Promise.all([client.fetchDayResults(d), isStrict(d) ? new Set() : client.fetchAccessed(d)]);
      const set = judgeDay(d, rows, acc, passes, best, hits, basicStart).done;
      doneByDay.set(d, set);
      fresh[d] = [...set];
    }));
  }
  if (!Array.isArray(known[prev]) && days.includes(prev)) fresh[prev] = [...done]; // 이전 등교일은 이미 끝난 날
  if (dayCache && Object.keys(fresh).length) await dayCache.save(client.code, { ...known, ...fresh, rule: DONE_RULE });

  const counts = {};
  for (const s of counted) {
    const from = cleared[s.no] || '';
    counts[s.no] = days.filter((d) => d > from && !isAbsent(s.no, d) && !doneByDay.get(d).has(s.no)).length;
  }
  const byCount = (a, b) => b.count - a.count || Number(a.no) - Number(b.no);
  const watch = counted
    .filter((s) => counts[s.no] >= 1 && counts[s.no] < limit)
    .map((s) => ({ ...s, count: counts[s.no] }))
    .sort(byCount);
  const overLimit = counted
    .filter((s) => counts[s.no] >= limit)
    .map((s) => ({ ...s, count: counts[s.no] }))
    .sort(byCount);

  return {
    classCode: client.code,
    className: cls.name,
    dateKey: prev,
    dateLabel: label(prev),
    missing,      // 안 한 학생 [{no, name, accessOnly, lower:{did,need}|null, notBeat:{level,score,prev,prevDate}|null}]
    done: present.length - missing.length,
    total: present.length,
    graduated,   // 마지막 레벨 통과로 자동 제외 [{no, name}]
    excluded,
    absent: absentPrev,   // 이전 등교일 결석으로 뺀 학생 [{no, name}]
    students: counted,    // 세는 학생 전체 (결석 처리 화면용) [{no, name}]
    accessOnly: accessOnly.length, // 접속만 하고 풀지 않아 '안 함'으로 센 학생 수
    lowerLevel: missing.filter((s) => s.lower).length, // 자기 최고 레벨보다 낮은 레벨만 풀어 '안 함'으로 센 학생 수
    notBeatCount: missing.filter((s) => s.notBeat).length, // 전날 점수를 못 넘어(또는 도전 안 해) '안 함'으로 센 학생 수
    levelRule: isLevelRule(prev), // 이전 등교일에 '자기 최고 레벨' 기준을 쓰는지
    scoreRule: isScoreRule(prev), // 이전 등교일에 '전날 점수 넘기' 기준을 쓰는지
    hitRule: isHitRule(prev),     // 이전 등교일에 '오늘 할 것 레벨 · 맞힌 개수' 기준을 쓰는지 (11/18~)
    progress,     // 이전 등교일에 기록 있는 학생의 레벨·점수 [{no, name, levelUp:{passed,next}|null, scores:[{level,score}], practice, need}]
    levelUps: progress.filter((s) => s.levelUp).length,
    countStart,
    limit,
    countedDays: days.length,
    counts,       // 번호 → 누적 횟수 (세는 학생만)
    overLimit,    // 누적 limit 회 이상 [{no, name, count}]
    watch,        // 1회 이상 limit 회 미만 (지켜볼 학생)
    finalLevel: FINAL_LEVEL,
    fetchedAt: timeKST(now),
    fetchedDate: today,
    todayOff: cal.whyOff(today),
    hold,         // 판단 보류한 날이면 true (안 한 학생 명단을 비움, 누적에도 안 셈)
  };
}
