// 04 우리 반: 학생 명단, 수학 연동 설정, 백업
import { el, onTap, confirmBox, toast } from '../ui.js';
import { sortByNo, parseRosterText, mergeRoster, AppError } from '../lib/model.js';
import { parseOffDays } from '../lib/schoolday.js';

// 고치는 중인 내용 (다른 기기에서 바뀌어도 덮어쓰지 않도록)
const draft = { rows: null, dirty: false, settings: null, settingsDirty: false };

function rowsFromState(ctx) {
  return sortByNo(ctx.state.room.roster).map((s) => ({ ...s }));
}

function markDirty() {
  draft.dirty = true;
  document.querySelector('[data-role=roster-save]')?.classList.add('attention');
}

export function shouldSkipRender() {
  // 입력하는 중에 다른 기기 변경으로 화면이 다시 그려지면 글자가 날아가므로 건너뛴다
  const a = document.activeElement;
  return draft.dirty || draft.settingsDirty
    || (a?.matches?.('input, textarea, select') && a.closest('.class-page') != null);
}

function rosterSection(ctx) {
  if (!draft.dirty) draft.rows = rowsFromState(ctx);
  const rows = draft.rows;

  const tbody = el('tbody');
  const redraw = () => {
    tbody.replaceChildren(...rows.map((r, i) => el('tr',
      el('td', el('input.input.no-input', {
        value: r.no, inputmode: 'numeric', 'aria-label': `${i + 1}째 줄 번호`,
        on: { input: (e) => { r.no = e.target.value; markDirty(); } },
      })),
      el('td', el('input.input', {
        value: r.name, 'aria-label': `${i + 1}째 줄 이름`,
        on: { input: (e) => { r.name = e.target.value; markDirty(); } },
      })),
      el('td', el('button.icon-btn', {
        type: 'button', title: '이 줄 지우기', 'aria-label': `${r.name || '빈 줄'} 지우기`,
        on: { click: () => { rows.splice(i, 1); markDirty(); redraw(); } },
      }, '✕')))));
  };
  redraw();

  const addRow = () => {
    const last = rows.reduce((mx, r) => Math.max(mx, Number(r.no) || 0), 0);
    rows.push({ id: '', no: String(last + 1), name: '' });
    markDirty();
    redraw();
    tbody.querySelector('tr:last-child input:not(.no-input)')?.focus();
  };

  const save = async () => {
    try {
      const saved = await ctx.store.saveRoster(rows);
      draft.dirty = false;
      draft.rows = saved;
      toast(`명단을 저장했어요 (${saved.length}명)`, 'ok');
      ctx.rerender();
    } catch (e) {
      ctx.fail(e);
    }
  };

  const cancel = () => {
    draft.dirty = false;
    ctx.rerender();
  };

  // 붙여넣기
  const paste = el('textarea.input.paste', {
    rows: 5, placeholder: '엑셀이나 메모장에서 복사해 붙여넣기\n1 김민준\n2 이서연\n3 박도윤',
  });
  const applyPaste = async () => {
    const incoming = parseRosterText(paste.value);
    if (!incoming.length) {
      toast('붙여넣은 내용이 없어요', 'warn');
      return;
    }
    if (!await confirmBox(`${incoming.length}명으로 바꿀까요?`, '같은 번호의 학생은 기록이 그대로 이어져요. 아래 "명단 저장"을 눌러야 저장돼요.', { ok: '바꾸기' })) return;
    draft.rows = mergeRoster(rows, incoming);
    markDirty();
    ctx.rerender();
  };

  // 분수 연산 마스터에서 가져오기
  const codeInput = el('input.input.code-input', {
    value: ctx.state.room.mathCode, placeholder: '반 코드', autocapitalize: 'characters', 'aria-label': '분수 연산 마스터 반 코드',
  });
  const importMath = async () => {
    try {
      const res = await ctx.store.mathStudents(codeInput.value);
      if (!res.students.length) {
        toast('그 반에 학생이 없어요', 'warn');
        return;
      }
      const preview = res.students.slice(0, 40).map((s) => `${s.no} ${s.name}`).join(', ');
      if (!await confirmBox(`${res.className || res.classCode} · ${res.students.length}명을 가져올까요?`,
        `${preview}\n\n같은 번호의 학생은 기록이 그대로 이어져요. 아래 "명단 저장"을 눌러야 저장돼요.`, { ok: '가져오기' })) return;
      draft.rows = mergeRoster(rows, res.students);
      markDirty();
      ctx.rerender();
    } catch (e) {
      ctx.fail(e);
    }
  };

  return el('section.card',
    el('div.section-head',
      el('h2', `학생 명단 (${ctx.state.room.roster.length}명)`),
      draft.dirty ? el('span.badge.warn', '저장 안 됨') : null),
    el('table.roster',
      el('thead', el('tr', el('th', '번호'), el('th', '이름'), el('th', el('span.sr-only', '지우기')))),
      tbody),
    el('div.row-actions',
      el('button.btn', { type: 'button', on: { click: addRow } }, '+ 한 줄 추가'),
      draft.dirty ? el('button.btn', { type: 'button', on: { click: cancel } }, '고친 것 취소') : null,
      el('button.btn.primary', { type: 'button', dataset: { role: 'roster-save' }, class: draft.dirty ? 'attention' : '', on: { click: save } }, '명단 저장')),
    el('details.sub',
      el('summary', '여러 명 한꺼번에 붙여넣기'),
      paste,
      el('button.btn', { type: 'button', on: { click: applyPaste } }, '붙여넣은 명단 적용')),
    el('details.sub',
      el('summary', '분수 연산 마스터에서 명단 가져오기'),
      el('div.inline', codeInput, el('button.btn', { type: 'button', on: { click: importMath } }, '가져오기'))));
}

