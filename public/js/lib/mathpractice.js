// 분수 연산 마스터(mathpractice) 읽기 — 예전 math_alert.py 를 옮긴 것
// mathpractice 의 Firestore 는 반 코드만 알면 명단·기록을 읽을 수 있다 (REST, 키는 공개용 웹 키).
// 브라우저와 Node(테스트) 양쪽에서 동작한다.

import { SchoolCalendar, parseOffDays, todayKST, timeKST, label } from './schoolday.js';

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

/** 레벨 다음 레벨 이름 (마지막 레벨이면 '') */
export function nextLevel(level) {
  const i = LEVEL_ORDER.indexOf(level);
  return i >= 0 && i < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[i + 1] : '';
}

const levelIndex = (level) => {
  const i = LEVEL_ORDER.indexOf(level);
  return i < 0 ? LEVEL_ORDER.length : i;
};

/** 점수로 인정되는 도전 기록이면 점수, 아니면 null (중도 포기·문제 수 미달은 점수로 안 침) */
function challengeScore(r) {
  if (r.mode !== 'challenge' || r.score == null || Number.isNaN(Number(r.score))) return null;
  if (typeof r.totalQuestions === 'number' && LEVEL_CHAL_Q[r.level] && r.totalQuestions < LEVEL_CHAL_Q[r.level]) return null;
  return Number(r.score);
}

// 예전 마지막 단계. 10/27(화) 기록까지는 이 단계를 통과한 학생을 세지 않았다.
export const FINAL_LEVEL = 'L27';
export const FINAL_PASS_SCORE = passScore(FINAL_LEVEL); // 216

// 레벨(L28~L36)이 추가되어 이 날 화면부터는 L27 통과 학생도 센다 (항상 뺄 이름만 빼고 모두).
//   이 날의 이전 등교일 기록부터 센다: 10/28 화면 = 10/27 기록부터
export const ALL_COUNT_FROM = '2026-10-28';

// 누적 세기: 이 날부터 등교일마다 '안 한 날'을 세고, 이 횟수 이상이면 벌 대상으로 따로 보여 준다
export const DEFAULT_COUNT_START = '2026-10-08';
export const DEFAULT_LIMIT = 3;

// 수학 확인에서 항상 빼는 이름 (우리 반 탭에서 바꿀 수 있음)
export const DEFAULT_EXCLUDE_TEXT = '전지현\n테스트';

/** 한국 시간 하루 [시작, 다음 날 시작) 의 밀리초. 접속 기록(logs)의 ts 가 밀리초라서 필요 */
export function kstDayRange(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d) - 9 * 3600 * 1000;
  return [start, start + 24 * 3600 * 1000];
}

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

  /** 한 레벨의 도전 기록 [{no, dateKey, score}] (점수로 인정되는 것만) */
  async fetchChallenges(level) {
    const eq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } });
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'results' }],
        where: { compositeFilter: { op: 'AND', filters: [eq('level', level), eq('mode', 'challenge')] } },
        limit: 5000,
      },
    };
    const rows = await this.call(`classes/${encodeURIComponent(this.code)}:runQuery`, { body });
    const out = [];
    for (const row of rows || []) {
      if (!row.document) continue;
      const f = fields(row.document);
      const score = challengeScore(f);
      if (f.studentNo != null && score != null) out.push({ no: String(f.studentNo), dateKey: String(f.dateKey || ''), score });
    }
    return out;
  }

  /** 마지막 단계(L27)를 통과한 학생 → 처음 통과한 날 (Map 번호 → 'YYYY-MM-DD') */
  async fetchFinalPassed() {
    const passed = new Map();
    for (const r of await this.fetchChallenges(FINAL_LEVEL)) {
      if (r.score < FINAL_PASS_SCORE) continue;
      if (!passed.has(r.no) || r.dateKey < passed.get(r.no)) passed.set(r.no, r.dateKey);
    }
    return passed;
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
    const out = [];
    for (const row of rows || []) {
      if (!row.document) continue;
      const f = fields(row.document);
      if (f.studentNo == null) continue;
      out.push({
        no: String(f.studentNo), level: String(f.level || ''), mode: String(f.mode || ''),
        score: f.score ?? null, totalQuestions: typeof f.totalQuestions === 'number' ? f.totalQuestions : null,
      });
    }
    return out;
  }

  /** dateKey 날짜에 연습·도전 기록(중간에 그만둔 것 포함)이 있는 학생 번호 Set */
  async fetchDone(dateKey) {
    return new Set((await this.fetchDayResults(dateKey)).map((r) => r.no));
  }
}

