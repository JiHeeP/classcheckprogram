import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessage, encryptToken, decryptToken, pickRefreshToken, runNotify,
} from '../scripts/notify-lib.mjs';
import { fakeFirestoreFetch, sampleDb, weekDb, SAMPLE_NAMES } from './fake-firestore.js';

const CONFIG = { projectId: 'demo-class', apiKey: 'demo' };
// 한국 시간 2026-10-12(월) 08:30 → 이전 등교일 10/8(목) (10/9 한글날, 주말)
const MONDAY = new Date('2026-10-11T23:30:00Z');
const SUNDAY = new Date('2026-10-11T00:30:00Z');

const sv = (s) => ({ stringValue: s });
function roomDoc(extra = {}) {
  const roster = SAMPLE_NAMES.map((name, i) => ({
    mapValue: { fields: { id: sv(`s_${String(i).padStart(8, '0')}`), no: sv(String(i + 1)), name: sv(name) } },
  }));
  return {
    fields: {
      className: sv('5학년 4반'), mathCode: sv('TEST01'),
      offDaysText: sv(''), mathExcludeText: sv('테스트'), roster: { arrayValue: { values: roster } },
      ...extra,
    },
  };
}

/** 우리 반 Firestore, 분수 연산 마스터, 카카오(인증·메시지)를 한 번에 흉내 내는 fetch */
function world({ refreshResponse, kakaoFail, db } = {}) {
  const math = fakeFirestoreFetch(db || sampleDb('2026-10-08'));
  const store = new Map(); // 우리 반 Firestore 문서
  store.set('rooms/main', roomDoc());
  const sent = [];
  const refreshCalls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.host === 'firestore.googleapis.com' && url.pathname.includes('mathpractice-1d8f9')) return math(input, init);
    if (url.host === 'firestore.googleapis.com') {
      const path = decodeURIComponent(url.pathname.split('/documents/')[1]);
      if ((init.method || 'GET') === 'PATCH') {
        store.set(path, JSON.parse(init.body));
        return json({});
      }
      return store.has(path) ? json(store.get(path)) : json({ error: 'not found' }, 404);
    }
    if (url.host === 'kauth.kakao.com') {
      const form = Object.fromEntries(new URLSearchParams(init.body));
      refreshCalls.push(form);
      if (form.refresh_token === 'EXPIRED') return json({ error_code: 'KOE322', error_description: 'token expired' }, 400);
      return json(refreshResponse || { access_token: 'ACCESS', expires_in: 43199 });
    }
    if (url.host === 'kapi.kakao.com') {
      if (kakaoFail) return json({ msg: 'insufficient scopes', code: -402 }, 403);
      const form = Object.fromEntries(new URLSearchParams(init.body));
      sent.push({ auth: init.headers.Authorization, template: JSON.parse(form.template_object) });
      return json({ result_code: 0 });
    }
    return json({ error: `예상 못 한 주소 ${url}` }, 500);
  };
  return { fetchImpl, store, sent, refreshCalls, math };
}

const ENV = { KAKAO_REST_API_KEY: 'KEY', KAKAO_CLIENT_SECRET: 'SECRET', KAKAO_REFRESH_TOKEN: 'REFRESH-1', SITE_URL: 'https://class.example.app' };

test('메시지: 안 한 학생, 모두 한 경우', () => {
  const r = { dateLabel: '10/8 (목)', total: 17, done: 15, missing: [{ no: '3', name: '박도윤' }, { no: '7', name: '조하준' }] };
  assert.equal(buildMessage(r, { className: '5학년 4반' }),
    '5학년 4반 수학 안 한 사람 · 10/8 (목)\n3번 박도윤, 7번 조하준\n(17명 중 15명 함)');
  assert.match(buildMessage({ ...r, missing: [], done: 17 }), /모두 했어요/);
});

test('메시지: 글자 수가 넘으면 "외 N명"으로 줄임', () => {
  const missing = Array.from({ length: 18 }, (_, i) => ({ no: String(i + 1), name: `학생이름${i + 1}` }));
  const text = buildMessage({ dateLabel: '10/8 (목)', total: 18, done: 0, missing }, { className: '5학년 4반' });
  assert.ok(text.length <= 200, `길이 ${text.length}`);
  assert.match(text, /외 \d+명/);
  assert.ok(text.includes('1번 학생이름1'));
});

test('토큰 암호화: 되돌리기, 다른 키로는 못 풂, 변조 감지', () => {
  const blob = encryptToken('NEW-REFRESH', 'REFRESH-1', 'SECRET');
  assert.equal(decryptToken(blob, 'SECRET'), 'NEW-REFRESH');
  assert.equal(decryptToken(blob, 'OTHER'), null);
  assert.equal(decryptToken({ ...blob, data: Buffer.from('x').toString('base64') }, 'SECRET'), null);
  assert.ok(!JSON.stringify(blob).includes('NEW-REFRESH'));
});