function settingsSection(ctx) {
  const room = ctx.state.room;
  if (!draft.settingsDirty) draft.settings = { ...room };
  const s = draft.settings;
  const touch = () => { draft.settingsDirty = true; };

  const offDays = parseOffDays(s.offDaysText);
  const save = async () => {
    try {
      await ctx.store.saveSettings({
        className: s.className, mathCode: s.mathCode, offDaysText: s.offDaysText,
        mathExcludeText: s.mathExcludeText,
        mathCountStart: s.mathCountStart, mathLimit: s.mathLimit,
      });
      draft.settingsDirty = false;
      toast('설정을 저장했어요', 'ok');
      ctx.rerender();
    } catch (e) {
      ctx.fail(e);
    }
  };

  return el('section.card',
    el('h2', '설정'),
    el('label.field', el('span.field-label', '반 이름 (맨 위에 보여요)'),
      el('input.input', { value: s.className, placeholder: '예: 5학년 4반', on: { input: (e) => { s.className = e.target.value; touch(); } } })),
    el('label.field', el('span.field-label', '분수 연산 마스터 반 코드'),
      el('input.input.code-input', {
        value: s.mathCode, placeholder: '예: ABC123', autocapitalize: 'characters',
        on: { input: (e) => { s.mathCode = e.target.value.toUpperCase(); touch(); } },
      }),
      el('span.field-hint', '교사 화면 위쪽에 있는 6글자. 비워 두면 수학 확인이 꺼져요.')),
    el('p.field-hint', '수학을 "했다"로 보는 기준: 그날 분수 연산 마스터에 접속해서 화면을 켰거나, 연습·도전을 시작했으면(중간에 그만둬도) 했다고 봐요.'),
    el('label.field', el('span.field-label', `등교 안 하는 날 (${offDays.length}일)`),
      el('textarea.input', {
        rows: 6, value: s.offDaysText,
        placeholder: '한 줄에 하루씩. # 뒤는 메모\n2026-09-24  # 추석 연휴\n2026-09-25',
        on: { input: (e) => { s.offDaysText = e.target.value; touch(); } },
      }),
      el('span.field-hint', '주말과 공휴일(대체공휴일 포함)은 자동으로 빠져요. 설날·추석·재량휴업일·방학만 적으세요.')),
    el('label.field', el('span.field-label', '수학 확인에서 항상 뺄 이름'),
      el('textarea.input', {
        rows: 3, value: s.mathExcludeText, placeholder: '한 줄에 한 명\n전지현\n테스트',
        on: { input: (e) => { s.mathExcludeText = e.target.value; touch(); } },
      }),
      el('span.field-hint', '분수 연산 마스터에 적힌 이름과 똑같이 적어 주세요. 10/28 화면부터는 L27 통과 학생도 세니, 빼야 할 학생은 여기에 적어 주세요.')),
    el('label.field', el('span.field-label', '누적 세기 시작일'),
      el('input.input', {
        value: s.mathCountStart, placeholder: '2026-10-08', inputmode: 'numeric',
        on: { input: (e) => { s.mathCountStart = e.target.value; touch(); } },
      }),
      el('span.field-hint', '이 날부터 등교일마다 수학을 안 한 날을 학생별로 세어요. (연속이 아니라 합계)')),
    el('label.field', el('span.field-label', '벌 기준 횟수'),
      el('input.input', {
        type: 'number', min: 1, max: 30, value: String(s.mathLimit), inputmode: 'numeric',
        on: { input: (e) => { s.mathLimit = e.target.value; touch(); } },
      }),
      el('span.field-hint', '누적이 이 횟수 이상이면 수학 확인 화면 아래에 크게 따로 보여요. 벌을 받으면 그 화면에서 "해제"를 누르면 0부터 다시 세요.')),
    el('div.row-actions',
      draft.settingsDirty ? el('button.btn', { type: 'button', on: { click: () => { draft.settingsDirty = false; ctx.rerender(); } } }, '고친 것 취소') : null,
      el('button.btn.primary', { type: 'button', on: { click: save } }, '설정 저장')));
}