/**
 * 하루 기록 → 학생별 레벨·점수.
 *   scores: 레벨마다 그날 가장 높은 도전 점수 [{level, score}] (레벨 순)
 *   practice: 점수 없이 연습만 한 레벨
 *   passed: 그날 통과 점수를 넘은 레벨 (전에 이미 통과했는지는 따지지 않음)
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
      passed: scores.filter((s) => s.score >= passScore(s.level)).map((s) => s.level),
    });
  }
  return out;
}

/**
 * 이전 등교일에 수학을 하지 않은 학생 목록.
 * - roster 가 있으면 번호가 같은 학생의 이름은 우리 반 명단 이름을 쓴다.
 * - excludeNames 에 있는 이름은 세지 않는다.
 * - 마지막 단계(L27)를 통과한 학생은 ALL_COUNT_FROM 화면 전까지(그 이전 등교일 기록 전까지) 세지 않는다.
 *   L28~L36 이 생겨서 그 뒤로는 모두 센다. 누적도 그 날부터만 센다.
 * - '했다' 기준: 그날 분수 연산 마스터에 접속했거나(화면을 켜서 시작), 연습·도전 기록이 있으면.
 * - 누적: countStart 부터 이전 등교일까지 등교일마다 '안 한 날'을 학생별로 센다.
 *   cleared[번호] = 'YYYY-MM-DD' 이면 그 날까지의 횟수는 지운 것(해제)이라 다음 날부터 센다.
 *   limit 이상이면 overLimit 에 담는다.
 * - 레벨·점수: 이전 등교일에 한 학생마다 그날 도전 점수와, 처음 통과한 레벨(레벨 상승)을 담는다.
 * - dayCache({load(classCode)→{날짜:[번호…]}, save(classCode, {날짜:[번호…]})}) 를 주면 지난 날짜의
 *   '한 학생' 목록을 저장해 두고 다시 조회하지 않는다 (분수 연산 마스터의 무료 읽기 한도 절약).
 * - baseCache({load(classCode)→base|null, save(classCode, base)}) 를 주면 오늘 한 번 받은
 *   반 정보·명단·L27 통과·이전 등교일 기록을 오늘 하루 동안 다시 쓴다. 이전 등교일은 이미 끝난 날이라
 *   하루 안에 결과가 바뀌지 않는다. refresh 면 무시하고 새로 받는다 (새로고침 버튼).
 */
