// 01 과제 체크: 과제마다 학생 이름 칸. 한 번 터치 = 중간(노랑), 두 번 = 통과(초록), 세 번 = 해제
// - '저장하고 새 과제': 지금 과제를 지난 기록으로 보내고 바로 새 과제를 만든다
// - '지난 기록': 저장한 과제를 날짜별로 보고, 늦게 낸 학생은 그 안에서 체크하거나 다시 열 수 있다
import { el, onTap, formBox, confirmBox, menuBox, toast } from '../ui.js';
import { sortByNo, assignmentSummary, markOf, nextMark } from '../lib/model.js';
import { label, todayKST } from '../lib/schoolday.js';
import { noRoster, chipBar } from './common.js';

function gridColumns(n) {
  if (n <= 8) return 4;
  if (n <= 15) return 5;
  if (n <= 24) return 6;
  if (n <= 32) return 8;
  return 10;
}

/** ISO 시각 → 'M/D (요일)' (한국 시간) */
function dayLabel(iso) {
  return iso ? label(todayKST(new Date(iso))) : '';
}

async function newAssignment(ctx, title = '새 과제') {
  const v = await formBox(title, [
    { name: 'title', label: '과제 이름', placeholder: '예: 수학 익힘책 34쪽' },
  ], { ok: '만들기', validate: (x) => (!x.title ? '과제 이름을 적어 주세요' : '') });
  if (!v) return;
  try {
    const id = await ctx.store.createAssignment(v.title);
    ctx.setPref('assignment', id);
    ctx.setPref('checkMode', 'board');
    ctx.rerender();
  } catch (e) {
    ctx.fail(e);
  }
}

async function saveAndNew(ctx, a, students) {
  const sum = assignmentSummary(a, students);
  try {
    await ctx.store.closeAssignment(a.id);
    toast(`'${a.title}' 저장했어요 (통과 ${sum.doneCount}/${sum.total}${sum.halfCount ? ` · 중간 ${sum.halfCount}` : ''}). 지난 기록에서 볼 수 있어요.`, 'ok', 4000);
  } catch (e) {
    ctx.fail(e);
    return;
  }
  await newAssignment(ctx, '저장했어요 · 다음 과제');
}

async function assignmentMenu(ctx, a) {
  const saved = Boolean(a.closedAt);
  const items = [['rename', '이름 바꾸기']];
  if (!saved) items.push(['close', '저장만 하기 (새 과제는 안 만듦)'], ['reset', '체크 모두 지우기']);
  else items.push(['reopen', '다시 열기 (체크 화면으로)']);
  items.push(['delete', '과제 삭제', true]);
  const choice = await menuBox(a.title, items);
  try {
    if (choice === 'rename') {
      const v = await formBox('과제 이름 바꾸기', [{ name: 'title', label: '과제 이름', value: a.title }],
        { validate: (x) => (!x.title ? '과제 이름을 적어 주세요' : '') });
      if (v) await ctx.store.renameAssignment(a.id, v.title);
    } else if (choice === 'close') {
      await ctx.store.closeAssignment(a.id);
      toast(`'${a.title}' 저장했어요. 지난 기록에서 볼 수 있어요.`, 'ok');
    } else if (choice === 'reopen') {
      await reopen(ctx, a);
    } else if (choice === 'reset') {
      if (await confirmBox('체크를 모두 지울까요?', `'${a.title}'의 중간·통과 표시가 모두 사라져요.`, { ok: '모두 지우기', danger: true })) {
        await ctx.store.resetAssignment(a.id);
      }
    } else if (choice === 'delete') {
      if (await confirmBox('과제를 삭제할까요?', `'${a.title}'와 체크 기록이 모두 사라져요. 되돌릴 수 없어요.`, { ok: '삭제', danger: true })) {
        await ctx.store.deleteAssignment(a.id);
        if (saved) ctx.setPref('record', null);
      }
    }
  } catch (e) {
    ctx.fail(e);
  }
}

async function reopen(ctx, a) {
  await ctx.store.reopenAssignment(a.id);
  ctx.setPref('assignment', a.id);
  ctx.setPref('checkMode', 'board');
  ctx.setPref('record', null);
  ctx.rerender();
}

const TILE_CLASS = ['', '.half', '.done'];
const TILE_MARK = ['', '△', '✓'];
const TILE_STATE = ['안 함', '중간', '통과'];

/** 이름 칸 + 중간·아직 안 한 학생 줄 */
function board(ctx, a, students) {
  const grid = el('div.tile-grid', { style: { '--cols': gridColumns(students.length) } },
    students.map((s) => {
      const mark = markOf(a, s.id);
      const tile = el(`button.tile${TILE_CLASS[mark]}`, {
        type: 'button',
        'aria-label': `${s.no}번 ${s.name} · ${TILE_STATE[mark]}`,
        dataset: { sid: s.id, mark: String(mark) },
      },
      el('span.tile-no', `${s.no}`),
      el('span.tile-name', s.name),
      el('span.tile-mark', { 'aria-hidden': 'true' }, TILE_MARK[mark]));
      onTap(tile, () => {
        ctx.store.setMark(a.id, s.id, nextMark(mark)).catch((e) => ctx.fail(e));
      }, { key: `check:${a.id}:${s.id}` });
      return tile;
    }));
  const sum = assignmentSummary(a, students);
  const names = (list) => list.map((s) => `${s.no}번 ${s.name}`).join(' · ');
  const lines = [];
  if (sum.half.length) lines.push(el('p.missing', el('span.half-label', '중간: '), names(sum.half)));
  if (sum.missing.length) lines.push(el('p.missing', el('span.missing-label', '아직: '), names(sum.missing)));
  if (!lines.length) lines.push(el('p.missing.all', '모두 통과했어요! 🎉'));
  return [grid, ...lines];
}

