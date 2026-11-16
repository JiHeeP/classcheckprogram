// 화면·저장소가 같이 쓰는 순수 함수들 (Firebase 와 무관, Node 테스트 가능)

import { parseDate } from './schoolday.js';

export class AppError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

export function cleanText(s, max = 40) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function newId(prefix, rand = Math.random) {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(rand() * 16).toString(16);
  return `${prefix}_${s}`;
}

function noKey(no) {
  const n = Number(no);
  return Number.isNaN(n) ? 1e9 : n;
}

export function sortByNo(list) {
  return [...list].sort((a, b) => noKey(a.no) - noKey(b.no) || String(a.no).localeCompare(String(b.no)));
}

/** 명단 검사·정리. 번호 중복·빈 이름은 오류. id 가 없으면 새로 만든다. */
export function normalizeRoster(input) {
  if (!Array.isArray(input)) throw new AppError('invalid', '명단 형식이 올바르지 않아요');
  const rows = input
    .map((s) => ({ id: cleanText(s?.id, 20), no: cleanText(s?.no, 6), name: cleanText(s?.name, 20) }))
    .filter((s) => s.no || s.name);
  if (rows.length > 60) throw new AppError('invalid', '학생은 60명까지 넣을 수 있어요');
  const seenNo = new Set();
  const seenId = new Set();
  for (const s of rows) {
    if (!s.name) throw new AppError('invalid', `${s.no}번 학생의 이름이 비어 있어요`);
    if (!s.no) throw new AppError('invalid', `${s.name} 학생의 번호가 비어 있어요`);
    if (seenNo.has(s.no)) throw new AppError('invalid', `${s.no}번이 두 번 있어요`);
    seenNo.add(s.no);
    if (!/^s_[0-9a-f]{8}$/.test(s.id) || seenId.has(s.id)) s.id = newId('s');
    seenId.add(s.id);
  }
  return sortByNo(rows);
}

/** '1 김민준', '1\t김민준', '1. 김민준', '김민준' 줄들 → [{no, name}] */
export function parseRosterText(text) {
  const out = [];
  let auto = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{1,3})\s*(?:번|\.|,|\t|\s)\s*(.+)$/);
    if (m) {
      auto = Number(m[1]);
      out.push({ no: m[1], name: cleanText(m[2].replace(/^[,\t.]+/, ''), 20) });
    } else {
      auto += 1;
      out.push({ no: String(auto), name: cleanText(line, 20) });
    }
  }
  return out;
}

/** 가져온 명단(번호·이름)을 지금 명단에 합친다. 같은 번호면 id 를 유지해서 기록이 이어진다. */
export function mergeRoster(current, incoming) {
  const byNo = new Map(current.map((s) => [String(s.no), s]));
  return sortByNo(incoming.map((s) => ({ id: byNo.get(String(s.no))?.id || '', no: String(s.no), name: s.name })));
}

/** 뽑기: 남은 번호 중 하나. 없으면 null */
export function chooseNumber(min, max, taken, rand = Math.random) {
  const free = [];
  for (let n = min; n <= max; n++) if (!taken.has(n)) free.push(n);
  if (!free.length) return null;
  return free[Math.floor(rand() * free.length)];
}

export function validateDraw({ title, min, max }) {
  const t = cleanText(title);
  if (!t) throw new AppError('invalid', '뽑기 이름을 적어 주세요');
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo || hi > 999) {
    throw new AppError('invalid', '번호 범위를 확인해 주세요 (1 ~ 999)');
  }
  return { title: t, min: lo, max: hi };
}

export function validateMathCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c && !/^[A-Z0-9]{4,12}$/.test(c)) throw new AppError('invalid', '수학 반 코드는 영문·숫자로 적어 주세요 (보통 6글자)');
  return c;
}

/** 누적 세기 시작일: 읽을 수 있는 날짜만. 'YYYY-MM-DD' 로 돌려준다 */
export function validateCountStart(text) {
  const d = parseDate(text);
  if (!d) throw new AppError('invalid', '누적 세기 시작일을 날짜로 적어 주세요 (예: 2026-10-08)');
  return d;
}

/** 벌 기준 횟수: 1~30 사이 정수 */
export function validateLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 30) throw new AppError('invalid', '벌 기준 횟수는 1~30 사이 숫자로 적어 주세요');
  return n;
}

/** 과제 체크 단계: 0 = 안 함, 1 = 중간(노랑), 2 = 통과(초록) */
export const MARK = { NONE: 0, HALF: 1, DONE: 2 };

export function markOf(assignment, studentId) {
  if (assignment?.done?.[studentId]) return MARK.DONE;
  if (assignment?.half?.[studentId]) return MARK.HALF;
  return MARK.NONE;
}

/** 터치할 때마다 안 함 → 중간 → 통과 → 안 함 */
export function nextMark(mark) {
  return (mark + 1) % 3;
}

/** 과제 체크 요약: 통과 수, 중간인 학생, 아직 안 한 학생 */
export function assignmentSummary(assignment, students) {
  const half = [];
  const missing = [];
  let doneCount = 0;
  for (const s of students) {
    const m = markOf(assignment, s.id);
    if (m === MARK.DONE) doneCount += 1;
    else if (m === MARK.HALF) half.push(s);
    else missing.push(s);
  }
  return { doneCount, halfCount: half.length, total: students.length, half, missing };
}
