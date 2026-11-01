// 03 수학 확인: 분수 연산 마스터에서 이전 등교일에 안 한 학생
import { el, onTap, confirmBox, toast } from '../ui.js';
import { todayKST } from '../lib/schoolday.js';
import { absentKey } from '../lib/mathpractice.js';

const AUTO_REFRESH_MS = 10 * 60 * 1000;

const m = {
  sig: '',        // 반 코드·쉬는 날·누적 설정·해제·결석이 바뀌면 다시 받아온다
  absentDate: '', // 결석 처리 화면에서 고른 날짜 (비면 이전 등교일)
  code: '',       // 마지막으로 받아온 수학 반 코드 (다른 반이면 이전 결과를 지움)
  again: false,   // 받아오는 중에 설정이 또 바뀌면 끝난 뒤 한 번 더
  report: null,
  error: null,
  loading: false,
  loadedAt: 0,
  timer: null,
};

function signature(room) {
  return [room.mathCode, room.offDaysText, room.mathExcludeText, room.mathCountStart, room.mathLimit,
    JSON.stringify(room.mathCleared || {}), JSON.stringify(room.mathAbsent || {}),
    room.roster.map((s) => `${s.no}:${s.name}`).join(',')].join('|');
}

async function load(ctx, refresh = false) {
  if (m.loading) {
    m.again = true;
    return;
  }
  m.loading = true;
  if (ctx.tab === 'math') ctx.rerender();
  try {
    m.report = await ctx.store.getMath(ctx.state.room, { refresh });
    m.error = null;
  } catch (e) {
    m.error = e;
    if (e.code === 'nocode') m.report = null;
  } finally {
    m.loading = false;
    m.loadedAt = Date.now();
    if (m.again) {
      m.again = false;
      queueMicrotask(() => load(ctx));
    } else if (ctx.tab === 'math') {
      ctx.rerender();
    }
  }
}

function schedule(ctx) {
  clearTimeout(m.timer);
  m.timer = setTimeout(() => {
    if (ctx.tab === 'math' && document.visibilityState === 'visible') load(ctx);
    schedule(ctx);
  }, AUTO_REFRESH_MS);
}

const shortDate = (key) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

async function clearPenalty(ctx, r, s) {
  const ok = await confirmBox(`${s.no}번 ${s.name} 해제`,
    `벌을 받은 것으로 처리해요.\n지금까지 누적 ${s.count}회가 지워지고, 다음 등교일부터 0회에서 다시 세요.`,
    { ok: '해제하고 0부터', danger: true });
  if (!ok) return;
  try {
    await ctx.store.clearMathCount(s.no, r.dateKey);
    toast(`${s.name} 학생의 누적을 0으로 되돌렸어요`, 'ok');
  } catch (e) {
    ctx.fail(e);
  }
}

/** 누적 기준 이상인 학생: 아래에 큰 이름으로 따로. 벌을 받으면 '해제' */
function penaltySection(ctx, r) {
  if (!r.overLimit?.length) return null;
  const popup = document.body.classList.contains('popup');
  return el('section.penalty',
    el('h2.penalty-title', `⚠ 누적 ${r.limit}회 이상`,
      el('small', ` · ${shortDate(r.countStart)}부터 ${r.dateLabel}까지 안 한 날을 센 횟수`)),
    el('div.penalty-list', r.overLimit.map((s) => el('div.penalty-card',
      el('div.penalty-who', el('span.penalty-no', `${s.no}번`), el('span.penalty-name', s.name)),
      el('span.penalty-count', `누적 ${s.count}회`),
      popup ? null : onTap(el('button.btn.penalty-clear', { type: 'button' }, '벌 받음 · 해제'), () => clearPenalty(ctx, r, s))))));
}

async function markAbsent(ctx, r, s) {
  const ok = await confirmBox(`${s.no}번 ${s.name} 결석 처리`,
    `${r.dateLabel} 결석으로 처리해요.\n그날 안 한 날로 세지 않고(차감), 명단에서도 빠져요. 아래 "결석 처리"에서 되돌릴 수 있어요.`,
    { ok: '결석 처리' });
  if (!ok) return;
  try {
    await ctx.store.setMathAbsent(s.no, r.dateKey, true);
    toast(`${s.no}번 결석 처리했어요`, 'ok');
  } catch (e) {
    ctx.fail(e);
  }
}

