// Firestore 저장소
// 구조 (모두 rooms/{room} 아래)
//   rooms/{room}                    { className, mathCode, offDaysText, mathExcludeText, roster: [{id,no,name}],
//                                     mathCountStart, mathLimit, mathCleared: { 번호: 'YYYY-MM-DD'(그 날까지 해제) } }
//   rooms/{room}/assignments/{id}   { title, createdAt, closedAt?, done: { 학생id: 완료시각 } }
//                                   closedAt 이 있으면 '저장한 기록'(지난 과제)
//   rooms/{room}/draws/{id}         { title, min, max, createdAt, picks: { 번호: {sid,no,name,at} }, byStudent: { 학생id: 번호 } }
//   rooms/{room}/cache/math         { sig, savedAt, report }   — 수학 결과 공유 캐시
//   rooms/{room}/cache/mathDays     { classCode, daysJson }    — 지난 날짜별 '한 학생' (누적용)
//   rooms/{room}/cache/mathBase     { classCode, baseJson }    — 오늘 받은 반·명단·L27 통과·이전 등교일 기록
//
// fs 는 Firebase 'firestore' 모듈(브라우저: gstatic, 테스트: npm firebase)을 그대로 넘겨받는다.

import {
  AppError, cleanText, newId, normalizeRoster, chooseNumber, validateDraw, validateMathCode,
  validateCountStart, validateLimit,
} from './lib/model.js';
import {
  buildReport, MathError, MathPracticeClient, DEFAULT_EXCLUDE_TEXT, DEFAULT_COUNT_START, DEFAULT_LIMIT, parseNames,
} from './lib/mathpractice.js';
import { parseDate, parseOffDays, todayKST } from './lib/schoolday.js';

const MATH_FRESH_MS = 10 * 60 * 1000;
const MATH_REFRESH_MIN_MS = 60 * 1000;

const tsToISO = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v ?? null);

