// 교실 관리 사이트 — 화면 전체를 묶는 부분
import { connect } from './firebase.js';
import { createStore } from './store.js';
import { el, toast, storageGet, storageSet } from './ui.js';
import { AppError } from './lib/model.js';
import * as checkView from './views/check.js';
import * as drawView from './views/draw.js';
import * as mathView from './views/math.js';
import * as classView from './views/class.js';
import { renderSetup } from './views/setup.js';

const VIEWS = { check: checkView, draw: drawView, math: mathView, class: classView };
const DEFAULT_TAB = 'check';
// ?popup=1 : 학교 PC 바탕화면 팝업용. 메뉴 없이 수학 확인 화면만 작게 보여 준다.
//   &pos=tr|br|tl|bl|c  창 위치(오른쪽 위·오른쪽 아래·왼쪽 위·왼쪽 아래·가운데, 기본 tr)
//   &pos=keep           화면이 창을 옮기지 않음 (트레이 프로그램 school-pc/math_popup_tray.ps1 이 자리를 맡을 때)
//   &w=560&h=520        창 크기
// 팝업 창 제목은 늘 '수학 확인 팝업'으로 시작한다. 트레이 프로그램이 이 제목으로 창을 찾아 '항상 위'·자리 고정을 건다.
const POPUP = new URLSearchParams(location.search).has('popup');
const POPUP_TITLE = '수학 확인 팝업';
if (POPUP) {
  document.body.classList.add('popup');
  document.title = POPUP_TITLE;
  if (new URLSearchParams(location.search).get('pos') !== 'keep') placePopupWindow();
}

/**
 * 팝업 창을 늘 같은 자리에 둔다. 브라우저는 앱 창의 마지막 위치를 기억해서 flag 만으로는 자리가 달라질 수
 * 있어서, 화면이 직접 작업 영역(작업 표시줄 제외) 기준 모서리로 옮긴다.
 */
function placePopupWindow() {
  const q = new URLSearchParams(location.search);
  const pos = ['tr', 'br', 'tl', 'bl', 'c'].includes(q.get('pos')) ? q.get('pos') : 'tr';
  const w = Number(q.get('w')) || 560;
  const h = Number(q.get('h')) || 620;
  const margin = 16;
  const apply = () => {
    try {
      window.resizeTo(w, h);
      const left = screen.availLeft || 0;
      const top = screen.availTop || 0;
      const ow = window.outerWidth || w;
      const oh = window.outerHeight || h;
      const x = pos === 'c' ? left + (screen.availWidth - ow) / 2
        : pos.includes('l') ? left + margin : left + screen.availWidth - ow - margin;
      const y = pos === 'c' ? top + (screen.availHeight - oh) / 2
        : pos.startsWith('b') ? top + screen.availHeight - oh - margin : top + margin;
      window.moveTo(Math.round(x), Math.round(y));
    } catch {
      // 옮길 수 없는 창이면 브라우저가 정한 자리에 그대로 둔다
    }
  };
  apply();
  setTimeout(apply, 400); // 창이 다 뜬 뒤 한 번 더 (브라우저가 기억한 자리를 덮어씀)
  setTimeout(apply, 1500);
}

const viewRoot = document.getElementById('view');
const banner = document.getElementById('banner');
const syncEl = document.getElementById('sync');
const classNameEl = document.getElementById('class-name');

const ctx = {
  store: null,
  state: null,
  status: null,
  room: 'main',
  prefs: storageGet('cr:prefs', {}),
  tab: DEFAULT_TAB,
  setPref(key, value) {
    ctx.prefs[key] = value;
    storageSet('cr:prefs', ctx.prefs);
  },
  go(tab) {
    location.hash = `#${tab}`;
  },
  rerender() {
    render({ force: true });
  },
  /** 저장 실패 알림. AppError 는 그 메시지를, 그 밖은 Firebase 오류를 쉬운 말로. */
  fail(e) {
    console.error(e);
    toast(friendlyError(e), 'error', 5000);
  },
};

function friendlyError(e) {
  if (e instanceof AppError) return e.message;
  if (e?.code === 'permission-denied') return 'Firebase 규칙 때문에 저장하지 못했어요 (README 의 규칙 설정 확인)';
  if (e?.code === 'unavailable') return '인터넷 연결이 필요해요';
  if (e?.code === 'not-found') return '다른 기기에서 지운 항목이에요';
  return '저장하지 못했어요. 잠시 뒤 다시 해 주세요.';
}

function currentTab() {
  if (POPUP) return 'math';
  const t = location.hash.replace('#', '');
  return VIEWS[t] ? t : DEFAULT_TAB;
}

function render({ force = false } = {}) {
  const tab = currentTab();
  const changedTab = tab !== ctx.tab;
  if (changedTab) VIEWS[ctx.tab]?.leave?.(ctx);
  ctx.tab = tab;
  document.querySelectorAll('.tab').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.body.dataset.tab = tab;
  if (!ctx.state) return;
  const view = VIEWS[tab];
  if (!changedTab && !force && view.shouldSkipRender?.(ctx)) return;
  view.render(viewRoot, ctx, { changedTab });
}

function updateBanner() {
  const s = ctx.status || {};
  const msgs = [];
  if (!navigator.onLine) {
    msgs.push(['error', '인터넷 연결이 끊겼어요. 체크한 것은 이 기기에 저장해 두었다가 연결되면 자동으로 올라가요. (번호 뽑기는 연결된 뒤에 해 주세요)']);
  } else if (s.error) {
    msgs.push(['error', `기록을 불러오지 못했어요: ${friendlyError(s.error)}`]);
  }
  banner.replaceChildren(...msgs.map(([kind, text]) => el(`div.banner-item.banner-${kind}`, text)));
  banner.hidden = msgs.length === 0;

  let sync = '';
  if (!navigator.onLine) sync = '오프라인';
  else if (s.pending) sync = '저장 중…';
  else if (s.ready && !s.fromCache) sync = '저장됨';
  syncEl.textContent = sync;
  syncEl.dataset.state = !navigator.onLine ? 'offline' : s.pending ? 'pending' : 'ok';
}

function setupFullscreen() {
  const btn = document.getElementById('fullscreen');
  if (!document.documentElement.requestFullscreen) {
    btn.hidden = true;
    return;
  }
  btn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
}

async function main() {
  setupFullscreen();
  window.addEventListener('online', updateBanner);
  window.addEventListener('offline', updateBanner);
  window.addEventListener('hashchange', () => render());

  let conn;
  try {
    conn = await connect();
  } catch (e) {
    console.error(e);
    viewRoot.replaceChildren(el('div.empty',
      el('h2', 'Firebase 를 불러오지 못했어요'),
      el('p', '인터넷 연결을 확인하고 새로고침해 주세요.'),
      el('button.btn.primary', { type: 'button', on: { click: () => location.reload() } }, '새로고침')));
    return;
  }
  if (!conn.configured) {
    renderSetup(viewRoot);
    return;
  }

  ctx.room = conn.room;
  ctx.store = createStore(conn.fs, conn.db, conn.room);
  ctx.store.onError((e) => ctx.fail(e));
  ctx.store.subscribe((state, status) => {
    ctx.state = state;
    ctx.status = status;
    const name = state.room.className || '우리 반';
    classNameEl.textContent = name;
    document.title = POPUP ? `${POPUP_TITLE} · ${name}` : name;
    updateBanner();
    render();
  });
}

main();