/** 결석 처리: 날짜를 고르고 학생을 누르면 그날 결석 (안 한 날로 세지 않음). 오늘 결석도 미리 적어 둘 수 있다 */
function absenceSection(ctx, r) {
  if (document.body.classList.contains('popup') || !r.students?.length) return null;
  const today = todayKST();
  const date = m.absentDate || r.dateKey;
  const absent = ctx.state.room.mathAbsent || {};
  const isOn = (s) => absent[absentKey(date, s.no)] === true;
  const pick = (d) => {
    m.absentDate = d;
    ctx.rerender();
  };
  const toggle = async (s) => {
    try {
      await ctx.store.setMathAbsent(s.no, date, !isOn(s));
    } catch (e) {
      ctx.fail(e);
    }
  };
  const dateBtn = (d, text) => onTap(el(d === date ? 'button.chip.active' : 'button.chip', { type: 'button' }, text), () => pick(d), { key: `absent-date:${d}` });
  const onCount = r.students.filter(isOn).length;
  return el('section.absence',
    el('h2.progress-title', '결석 처리',
      el('small', ` · ${shortDate(date)} 결석 ${onCount}명`)),
    el('p.muted.small', '결석한 날은 안 한 날로 세지 않고(차감) 그날 명단에서도 빠져요. 이름을 누르면 결석, 다시 누르면 취소예요. 오늘 결석도 미리 적어 둘 수 있어요.'),
    el('div.absence-dates',
      dateBtn(r.dateKey, `${shortDate(r.dateKey)} (이전 등교일)`),
      dateBtn(today, `${shortDate(today)} (오늘)`),
      el('input.absence-date', {
        type: 'date', value: date, 'aria-label': '결석 날짜',
        on: { change: (e) => e.target.value && pick(e.target.value) },
      })),
    el('div.absence-chips', r.students.map((s) => onTap(
      el(isOn(s) ? 'button.chip.active' : 'button.chip', { type: 'button' }, `${s.no}번 ${s.name}`),
      () => toggle(s), { key: `absent:${date}:${s.no}` }))));
}

/** 이전 등교일에 한 학생의 레벨 상승·점수 */
function progressSection(r) {
  if (!r.progress?.length) return null;
  const scoreText = (s) => {
    const parts = s.scores.map((x) => `${x.level} ${x.score}점`);
    if (s.practice.length) parts.push(`${s.practice.join('·')} 연습`);
    return parts.length ? parts.join(' · ') : (s.accessOnly ? '접속만' : '기록 없음');
  };
  return el('section.progress',
    el('h2.progress-title', `${r.dateLabel} 레벨·점수`,
      el('small', r.levelUps ? ` · 레벨 상승 ${r.levelUps}명` : ' · 레벨 상승 없음')),
    el('ul.progress-list', r.progress.map((s) => el(s.levelUp ? 'li.progress-row.up' : 'li.progress-row',
      el('span.progress-who', el('small', `${s.no}번`), s.name),
      s.levelUp
        ? el('span.progress-up', s.levelUp.next ? `⬆ ${s.levelUp.passed} 통과 → ${s.levelUp.next}` : `🏁 ${s.levelUp.passed} 통과 (마지막)`)
        : null,
      el('span.progress-score', scoreText(s))))),
    el('p.muted.small', '점수는 그날 도전에서 레벨마다 가장 높은 점수. 레벨 상승은 그날 처음 통과 점수를 넘어 다음 레벨 도전이 열린 것.'));
}