export function createStore(fs, db, room = 'main') {
  const roomRef = fs.doc(db, 'rooms', room);
  const asgCol = fs.collection(roomRef, 'assignments');
  const drawCol = fs.collection(roomRef, 'draws');
  const mathRef = fs.doc(roomRef, 'cache', 'math');
  const daysRef = fs.doc(roomRef, 'cache', 'mathDays');
  const baseRef = fs.doc(roomRef, 'cache', 'mathBase');
  const asgRef = (id) => fs.doc(asgCol, id);
  const drawRef = (id) => fs.doc(drawCol, id);

  function readRoom(data = {}) {
    return {
      className: data.className || '',
      mathCode: data.mathCode || '',
      offDaysText: data.offDaysText || '',
      // 한 번도 저장한 적이 없으면 기본 제외 명단
      mathExcludeText: typeof data.mathExcludeText === 'string' ? data.mathExcludeText : DEFAULT_EXCLUDE_TEXT,
      mathCountStart: parseDate(data.mathCountStart) || DEFAULT_COUNT_START,
      mathLimit: Number.isInteger(data.mathLimit) && data.mathLimit >= 1 ? data.mathLimit : DEFAULT_LIMIT,
      mathCleared: data.mathCleared && typeof data.mathCleared === 'object' ? { ...data.mathCleared } : {},
      roster: Array.isArray(data.roster) ? data.roster : [],
    };
  }

  function readAssignment(snap) {
    const d = snap.data({ serverTimestamps: 'estimate' });
    const done = {};
    for (const [sid, at] of Object.entries(d.done || {})) done[sid] = tsToISO(at);
    return {
      id: snap.id, title: d.title || '', createdAt: tsToISO(d.createdAt) || '', closedAt: tsToISO(d.closedAt), done,
    };
  }

  function readDraw(snap) {
    const d = snap.data({ serverTimestamps: 'estimate' });
    return {
      id: snap.id,
      title: d.title || '',
      min: d.min || 1,
      max: d.max || 1,
      createdAt: tsToISO(d.createdAt) || '',
      picks: d.picks || {},
      byStudent: d.byStudent || {},
    };
  }

  /**
   * 실시간 구독. onChange(state, status) 를 바뀔 때마다 부른다.
   * state = { room, assignments, draws }, status = { ready, fromCache, pending, error }
   */
  function subscribe(onChange) {
    const state = { room: readRoom(), assignments: [], draws: [] };
    const status = { ready: false, fromCache: true, pending: false, error: null };
    const seen = { room: false, asg: false, draw: false };
    const meta = { room: null, asg: null, draw: null };

    const emit = () => {
      const m = Object.values(meta).filter(Boolean);
      status.ready = seen.room && seen.asg && seen.draw;
      status.fromCache = m.some((x) => x.fromCache);
      status.pending = m.some((x) => x.hasPendingWrites);
      onChange(state, { ...status });
    };
    const onError = (e) => {
      status.error = e;
      onChange(state, { ...status });
    };
    const opts = { includeMetadataChanges: true };
    const sortByCreated = (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '');

    const unsubs = [
      fs.onSnapshot(roomRef, opts, (snap) => {
        state.room = readRoom(snap.exists() ? snap.data() : {});
        seen.room = true;
        meta.room = snap.metadata;
        emit();
      }, onError),
      fs.onSnapshot(asgCol, opts, (snap) => {
        state.assignments = snap.docs.map(readAssignment).sort(sortByCreated);
        seen.asg = true;
        meta.asg = snap.metadata;
        emit();
      }, onError),
      fs.onSnapshot(drawCol, opts, (snap) => {
        state.draws = snap.docs.map(readDraw).sort(sortByCreated);
        seen.draw = true;
        meta.draw = snap.metadata;
        emit();
      }, onError),
    ];
    return () => unsubs.forEach((u) => u());
  }

  // -- 명단·설정 -------------------------------------------------------------

  async function saveRoster(students) {
    const roster = normalizeRoster(students);
    await fs.setDoc(roomRef, { roster, updatedAt: fs.serverTimestamp() }, { merge: true });
    return roster;
  }

  async function saveSettings(patch) {
    const data = {};
    if ('className' in patch) data.className = cleanText(patch.className, 30);
    if ('mathCode' in patch) data.mathCode = validateMathCode(patch.mathCode);
    if ('offDaysText' in patch) data.offDaysText = String(patch.offDaysText || '').slice(0, 5000);
    if ('mathExcludeText' in patch) data.mathExcludeText = String(patch.mathExcludeText || '').slice(0, 2000);
    if ('mathCountStart' in patch) data.mathCountStart = validateCountStart(patch.mathCountStart);
    if ('mathLimit' in patch) data.mathLimit = validateLimit(patch.mathLimit);
    await fs.setDoc(roomRef, { ...data, updatedAt: fs.serverTimestamp() }, { merge: true });
  }

  // -- 과제 체크 -------------------------------------------------------------

  async function createAssignment(title) {
    const t = cleanText(title);
    if (!t) throw new AppError('invalid', '과제 이름을 적어 주세요');
    const id = newId('a');
    // 기다리지 않아도 화면에는 바로 나온다(오프라인이어도 저장 대기)
    fs.setDoc(asgRef(id), { title: t, createdAt: fs.serverTimestamp(), done: {} }).catch(reportError);
    return id;
  }

  function renameAssignment(id, title) {
    const t = cleanText(title);
    if (!t) throw new AppError('invalid', '과제 이름을 적어 주세요');
    return fs.updateDoc(asgRef(id), { title: t });
  }

  function deleteAssignment(id) {
    return fs.deleteDoc(asgRef(id));
  }

  /** 원하는 상태(done)를 그대로 저장. 같은 요청이 두 번 와도 결과가 같고, 다른 학생 칸과 겹치지 않는다. */
  function setDone(id, studentId, done) {
    return fs.updateDoc(asgRef(id), new fs.FieldPath('done', studentId), done ? fs.serverTimestamp() : fs.deleteField());
  }

  function resetAssignment(id) {
    return fs.updateDoc(asgRef(id), { done: {} });
  }

  /** 과제를 '저장'(마감)해서 지난 기록으로 보낸다. 체크는 그대로 남고 나중에 고칠 수도 있다. */
  function closeAssignment(id) {
    return fs.updateDoc(asgRef(id), { closedAt: fs.serverTimestamp() });
  }

  function reopenAssignment(id) {
    return fs.updateDoc(asgRef(id), { closedAt: fs.deleteField() });
  }

  // -- 번호 뽑기 -------------------------------------------------------------

  async function createDraw(input) {
    const d = validateDraw(input);
    const id = newId('d');
    fs.setDoc(drawRef(id), { ...d, createdAt: fs.serverTimestamp(), picks: {}, byStudent: {} }).catch(reportError);
    return id;
  }

  function renameDraw(id, title) {
    const t = cleanText(title);
    if (!t) throw new AppError('invalid', '뽑기 이름을 적어 주세요');
    return fs.updateDoc(drawRef(id), { title: t });
  }

  function deleteDraw(id) {
    return fs.deleteDoc(drawRef(id));
  }

  function resetDraw(id) {
    return fs.updateDoc(drawRef(id), { picks: {}, byStudent: {} });
  }

  /** 학생이 번호를 뽑는다. 트랜잭션이라 두 기기에서 동시에 뽑아도 번호가 겹치지 않는다. */
  async function pick(id, student, rand = Math.random) {
    try {
      return await fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(drawRef(id));
        if (!snap.exists()) throw new AppError('notfound', '뽑기를 찾을 수 없어요 (다른 기기에서 지웠을 수 있어요)');
        const d = snap.data();
        const mine = d.byStudent?.[student.id];
        if (mine != null) throw new AppError('already', `${student.name} 학생은 이미 ${mine}번을 뽑았어요`, { number: mine });
        const taken = new Set(Object.keys(d.picks || {}).map(Number));
        const number = chooseNumber(d.min, d.max, taken, rand);
        if (number == null) throw new AppError('full', '남은 번호가 없어요');
        tx.update(drawRef(id),
          new fs.FieldPath('picks', String(number)), { sid: student.id, no: student.no, name: student.name, at: new Date().toISOString() },
          new fs.FieldPath('byStudent', student.id), number);
        return number;
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e?.code === 'unavailable' || e?.code === 'failed-precondition') {
        throw new AppError('offline', '번호 뽑기는 인터넷이 연결되어 있어야 해요');
      }
      throw e;
    }
  }

  async function cancelPick(id, number) {
    return fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(drawRef(id));
      const rec = snap.data()?.picks?.[String(number)];
      if (!rec) return;
      tx.update(drawRef(id),
        new fs.FieldPath('picks', String(number)), fs.deleteField(),
        new fs.FieldPath('byStudent', rec.sid), fs.deleteField());
    });
  }

  // -- 수학 확인 -------------------------------------------------------------

  /**
   * 이전 등교일에 수학 안 한 학생. 10분 동안은 rooms/{room}/cache/math 를 같이 써서
   * 칠판·PC·폰이 각자 분수 연산 마스터를 부르지 않게 한다 (그쪽 무료 한도 절약).
   */
  /**
   * 누적 '해제': dateKey(그 화면의 이전 등교일)까지의 횟수를 지우고, 다음 등교일부터 0에서 다시 센다.
   * 학생마다 따로 저장해서 여러 학생을 동시에 해제해도 서로 안 덮어쓴다.
   */
  function clearMathCount(no, dateKey) {
    return fs.setDoc(roomRef, { mathCleared: { [String(no)]: dateKey }, updatedAt: fs.serverTimestamp() }, { merge: true });
  }

  /** 지난 날짜별 '그날 한 학생 번호'를 한 문서에 모아 둔다 (그날은 끝났으니 다시 안 바뀜) */
  const dayCache = {
    async load(code) {
      try {
        const snap = await fs.getDoc(daysRef);
        const d = snap.exists() ? snap.data() : null;
        return d && d.classCode === code ? JSON.parse(d.daysJson || '{}') : {};
      } catch {
        return {};
      }
    },
    async save(code, all) {
      try {
        await fs.setDoc(daysRef, { classCode: code, daysJson: JSON.stringify(all), savedAt: Date.now() });
      } catch {
        // 저장 못 해도 다음에 다시 계산하면 돼서 계속 진행
      }
    },
  };

  /** 오늘 분수 연산 마스터에서 받은 기본 자료. 하루 안에는 다시 안 받는다 (새로고침 버튼만 예외) */
  const baseCache = {
    async load(code) {
      try {
        const snap = await fs.getDoc(baseRef);
        const d = snap.exists() ? snap.data() : null;
        return d && d.classCode === code ? JSON.parse(d.baseJson || 'null') : null;
      } catch {
        return null;
      }
    },
    async save(code, base) {
      try {
        await fs.setDoc(baseRef, { classCode: code, baseJson: JSON.stringify(base), savedAt: Date.now() });
      } catch {
        // 저장 못 해도 다음에 다시 받으면 돼서 계속 진행
      }
    },
  };

  async function getMath(room, { refresh = false, fetchImpl, base, at = new Date() } = {}) {
    if (!room.mathCode) throw new AppError('nocode', '우리 반 탭에서 수학 반 코드를 먼저 적어 주세요');
    const sig = [room.mathCode, room.offDaysText, room.mathExcludeText, room.mathCountStart, room.mathLimit,
      JSON.stringify(room.mathCleared || {}), todayKST(at)].join('|');

    let cached = null;
    try {
      const snap = await fs.getDoc(mathRef);
      cached = snap.exists() ? snap.data() : null;
    } catch {
      cached = null;
    }
    const age = cached ? at.getTime() - cached.savedAt : Infinity;
    if (cached?.sig === sig && age < (refresh ? MATH_REFRESH_MIN_MS : MATH_FRESH_MS)) {
      return { ...cached.report, cached: true };
    }

    try {
      const report = await buildReport({
        classCode: room.mathCode,
        offDays: parseOffDays(room.offDaysText),
        roster: room.roster,
        excludeNames: parseNames(room.mathExcludeText),
        countStart: room.mathCountStart,
        limit: room.mathLimit,
        cleared: room.mathCleared || {},
        dayCache,
        baseCache,
        refresh,
        now: at,
        fetchImpl,
        base,
      });
      fs.setDoc(mathRef, { sig, savedAt: at.getTime(), report }).catch(() => {});
      return { ...report, cached: false };
    } catch (e) {
      if (!(e instanceof MathError)) throw e;
      if (cached?.report?.classCode === room.mathCode) {
        return { ...cached.report, stale: true, error: { code: e.code, message: e.message } };
      }
      throw new AppError(e.code, e.message);
    }
  }

  async function mathStudents(code, { fetchImpl, base } = {}) {
    const c = validateMathCode(code);
    if (!c) throw new AppError('invalid', '반 코드를 적어 주세요');
    const client = new MathPracticeClient(c, { fetchImpl, base });
    try {
      const [cls, students] = await Promise.all([client.fetchClass(), client.fetchStudents()]);
      return { classCode: c, className: cls.name, students };
    } catch (e) {
      if (e instanceof MathError) throw new AppError(e.code, e.message);
      throw e;
    }
  }

  // -- 백업 ------------------------------------------------------------------

  function exportAll(state) {
    return {
      app: 'classroom',
      version: 2,
      exportedAt: new Date().toISOString(),
      room: state.room,
      assignments: state.assignments,
      draws: state.draws,
    };
  }

  async function importAll(data, current) {
    if (!data || data.app !== 'classroom' || !data.room) {
      throw new AppError('invalid', '이 사이트에서 내보낸 백업 파일이 아니에요');
    }
    const r = data.room;
    const roster = normalizeRoster(r.roster || []);
    const batch = fs.writeBatch(db);
    for (const a of current.assignments) batch.delete(asgRef(a.id));
    for (const d of current.draws) batch.delete(drawRef(d.id));
    batch.set(roomRef, {
      className: cleanText(r.className, 30),
      mathCode: validateMathCode(r.mathCode),
      offDaysText: String(r.offDaysText || ''),
      mathExcludeText: typeof r.mathExcludeText === 'string' ? r.mathExcludeText : DEFAULT_EXCLUDE_TEXT,
      mathCountStart: parseDate(r.mathCountStart) || DEFAULT_COUNT_START,
      mathLimit: Number.isInteger(r.mathLimit) && r.mathLimit >= 1 ? r.mathLimit : DEFAULT_LIMIT,
      mathCleared: r.mathCleared && typeof r.mathCleared === 'object' ? r.mathCleared : {},
      roster,
      updatedAt: fs.serverTimestamp(),
    });
    for (const a of data.assignments || []) {
      if (!a?.id || !a.title) continue;
      const asg = { title: cleanText(a.title), createdAt: a.createdAt || new Date().toISOString(), done: a.done || {} };
      if (a.closedAt) asg.closedAt = a.closedAt;
      batch.set(asgRef(a.id), asg);
    }
    for (const d of data.draws || []) {
      if (!d?.id || !d.title) continue;
      const picks = d.picks || {};
      const byStudent = {};
      for (const [num, p] of Object.entries(picks)) if (p?.sid) byStudent[p.sid] = Number(num);
      batch.set(drawRef(d.id), {
        title: cleanText(d.title), min: Number(d.min) || 1, max: Number(d.max) || 1,
        createdAt: d.createdAt || new Date().toISOString(), picks, byStudent,
      });
    }
    await batch.commit();
  }

  let reportError = (e) => console.error(e);

  return {
    subscribe,
    saveRoster,
    saveSettings,
    createAssignment,
    renameAssignment,
    deleteAssignment,
    setDone,
    resetAssignment,
    closeAssignment,
    reopenAssignment,
    createDraw,
    renameDraw,
    deleteDraw,
    resetDraw,
    pick,
    cancelPick,
    getMath,
    clearMathCount,
    mathStudents,
    exportAll,
    importAll,
    onError(fn) {
      reportError = fn;
    },
  };
}
