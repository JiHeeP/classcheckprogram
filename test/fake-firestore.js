// 테스트·로컬 개발용 가짜 분수 연산 마스터(Firestore REST).
// fakeFirestoreFetch(db) 는 fetch 처럼 동작한다.

const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const doc = (name, f) => ({ name, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, enc(v)])) });

export const SAMPLE_NAMES = [
  '김민준', '이서연', '박도윤', '최하은', '정시우', '강지유', '조하준', '윤서아', '장은우',
  '임지아', '한유준', '오수아', '서이준', '신하린', '권도현', '황지안', '안시윤', '송예준',
];

/**
 * db = { CODE: { name, offDays: [], students: [{no, name}], results: [{dateKey, studentNo, mode}] } }
 * opts.status 를 주면 그 HTTP 상태로 실패한다 (예: 429). opts.pageSize 로 페이지 나눔 확인.
 */
export function fakeFirestoreFetch(db, opts = {}) {
  const calls = [];
  const fn = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: url.toString(), method });
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    if (opts.status) return reply({ error: { code: opts.status } }, opts.status);

    const m = url.pathname.match(/\/documents\/classes\/([^/:]+)(\/students|:runQuery)?$/);
    if (!m) return reply({ error: 'bad path' }, 400);
    const code = decodeURIComponent(m[1]);
    const cls = db[code];
    if (!cls) return reply({ error: { code: 404 } }, 404);

    if (!m[2]) return reply(doc(`classes/${code}`, { name: cls.name, offDays: cls.offDays || [], archived: false }));

    if (m[2] === '/students') {
      const size = opts.pageSize || Number(url.searchParams.get('pageSize')) || 300;
      const start = Number(url.searchParams.get('pageToken') || 0);
      const page = cls.students.slice(start, start + size);
      const body = { documents: page.map((s) => doc(`classes/${code}/students/${s.no}`, { number: Number(s.no), name: s.name })) };
      if (start + size < cls.students.length) body.nextPageToken = String(start + size);
      return reply(body);
    }

    // 같음(EQUAL)·이상(GREATER_THAN_OR_EQUAL)·미만(LESS_THAN) 조건, 하나 또는 AND 로 묶인 여러 개
    const sq = JSON.parse(init.body).structuredQuery;
    const collection = sq.from[0].collectionId; // results | logs
    const q = sq.where;
    const filters = (q.compositeFilter ? q.compositeFilter.filters : [q]).map((f) => f.fieldFilter);
    const val = (v) => ('stringValue' in v ? v.stringValue : Number(v.integerValue));
    const test = (row, f) => {
      const a = row[f.field.fieldPath];
      const b = val(f.value);
      if (f.op === 'EQUAL') return String(a) === String(b);
      if (f.op === 'GREATER_THAN_OR_EQUAL') return a >= b;
      if (f.op === 'LESS_THAN') return a < b;
      throw new Error(`가짜 Firestore 가 모르는 조건: ${f.op}`);
    };
    const source = collection === 'logs'
      ? (cls.logs || []).map((r) => ({ studentNo: String(r.studentNo), ts: r.ts }))
      : cls.results.map((r) => ({ level: 'L1', mode: 'practice', score: null, ...r }));
    const rows = source
      .filter((r) => filters.every((f) => test(r, f)))
      .map((r, i) => ({
        document: collection === 'logs'
          ? doc(`classes/${code}/logs/l${i}`, { studentNo: r.studentNo, ts: r.ts })
          : doc(`classes/${code}/results/r${i}`, {
            dateKey: r.dateKey, studentNo: String(r.studentNo), mode: r.mode, level: r.level, score: r.score,
            ...(r.totalQuestions != null ? { totalQuestions: r.totalQuestions } : {}),
          }),
      }));
    return reply(rows.length ? rows : [{ readTime: new Date().toISOString() }]);
  };
  fn.calls = calls;
  return fn;
}

/** 5일치 반: 2026-10-08 부터 등교일 (10/9 한글날 제외) */
export const WEEK_DAYS = ['2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];

/**
 * WEEK_DAYS 동안 모든 학생이 매일 기록을 남기되, misses[번호] 에 적힌 날은 기록이 없다.
 * 4번은 기록 없이 접속만 하고, 12번은 마지막 단계(L27)를 통과했다.
 */
export function weekDb(misses = {}) {
  const students = [...SAMPLE_NAMES.map((name, i) => ({ no: String(i + 1), name })), { no: '99', name: '테스트' }];
  const results = [];
  const logs = [];
  for (const day of WEEK_DAYS) {
    for (const st of students) {
      if ((misses[st.no] || []).includes(day)) continue;
      if (st.no === '4') logs.push({ studentNo: '4', ts: kstMillis(day, 9, 30) });
      else results.push({ dateKey: day, studentNo: st.no, mode: 'free', level: 'L3', score: null });
    }
  }
  results.push({ dateKey: '2026-09-01', studentNo: '12', mode: 'challenge', level: 'L27', score: 220 });
  return { TEST01: { name: '5학년 4반', offDays: [], students, results, logs } };
}

/** 한국 시간 dateKey 의 hh 시(밀리초). 접속 기록(logs)의 ts 형식 */
export function kstMillis(dateKey, hour = 10, minute = 0) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour, minute) - 9 * 3600 * 1000;
}

/**
 * 로컬 개발용 샘플 반: 반 코드 TEST01 (18명 + '테스트' 99번)
 * - 이전 등교일 기록에서 3번·7번·12번·99번이 빠짐 (4번은 기록 없이 접속만 함 → 했다로 셈)
 * - 12번은 예전에 마지막 단계(L27) 통과(218점) → 미실시에서 빠져야 함
 * - 3번은 L27 을 했지만 통과 점수(216) 미달(200점) → 미실시에 남아야 함
 * - 7번은 이전 등교일이 아닌 다른 날에만 접속 → 미실시에 남아야 함
 */
export function sampleDb(prevDateKey) {
  const students = [...SAMPLE_NAMES.map((name, i) => ({ no: String(i + 1), name })), { no: '99', name: '테스트' }];
  const results = students
    .filter((s) => !['3', '4', '7', '12', '99'].includes(s.no))
    .map((s) => ({ dateKey: prevDateKey, studentNo: s.no, mode: s.no === '5' ? 'free' : 'challenge', level: 'L3', score: 100 }));
  results.push(
    { dateKey: '2026-09-01', studentNo: '12', mode: 'challenge', level: 'L27', score: 218 },
    { dateKey: '2026-09-01', studentNo: '3', mode: 'challenge', level: 'L27', score: 200 },
    { dateKey: '2026-09-01', studentNo: '7', mode: 'free', level: 'L27', score: null },
  );
  const logs = [
    { studentNo: '4', ts: kstMillis(prevDateKey, 10, 5) },     // 이전 등교일에 접속만
    { studentNo: '7', ts: kstMillis('2026-09-01', 9, 0) },     // 다른 날 접속
  ];
  return { TEST01: { name: '5학년 4반', offDays: [], students, results, logs } };
}