export function render(root, ctx, { changedTab } = {}) {
  const { room } = ctx.state;
  if (!room.mathCode) {
    root.replaceChildren(el('div.empty',
      el('p.empty-big', '수학 반 코드가 아직 없어요'),
      el('p', '분수 연산 마스터 교사 화면 위쪽에 있는 반 코드(6글자)를 우리 반 탭에 적어 주세요.'),
      document.body.classList.contains('popup')
        ? null
        : onTap(el('button.btn.primary.btn-xl', { type: 'button' }, '우리 반 탭으로'), () => ctx.go('class'))));
    return;
  }

  const sig = signature(room);
  const stale = Date.now() - m.loadedAt > AUTO_REFRESH_MS;
  if (sig !== m.sig || (changedTab && stale) || (!m.report && !m.error && !m.loading)) {
    if (room.mathCode !== m.code) {
      m.report = null; // 다른 반이면 이전 결과를 보여 주지 않음. 같은 반이면 새 결과가 올 때까지 이전 결과를 그대로 둠
      m.error = null;
    }
    m.code = room.mathCode;
    m.sig = sig;
    queueMicrotask(() => load(ctx));
    schedule(ctx);
  }

  const r = m.report;
  const refreshBtn = onTap(el('button.btn', { type: 'button', disabled: m.loading }, m.loading ? '확인 중…' : '새로고침'),
    () => load(ctx, true));

  if (!r) {
    const body = m.error
      ? el('div.math-error', el('p.empty-big', '수학 기록을 받아오지 못했어요'), el('p', m.error.message || ''), refreshBtn)
      : el('p.empty-big', '분수 연산 마스터에서 확인하는 중…');
    root.replaceChildren(el('div.empty', body));
    return;
  }

  const title = el('h1.page-title', `${r.dateLabel} 수학 안 한 사람`);
  const popup = document.body.classList.contains('popup');
  const chip = (s) => {
    const node = el(popup ? 'span.name-chip' : 'span.name-chip.tappable', { title: popup ? null : '누르면 결석 처리' }, el('small', `${s.no}번`), s.name);
    return popup ? node : onTap(node, () => markAbsent(ctx, r, s), { key: `missing:${r.dateKey}:${s.no}` });
  };
  const names = r.missing.length
    ? el('div.name-chips', r.missing.map(chip))
    : el('p.all-done', '모두 했어요! 🎉');

  const notes = [
    `${r.total}명 중 ${r.done}명 함${r.absent?.length ? ` (결석 ${r.absent.length}명 뺌)` : ''}`,
    r.accessOnly ? `접속만 한 ${r.accessOnly}명 포함` : '접속하거나 시작했으면 함',
    popup || !r.missing.length ? '' : '이름을 누르면 결석 처리',
    `${r.fetchedDate && r.fetchedDate !== todayKST() ? `${r.fetchedDate.slice(5).replace('-', '/')} ` : ''}${r.fetchedAt} 확인`,
  ];
  const warn = r.stale
    ? el('p.warn', `최신 기록을 못 받아서 ${r.fetchedDate?.slice(5).replace('-', '/')} ${r.fetchedAt}에 받은 내용을 보여 주고 있어요. (${r.error?.message || ''})`)
    : null;
  const offNote = r.todayOff ? el('p.muted', `오늘은 ${r.todayOff}이라 지난 등교일 ${r.dateLabel} 기준이에요.`) : null;
  const skipped = [
    r.graduated?.length ? `모든 레벨 통과(${r.finalLevel}) ${r.graduated.length}명: ${r.graduated.map((s) => s.name).join(', ')}` : '',
    r.absent?.length ? `${r.dateLabel} 결석 ${r.absent.length}명: ${r.absent.map((s) => s.name).join(', ')}` : '',
    r.excluded?.length ? `항상 제외: ${r.excluded.map((s) => s.name).join(', ')}` : '',
  ].filter(Boolean);
  const skipNote = skipped.length ? el('p.muted.math-notes', `세지 않음 — ${skipped.join(' · ')}`) : null;
  const ups = (r.progress || []).filter((s) => s.levelUp);
  const upNote = ups.length
    ? el('p.math-notes.levelup-note', `⬆ 레벨 상승 ${ups.length}명 — ${ups.map((s) => {
      const score = s.scores.find((x) => x.level === s.levelUp.passed)?.score;
      return `${s.no}번 ${s.name} ${s.levelUp.passed}→${s.levelUp.next || '완료'}${score != null ? `(${score}점)` : ''}`;
    }).join(' · ')}`)
    : null;
  const watchNote = r.watch?.length
    ? el('p.muted.math-notes', `누적 지켜보기 (${r.limit}회 미만) — ${r.watch.map((s) => `${s.no}번 ${s.name} ${s.count}회`).join(' · ')}`)
    : null;

  root.replaceChildren(el('div.page',
    el('div.page-head', title, refreshBtn),
    el('div.card.math-card', names),
    el('p.muted.math-notes', notes.filter(Boolean).join(' · ')),
    upNote, skipNote, watchNote, warn, offNote,
    penaltySection(ctx, r),
    progressSection(r),
    absenceSection(ctx, r),
    el('p.muted.small', '설날·추석·재량휴업일처럼 해마다 바뀌는 쉬는 날은 우리 반 탭의 "등교 안 하는 날"에 적어 주세요.')));
}

export function leave() {
  clearTimeout(m.timer);
}