function countBadge(a, students) {
  const sum = assignmentSummary(a, students);
  return el('div.count', { class: sum.doneCount === sum.total ? 'all' : '' },
    el('strong', String(sum.doneCount)), ` / ${sum.total} 통과`,
    sum.halfCount ? el('span.count-half', ` · 중간 ${sum.halfCount}`) : null);
}

function menuButton(ctx, a) {
  return onTap(el('button.icon-btn.big', { type: 'button', title: '과제 메뉴', 'aria-label': '과제 메뉴' }, '⋯'),
    () => assignmentMenu(ctx, a));
}

function recordsButton(ctx, saved) {
  return onTap(el('button.btn.records-btn', { type: 'button' }, `📋 지난 기록${saved.length ? ` (${saved.length})` : ''}`), () => {
    ctx.setPref('checkMode', 'records');
    ctx.setPref('record', null);
    ctx.rerender();
  });
}

/** 지난 기록 목록 또는 기록 하나 */
function renderRecords(root, ctx, saved, students) {
  const back = onTap(el('button.btn', { type: 'button' }, '← 과제 체크로'), () => {
    ctx.setPref('checkMode', 'board');
    ctx.rerender();
  });

  const rec = saved.find((a) => a.id === ctx.prefs.record);
  if (rec) {
    const toList = onTap(el('button.btn', { type: 'button' }, '← 기록 목록'), () => {
      ctx.setPref('record', null);
      ctx.rerender();
    });
    const head = el('div.page-head',
      el('div.title-block',
        el('p.eyebrow', `저장한 기록 · ${dayLabel(rec.closedAt)} 저장`),
        el('h1.page-title', rec.title)),
      countBadge(rec, students),
      onTap(el('button.btn', { type: 'button' }, '다시 열기'), () => reopen(ctx, rec).catch((e) => ctx.fail(e))),
      menuButton(ctx, rec));
    root.replaceChildren(el('div.page.page-fill', el('div.chip-bar', toList), head, ...board(ctx, rec, students),
      el('p.muted.small', '늦게 낸 학생은 여기서 바로 체크해도 기록에 남아요.')));
    return;
  }

  const list = saved.length
    ? el('div.record-list', saved.map((a) => {
      const sum = assignmentSummary(a, students);
      const card = el('button.record-card', { type: 'button' },
        el('span.record-date', dayLabel(a.closedAt)),
        el('span.record-title', a.title),
        el('span.record-count', { class: sum.doneCount === sum.total ? 'all' : '' }, `${sum.doneCount} / ${sum.total}${sum.halfCount ? ` (중간 ${sum.halfCount})` : ''}`),
        el('span.record-missing', [
          sum.half.length ? `중간: ${sum.half.map((s) => s.name).join(', ')}` : '',
          sum.missing.length ? `아직: ${sum.missing.map((s) => s.name).join(', ')}` : '',
        ].filter(Boolean).join(' / ') || '모두 통과했어요'));
      onTap(card, () => {
        ctx.setPref('record', a.id);
        ctx.rerender();
      });
      return card;
    }))
    : el('div.empty', el('p.empty-big', '저장한 기록이 아직 없어요'),
      el('p', '과제 체크 화면에서 "💾 저장하고 새 과제"를 누르면 여기에 날짜별로 쌓여요.'));

  root.replaceChildren(el('div.page',
    el('div.chip-bar', back),
    el('div.page-head', el('h1.page-title', '지난 과제 기록'), el('span.muted', `${saved.length}개`)),
    list));
}

export function render(root, ctx) {
  const { state } = ctx;
  const students = sortByNo(state.room.roster);
  if (!students.length) {
    root.replaceChildren(noRoster(ctx));
    return;
  }

  const open = state.assignments.filter((a) => !a.closedAt).reverse(); // 최근 과제가 앞에
  const saved = state.assignments.filter((a) => a.closedAt)
    .sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));

  if (ctx.prefs.checkMode === 'records') {
    renderRecords(root, ctx, saved, students);
    return;
  }

  const current = open.find((a) => a.id === ctx.prefs.assignment) || open[0];
  const bar = chipBar(open, current?.id, (a) => {
    ctx.setPref('assignment', a.id);
    ctx.rerender();
  }, '+ 새 과제', () => newAssignment(ctx));
  bar.append(recordsButton(ctx, saved));

  if (!current) {
    root.replaceChildren(el('div.page', bar, el('div.empty',
      el('p.empty-big', '지금 체크할 과제가 없어요'),
      onTap(el('button.btn.primary.btn-xl', { type: 'button' }, '+ 과제 만들기'), () => newAssignment(ctx)))));
    return;
  }

  const head = el('div.page-head',
    el('h1.page-title', current.title),
    countBadge(current, students),
    onTap(el('button.btn.primary.save-btn', { type: 'button' }, '💾 저장하고 새 과제'), () => saveAndNew(ctx, current, students)),
    menuButton(ctx, current));

  root.replaceChildren(el('div.page.page-fill', bar, head, ...board(ctx, current, students)));
}