test('토큰 고르기: 보관본 우선, 선생님이 Secret 을 바꿨으면 Secret', () => {
  const blob = encryptToken('NEW-REFRESH', 'REFRESH-1', 'SECRET');
  assert.equal(pickRefreshToken('REFRESH-1', blob, 'SECRET'), 'NEW-REFRESH');
  assert.equal(pickRefreshToken('REFRESH-2', blob, 'SECRET'), 'REFRESH-2'); // Secret 이 새로 바뀜
  assert.equal(pickRefreshToken('REFRESH-1', null, 'SECRET'), 'REFRESH-1');
  assert.equal(pickRefreshToken('REFRESH-1', blob, 'WRONG'), 'REFRESH-1');
});

test('연습 실행: 카카오는 부르지 않고 내용만', async () => {
  const w = world();
  const r = await runNotify({ config: CONFIG, env: {}, dryRun: true, now: MONDAY, fetchImpl: w.fetchImpl });
  assert.equal(r.status, 'dry-run');
  assert.equal(r.count, 2); // 3번, 7번 (12번은 L27 통과, 99번 테스트는 제외 목록)
  assert.match(r.text, /3번 박도윤, 7번 조하준/);
  assert.equal(w.refreshCalls.length, 0);
  assert.equal(w.sent.length, 0);
});

test('평일 아침: 토큰 갱신 후 카카오톡 보냄', async () => {
  const w = world();
  const r = await runNotify({ config: CONFIG, env: ENV, now: MONDAY, fetchImpl: w.fetchImpl });
  assert.equal(r.status, 'sent');
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].auth, 'Bearer ACCESS');
  assert.equal(w.sent[0].template.object_type, 'text');
  assert.match(w.sent[0].template.text, /3번 박도윤, 7번 조하준/);
  assert.equal(w.sent[0].template.link.web_url, 'https://class.example.app');
  assert.equal(w.refreshCalls[0].refresh_token, 'REFRESH-1');
  assert.equal(w.refreshCalls[0].client_secret, 'SECRET');
  assert.equal(w.store.has('rooms/main/private/kakao'), false); // 새 리프레시 토큰이 안 왔으니 보관 안 함
});

test('주말·공휴일이면 보내지 않음 (force 면 보냄)', async () => {
  const w = world();
  const skipped = await runNotify({ config: CONFIG, env: ENV, now: SUNDAY, fetchImpl: w.fetchImpl });
  assert.equal(skipped.status, 'skipped');
  assert.match(skipped.reason, /주말/);
  assert.equal(w.sent.length, 0);
  const forced = await runNotify({ config: CONFIG, env: ENV, now: SUNDAY, force: true, fetchImpl: w.fetchImpl });
  assert.equal(forced.status, 'sent');
});

test('새 리프레시 토큰이 오면 암호화해서 보관하고, 다음 실행에 그걸 씀', async () => {
  const w = world({ refreshResponse: { access_token: 'ACCESS', refresh_token: 'REFRESH-NEW', expires_in: 43199 } });
  await runNotify({ config: CONFIG, env: ENV, now: MONDAY, fetchImpl: w.fetchImpl });
  const saved = w.store.get('rooms/main/private/kakao');
  assert.ok(saved, '보관됨');
  const stored = JSON.stringify(saved);
  assert.ok(!stored.includes('REFRESH-NEW') && !stored.includes('REFRESH-1'), '평문이 아님');

  await runNotify({ config: CONFIG, env: ENV, now: MONDAY, fetchImpl: w.fetchImpl });
  assert.equal(w.refreshCalls[1].refresh_token, 'REFRESH-NEW');

  // 선생님이 Secret 을 새 값으로 바꾸면 그 값을 씀
  await runNotify({ config: CONFIG, env: { ...ENV, KAKAO_REFRESH_TOKEN: 'REFRESH-2' }, now: MONDAY, fetchImpl: w.fetchImpl });
  assert.equal(w.refreshCalls[2].refresh_token, 'REFRESH-2');
});

test('오류: 카카오 설정 없음, 토큰 만료, 메시지 거부 — 비밀 값은 오류 글에 없음', async () => {
  const w = world();
  await assert.rejects(runNotify({ config: CONFIG, env: {}, now: MONDAY, fetchImpl: w.fetchImpl }), /카카오 설정/);

  await assert.rejects(
    runNotify({ config: CONFIG, env: { ...ENV, KAKAO_REFRESH_TOKEN: 'EXPIRED' }, now: MONDAY, fetchImpl: w.fetchImpl }),
    (e) => /KOE322/.test(e.message) && !e.message.includes('EXPIRED') && !e.message.includes('SECRET'));

  const denied = world({ kakaoFail: true });
  await assert.rejects(runNotify({ config: CONFIG, env: ENV, now: MONDAY, fetchImpl: denied.fetchImpl }), /-402/);
});

