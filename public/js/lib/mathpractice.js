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
export const STRICT_FROM = '2026-11-02';
export const LEVEL_FROM = '2026-11-03';
// 기준이 바뀌면 이 값도 바뀐다. 결과 캐시와, 새 기준 날짜의 지난 저장본(dayCache)을 버리고 다시 센다.
export const DONE_RULE = `record-from-${STRICT_FROM}-level-from-${LEVEL_FROM}`;

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

  /** 반 전체 도전 기록 [{no, dateKey, level, mode, score, totalQuestions}] — 통과 기록을 처음 만들 때 한 번만 */
  async fetchChallengeHistory() {
    const docs = await this.queryAll({ fieldFilter: { field: { fieldPath: 'mode' }, op: 'EQUAL', value: { stringValue: 'challenge' } } });
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

/**
 * 통과 기록 {번호: {레벨: 처음 통과한 날}} 을 받아 온다.
 * passCache({load(code)→{through, passes}|null, save(code, {through, passes})}) 가 있으면
 * 저장해 둔 것에 through 다음 날부터의 기록만 더한다 (처음 한 번만 반 전체 도전 기록을 읽음).
 */
async function loadPasses(client, passCache, today) {
  const saved = passCache ? await passCache.load(client.code).catch(() => null) : null;
  let passes;
  if (saved && typeof saved.through === 'string' && saved.passes && typeof saved.passes === 'object') {
    passes = addPasses(saved.passes, await client.fetchResultsSince(saved.through));
  } else {
    passes = addPasses({}, await client.fetchChallengeHistory());
  }
  // 오늘은 아직 안 끝났으니 어제까지 읽은 것으로 적어 둔다 (다음에 오늘 것부터 다시 읽음)
  if (passCache) await passCache.save(client.code, { through: addDays(today, -1), passes }).catch(() => {});
  return passes;
}

const isStrict = (day) => day >= STRICT_FROM;
const isLevelRule = (day) => day >= LEVEL_FROM;

/**
 * day 하루의 기록·접속으로 '했다'인 학생과, 안 한 까닭.
 *   rows: 그날 기록, accessed: 그날 접속한 번호 Set, passes: 통과 기록
 *   → { done: Set, lower: Map 번호 → {did, need} } (lower: 자기 최고 레벨보다 낮은 레벨만 풂)
 */
export function judgeDay(day, rows, accessed, passes) {
  const withRecord = new Set(rows.map((r) => r.no));
  if (!isStrict(day)) return { done: new Set([...withRecord, ...accessed]), lower: new Map() };
  if (!isLevelRule(day)) return { done: withRecord, lower: new Map() };
  const top = new Map(); // 번호 → 그날 푼 가장 높은 레벨 순서
  for (const r of rows) top.set(r.no, Math.max(top.get(r.no) ?? -1, levelIndex(r.level)));
  const done = new Set();
  const lower = new Map();
  for (const [no, i] of top) {
    const need = requiredLevel(passes[no], day);
    if (!need || i >= LEVEL_ORDER.indexOf(need)) done.add(no);
    else lower.set(no, { did: LEVEL_ORDER[i], need });
  }
  return { done, lower };
}

/**
 * 이전 등교일에 수학을 하지 않은 학생 목록.
 * - roster 가 있으면 번호가 같은 학생의 이름은 우리 반 명단 이름을 쓴다.
 * - excludeNames 에 있는 이름은 세지 않는다.
 * - 마지막 레벨(FINAL_LEVEL)을 통과한 학생은 모든 레벨을 끝낸 것이라 자동으로 세지 않는다 (누적도 안 셈).
 * - absent({'날짜_번호': true}) 에 있는 학생은 그날 결석이라 그날 명단·누적에서 뺀다 (차감).
 * - '했다' 기준은 날짜마다 다르다 (STRICT_FROM·LEVEL_FROM 위 설명, judgeDay).
 *   안 한 학생에는 까닭을 붙인다: accessOnly(접속만), lower({did, need}: 낮은 레벨만 풂)
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
    if (saved?.date !== today || !Array.isArray(saved.prevRows) || !saved.passes || typeof saved.passes !== 'object') saved = null;
  }
  let cls, students, passes;
  if (saved) {
    ({ cls, students, passes } = saved);
  } else {
    [cls, students, passes] = await Promise.all([
      client.fetchClass(), client.fetchStudents(), loadPasses(client, passCache, today),
    ]);
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
      date: today, cls, students, passes, prev, prevRows, accessed: [...accessed],
    }).catch(() => {});
  }
  const withRecord = new Set(prevRows.map((r) => r.no));
  const { done, lower } = judgeDay(prev, prevRows, accessed, passes);

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
    else if (passes[s.no]?.[FINAL_LEVEL]) graduated.push(entry);
    else counted.push(entry);
  }
  // 이전 등교일에 결석으로 적어 둔 학생은 그날 명단에서 뺀다 (했어도 결석으로 적었으면 뺌)
  const absentPrev = counted.filter((s) => isAbsent(s.no, prev));
  const present = counted.filter((s) => !isAbsent(s.no, prev));
  const missing = present.filter((s) => !done.has(s.no)).map((s) => ({
    ...s,
    accessOnly: !withRecord.has(s.no) && accessed.has(s.no), // 접속만 하고 안 풂
    lower: lower.get(s.no) || null,                           // 자기 최고 레벨보다 낮은 레벨만 풂 {did, need}
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
      };
    })
    .sort((a, b) => Number(Boolean(b.levelUp)) - Number(Boolean(a.levelUp))
      || Number(b.scores.length > 0) - Number(a.scores.length > 0)
      || Number(a.no) - Number(b.no));

  // ---- 누적 ----
  const days = countStart <= prev ? cal.daysBetween(countStart, prev) : [];
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
      const set = judgeDay(d, rows, acc, passes).done;
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
    missing,      // 안 한 학생 [{no, name, accessOnly, lower:{did,need}|null}]
    done: present.length - missing.length,
    total: present.length,
    graduated,   // 마지막 레벨 통과로 자동 제외 [{no, name}]
    excluded,
    absent: absentPrev,   // 이전 등교일 결석으로 뺀 학생 [{no, name}]
    students: counted,    // 세는 학생 전체 (결석 처리 화면용) [{no, name}]
    accessOnly: accessOnly.length, // 접속만 하고 풀지 않아 '안 함'으로 센 학생 수
    lowerLevel: missing.filter((s) => s.lower).length, // 자기 최고 레벨보다 낮은 레벨만 풀어 '안 함'으로 센 학생 수
    levelRule: isLevelRule(prev), // 이전 등교일에 '자기 최고 레벨' 기준을 쓰는지
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
  };
}