function backupSection(ctx) {
  const download = () => {
    const data = ctx.store.exportAll(ctx.state);
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `우리반-백업-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const downloadCsv = () => {
    const students = sortByNo(ctx.state.room.roster);
    const asgs = ctx.state.assignments;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = (a) => `${a.title}${a.closedAt ? ` (${new Date(a.closedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })})` : ''}`;
    const lines = [['번호', '이름', ...asgs.map(head)].map(esc).join(',')];
    for (const s of students) lines.push([s.no, s.name, ...asgs.map((a) => (a.done[s.id] ? 'O' : ''))].map(esc).join(','));
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `과제체크-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!await confirmBox('백업으로 되돌릴까요?', '지금 있는 명단·과제·뽑기 기록이 백업 파일 내용으로 모두 바뀌어요.', { ok: '되돌리기', danger: true })) return;
      await ctx.store.importAll(data, ctx.state);
      draft.dirty = false;
      draft.settingsDirty = false;
      toast('백업을 불러왔어요', 'ok');
    } catch (e) {
      ctx.fail(e instanceof SyntaxError ? new AppError('invalid', '백업 파일을 읽지 못했어요') : e);
    }
  });

  return el('section.card',
    el('h2', '내보내기 · 백업'),
    el('div.row-actions',
      el('button.btn', { type: 'button', on: { click: downloadCsv } }, '과제 체크 엑셀(CSV)로 받기'),
      el('button.btn', { type: 'button', on: { click: download } }, '전체 백업 받기'),
      el('button.btn', { type: 'button', on: { click: () => fileInput.click() } }, '백업 파일로 되돌리기')),
    fileInput,
    el('p.muted.small', `저장 위치: Firebase · 반 이름표(room) "${ctx.room}"`));
}

export function render(root, ctx) {
  root.replaceChildren(el('div.page.class-page',
    rosterSection(ctx),
    settingsSection(ctx),
    backupSection(ctx)));
}

export function leave() {
  // 저장하지 않고 다른 탭으로 가면, 돌아왔을 때 저장된 내용으로 다시 보여 준다
  if (draft.dirty || draft.settingsDirty) toast('우리 반 탭에서 고친 내용은 저장하지 않아서 반영되지 않았어요', 'warn', 5000);
  draft.dirty = false;
  draft.settingsDirty = false;
}