test('수학 반 코드가 없으면 건너뜀', async () => {
  const w = world();
  w.store.set('rooms/main', roomDoc({ mathCode: sv('') }));
  const r = await runNotify({ config: CONFIG, env: ENV, now: MONDAY, fetchImpl: w.fetchImpl });
  assert.equal(r.status, 'skipped');
  assert.equal(w.sent.length, 0);
});

test('메시지: 누적 기준 이상 학생 줄 (이름이 많으면 줄여도 누적 학생은 남김)', () => {
  const report = {
    dateLabel: '10/15 (목)', total: 17, done: 14, limit: 3,
    missing: [{ no: '3', name: '박도윤' }, { no: '5', name: '정시우' }],
    overLimit: [{ no: '3', name: '박도윤', count: 5 }, { no: '5', name: '정시우', count: 3 }],
  };
  assert.equal(buildMessage(report, { className: '5학년 4반' }),
    '5학년 4반 수학 안 한 사람 · 10/15 (목)\n3번 박도윤, 5번 정시우\n⚠ 누적 3회 이상: 3번 박도윤(5회), 5번 정시우(3회)\n(17명 중 14명 함)');

  const many = Array.from({ length: 18 }, (_, i) => ({ no: String(i + 1), name: `학생이름${i + 1}` }));
  const text = buildMessage({ ...report, total: 18, done: 0, missing: many, overLimit: many.slice(0, 2).map((s) => ({ ...s, count: 4 })) });
  assert.ok(text.length <= 200, `길이 ${text.length}`);
  assert.match(text, /⚠ 누적 3회 이상: 1번 학생이름1\(4회\), 2번 학생이름2\(4회\)/);
});

test('누적 기준 이상 학생이 카카오톡에 들어가고, 지난 날짜는 저장해서 다음에 다시 안 부름', async () => {
  const misses = { 3: WEEK_DAYS_ALL(), 5: ['2026-10-12', '2026-10-13', '2026-10-14'] };
  const w = world({ db: weekDb(misses) });
  w.store.set('rooms/main', roomDoc({ mathExcludeText: sv('테스트') }));
  const FRI = new Date('2026-10-15T23:30:00Z'); // 한국 시간 10/16(금) 08:30 → 이전 등교일 10/15
  const r = await runNotify({ config: CONFIG, env: ENV, now: FRI, fetchImpl: w.fetchImpl });
  assert.equal(r.status, 'sent');
  assert.match(w.sent[0].template.text, /⚠ 누적 3회 이상: 3번 박도윤\(5회\), 5번 정시우\(3회\)/);
  const days = JSON.parse(w.store.get('rooms/main/cache/mathDays').fields.daysJson.stringValue);
  assert.deepEqual(Object.keys(days).sort(), ['2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
});

test('연습 실행은 지난 날짜를 저장하지 않음', async () => {
  const w = world({ db: weekDb({}) });
  const FRI = new Date('2026-10-15T23:30:00Z');
  await runNotify({ config: CONFIG, env: {}, dryRun: true, now: FRI, fetchImpl: w.fetchImpl });
  assert.equal(w.store.has('rooms/main/cache/mathDays'), false);
});

test('해제한 학생은 그날까지의 횟수가 빠짐', async () => {
  const w = world({ db: weekDb({ 3: WEEK_DAYS_ALL() }) });
  w.store.set('rooms/main', roomDoc({ mathExcludeText: sv('테스트'), mathCleared: { mapValue: { fields: { 3: sv('2026-10-13') } } } }));
  const FRI = new Date('2026-10-15T23:30:00Z');
  const r = await runNotify({ config: CONFIG, env: {}, dryRun: true, now: FRI, fetchImpl: w.fetchImpl });
  assert.doesNotMatch(r.text, /누적/, '10/14, 10/15 두 번뿐이라 기준(3) 미만');
});

test('같은 날 두 번째 실행은 저장해 둔 자료를 써서 분수 연산 마스터를 안 부름', async () => {
  const w = world();
  await runNotify({ config: CONFIG, env: {}, dryRun: true, now: MONDAY, fetchImpl: w.fetchImpl });
  assert.equal(w.store.has('rooms/main/cache/mathBase'), false, '연습 실행은 저장하지 않음');
  const first = await runNotify({ config: CONFIG, env: ENV, now: MONDAY, fetchImpl: w.fetchImpl });
  assert.ok(w.store.has('rooms/main/cache/mathBase'));
  const before = w.math.calls.length;
  const second = await runNotify({ config: CONFIG, env: ENV, now: MONDAY, fetchImpl: w.fetchImpl });
  assert.equal(w.math.calls.length, before);
  assert.equal(second.text, first.text);
});

function WEEK_DAYS_ALL() {
  return ['2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
}