export async function buildReport({
  classCode, offDays = [], roster = [], excludeNames = [], now = new Date(), fetchImpl, base,
  countStart = DEFAULT_COUNT_START, limit = DEFAULT_LIMIT, cleared = {}, dayCache = null,
  baseCache = null, refresh = false,
} = {}) {
  if (!classCode) throw new MathError('nocode', '우리 반 탭에서 수학 반 코드를 먼저 적어 주세요', 400);
  const client = new MathPracticeClient(classCode, { fetchImpl, base });
  const today = todayKST(now);

  // 오늘 이미 받아 둔 것이 있으면 분수 연산 마스터를 부르지 않는다
  let saved = null;
  if (baseCache && !refresh) {
    saved = await baseCache.load(client.code).catch(() => null);
    // 레벨·점수가 없던 예전 형식이면 새로 받는다
    if (saved?.date !== today || !Array.isArray(saved.prevRows) || !Array.isArray(saved.finalPassed?.[0] ?? [])) saved = null;
  }
  let cls, students, finalPassed;
  if (saved) {
    ({ cls, students } = saved);
    finalPassed = new Map(saved.finalPassed);
  } else {
    [cls, students, finalPassed] = await Promise.all([
      client.fetchClass(), client.fetchStudents(), client.fetchFinalPassed(),
    ]);
  }
  const cal = new SchoolCalendar([...offDays, ...cls.offDays]);
  const prev = cal.prevSchoolDay(today);
  if (!prev) throw new MathError('http', '이전 등교일을 찾을 수 없어요');

  let prevRows, accessed, levelUps;
  if (saved && saved.prev === prev) {
    prevRows = saved.prevRows;
    accessed = new Set(saved.accessed);
    levelUps = saved.levelUps;
  } else {
    [prevRows, accessed] = await Promise.all([client.fetchDayResults(prev), client.fetchAccessed(prev)]);
    // 그날 통과한 레벨이 전에 이미 통과한 레벨이 아니면 '레벨 상승' (레벨마다 한 번만 조회)
    const passedToday = [];
    for (const [no, d] of summarizeDay(prevRows)) for (const level of d.passed) passedToday.push([no, level]);
    const levels = [...new Set(passedToday.map(([, level]) => level))];
    const before = new Map(await Promise.all(levels.map(async (level) => {
      const rows = await client.fetchChallenges(level);
      return [level, new Set(rows.filter((r) => r.dateKey < prev && r.score >= passScore(level)).map((r) => r.no))];
    })));
    levelUps = passedToday.filter(([no, level]) => !before.get(level).has(no));
  }
  if (baseCache && !(saved && saved.prev === prev)) {
    await baseCache.save(client.code, {
      date: today, cls, students, finalPassed: [...finalPassed], prev, prevRows, accessed: [...accessed], levelUps,
    }).catch(() => {});
  }
  const withRecord = new Set(prevRows.map((r) => r.no));
  const done = new Set([...withRecord, ...accessed]);

  // L27 통과 학생을 빼는 마지막 날: ALL_COUNT_FROM 화면의 이전 등교일 전날까지
  const allFrom = cal.prevSchoolDay(ALL_COUNT_FROM) || ALL_COUNT_FROM;
  const exempt = (no, day) => day < allFrom && finalPassed.has(no) && finalPassed.get(no) < allFrom;

  const nameByNo = new Map(roster.map((s) => [String(s.no), s.name]));
  const excludeSet = new Set(excludeNames.map((n) => String(n).trim()).filter(Boolean));
  const counted = [];
  const graduated = [];
  const excluded = [];
  for (const s of students) {
    const name = nameByNo.get(s.no) || s.name;
    const entry = { no: s.no, name };
    if (excludeSet.has(name) || excludeSet.has(s.name)) excluded.push(entry);
    else if (exempt(s.no, prev)) graduated.push(entry);
    else counted.push(entry);
  }
  const missing = counted.filter((s) => !done.has(s.no));
  const accessOnly = counted.filter((s) => accessed.has(s.no) && !withRecord.has(s.no));

  // ---- 레벨·점수 (이전 등교일에 한 학생, 항상 뺄 이름 제외) ----
  const day = summarizeDay(prevRows);
  const upByNo = new Map();
  for (const [no, level] of levelUps) {
    if (!upByNo.has(no) || levelIndex(level) > levelIndex(upByNo.get(no))) upByNo.set(no, level);
  }
  const progress = [...counted, ...graduated]
    .filter((s) => done.has(s.no))
    .map((s) => {
      const d = day.get(s.no) || { scores: [], practice: [] };
      const passed = upByNo.get(s.no) || '';
      return {
        ...s,
        levelUp: passed ? { passed, next: nextLevel(passed) } : null,
        scores: d.scores,
        practice: d.practice,
        accessOnly: !withRecord.has(s.no),
      };
    })
    .sort((a, b) => Number(Boolean(b.levelUp)) - Number(Boolean(a.levelUp))
      || Number(b.scores.length > 0) - Number(a.scores.length > 0)
      || Number(a.no) - Number(b.no));

  // ---- 누적 ----
  const days = countStart <= prev ? cal.daysBetween(countStart, prev) : [];
  const doneByDay = new Map([[prev, done]]);
  const known = dayCache ? await dayCache.load(client.code) : {};
  const todo = days.filter((d) => d !== prev && !doneByDay.has(d));
  const fromCache = todo.filter((d) => Array.isArray(known[d]));
  for (const d of fromCache) doneByDay.set(d, new Set(known[d]));
  const toFetch = todo.filter((d) => !Array.isArray(known[d]));
  const fresh = {};
  for (let i = 0; i < toFetch.length; i += 5) { // 5일씩 묶어서 동시에
    await Promise.all(toFetch.slice(i, i + 5).map(async (d) => {
      const [rec, acc] = await Promise.all([client.fetchDone(d), client.fetchAccessed(d)]);
      const set = new Set([...rec, ...acc]);
      doneByDay.set(d, set);
      fresh[d] = [...set];
    }));
  }
  if (!Array.isArray(known[prev]) && days.includes(prev)) fresh[prev] = [...done]; // 이전 등교일은 이미 끝난 날
  if (dayCache && Object.keys(fresh).length) await dayCache.save(client.code, { ...known, ...fresh });

  const counts = {};
  for (const s of counted) {
    const from = cleared[s.no] || '';
    counts[s.no] = days.filter((d) => d > from && !exempt(s.no, d) && !doneByDay.get(d).has(s.no)).length;
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
    missing,
    done: counted.length - missing.length,
    total: counted.length,
    graduated,
    excluded,
    accessOnly: accessOnly.length, // 기록은 없지만 접속해서 '했다'로 센 학생 수
    progress,     // 이전 등교일에 한 학생의 레벨·점수 [{no, name, levelUp:{passed,next}|null, scores:[{level,score}], practice, accessOnly}]
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
  };
}
