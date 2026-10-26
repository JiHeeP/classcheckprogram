// 수학 미실시 학생 알림 (카카오톡 "나에게 보내기")
//
// 하는 일: 우리 반 설정(Firestore) 읽기 → 이전 등교일 기준 수학 안 한 학생 계산(사이트와 같은 코드)
//          → 카카오톡 나와의 채팅으로 보내기
//
// 카카오 리프레시 토큰은 60일 뒤 만료되고, 만료 1개월 전부터는 갱신 때 새 토큰이 나온다.
// 새 토큰은 Firestore(rooms/{room}/private/kakao)에 암호화해서 저장해 두고 다음 실행 때 쓴다.
//   암호 키 = Client Secret 에서 만든 값. 저장된 값만 봐서는 토큰을 알 수 없다.
//
// 공개 저장소의 Actions 로그에는 학생 이름을 남기지 않는다 (CI 에서는 인원 수만 출력).

import crypto from 'node:crypto';
import {
  buildReport, decodeValue, DEFAULT_EXCLUDE_TEXT, DEFAULT_COUNT_START, DEFAULT_LIMIT, parseNames,
} from '../public/js/lib/mathpractice.js';
import { parseDate, parseOffDays } from '../public/js/lib/schoolday.js';

const KAUTH = 'https://kauth.kakao.com';
const KAPI = 'https://kapi.kakao.com';
const TEXT_LIMIT = 200; // 카카오 텍스트 메시지 글자 수 (문서에 명시가 없어 넉넉히 보수적으로)

// ---------------------------------------------------------------------------
// 메시지 만들기 (순수 함수)
// ---------------------------------------------------------------------------

/** 안 한 학생이 많아 글자 수를 넘으면 앞에서부터 담고 "외 N명"으로 줄인다. */
export function buildMessage(report, { className = '', maxLen = TEXT_LIMIT } = {}) {
  const head = `${className ? `${className} ` : ''}수학 안 한 사람 · ${report.dateLabel}`;
  const foot = `(${report.total}명 중 ${report.done}명 함)`;
  const missing = report.missing.map((s) => `${s.no}번 ${s.name}`);
  const over = (report.overLimit || []).map((s) => `${s.no}번 ${s.name}(${s.count}회)`);

  const list = (items, n) => items.slice(0, n).join(', ') + (n < items.length ? ` 외 ${items.length - n}명` : '');
  const compose = (m, o) => [
    head,
    missing.length ? list(missing, m) : '모두 했어요! 🎉',
    over.length ? `⚠ 누적 ${report.limit}회 이상: ${list(over, o)}` : '',
    foot,
  ].filter(Boolean).join('\n');

  // 글자 수가 넘으면 이름이 더 많은 쪽부터 줄인다 (누적 학생은 최대한 남김)
  let m = missing.length;
  let o = over.length;
  let text = compose(m, o);
  while (text.length > maxLen && (m > 1 || o > 1)) {
    if (m > 1 && (m > o || o <= 1)) m -= 1;
    else o -= 1;
    text = compose(m, o);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Firestore REST (우리 반 설정 읽기, 토큰 보관)
// ---------------------------------------------------------------------------

function docUrl(config, path) {
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/${path}?key=${config.apiKey}`;
}

async function fsGet(config, path, fetchImpl) {
  const res = await fetchImpl(docUrl(config, path));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore 읽기 실패 (HTTP ${res.status})`);
  const doc = await res.json();
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = decodeValue(v);
  return out;
}

async function fsSet(config, path, data, fetchImpl) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) fields[k] = { stringValue: String(v) };
  const res = await fetchImpl(docUrl(config, path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Firestore 쓰기 실패 (HTTP ${res.status})`);
}

export async function readRoom(config, room, fetchImpl) {
  const d = await fsGet(config, `rooms/${encodeURIComponent(room)}`, fetchImpl);
  if (!d) throw new Error(`rooms/${room} 이 아직 없어요. 사이트에서 명단과 수학 반 코드를 먼저 저장해 주세요.`);
  return {
    className: d.className || '',
    mathCode: d.mathCode || '',
    offDaysText: d.offDaysText || '',
    mathExcludeText: typeof d.mathExcludeText === 'string' ? d.mathExcludeText : DEFAULT_EXCLUDE_TEXT,
    mathCountStart: parseDate(d.mathCountStart) || DEFAULT_COUNT_START,
    mathLimit: Number.isInteger(d.mathLimit) && d.mathLimit >= 1 ? d.mathLimit : DEFAULT_LIMIT,
    mathCleared: d.mathCleared && typeof d.mathCleared === 'object' ? d.mathCleared : {},
    roster: Array.isArray(d.roster) ? d.roster : [],
  };
}

/** 지난 날짜별 '그날 한 학생'을 사이트와 같은 문서(rooms/{room}/cache/mathDays)에 보관한다 */
function makeDayCache(config, room, fetchImpl, readOnly) {
  const path = `rooms/${encodeURIComponent(room)}/cache/mathDays`;
  return {
    async load(code) {
      try {
        const d = await fsGet(config, path, fetchImpl);
        return d && d.classCode === code ? JSON.parse(d.daysJson || '{}') : {};
      } catch {
        return {};
      }
    },
    async save(code, all) {
      if (readOnly) return;
      try {
        await fsSet(config, path, { classCode: code, daysJson: JSON.stringify(all), savedAt: Date.now() }, fetchImpl);
      } catch {
        // 저장 못 해도 다음에 다시 계산하면 돼요
      }
    },
  };
}

/** 오늘 받은 반·명단·L27 통과·이전 등교일 기록 (사이트와 같은 문서 rooms/{room}/cache/mathBase) */
function makeBaseCache(config, room, fetchImpl, readOnly) {
  const path = `rooms/${encodeURIComponent(room)}/cache/mathBase`;
  return {
    async load(code) {
      try {
        const d = await fsGet(config, path, fetchImpl);
        return d && d.classCode === code ? JSON.parse(d.baseJson || 'null') : null;
      } catch {
        return null;
      }
    },
    async save(code, base) {
      if (readOnly) return;
      try {
        await fsSet(config, path, { classCode: code, baseJson: JSON.stringify(base), savedAt: Date.now() }, fetchImpl);
      } catch {
        // 저장 못 해도 다음에 다시 받으면 돼요
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 토큰 암호화 보관
// ---------------------------------------------------------------------------

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const tokenKey = (clientSecret) => sha(`classroom-kakao:${clientSecret}`);

export function encryptToken(refreshToken, fromToken, clientSecret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(clientSecret), iv);
  const data = Buffer.concat([cipher.update(String(refreshToken), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
    from: sha(fromToken).toString('hex').slice(0, 16), // 어떤 시작 토큰에서 이어졌는지
  };
}

/** 복호화에 실패(키가 다르거나 값이 바뀜)하면 null */
export function decryptToken(blob, clientSecret) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(clientSecret), Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 쓸 리프레시 토큰 고르기.
 * - 보관된 새 토큰이 있고, 그게 지금 GitHub Secret 의 토큰에서 이어진 것이면 보관된 것
 * - 선생님이 Secret 을 새 토큰으로 바꿨다면(from 이 다르면) Secret 의 토큰
 */
export function pickRefreshToken(envToken, blob, clientSecret) {
  if (blob && blob.from === sha(envToken).toString('hex').slice(0, 16)) {
    const stored = decryptToken(blob, clientSecret);
    if (stored) return stored;
  }
  return envToken;
}

// ---------------------------------------------------------------------------
// 카카오 API
// ---------------------------------------------------------------------------

async function kakaoJson(res, what) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 토큰·키 값은 절대 출력하지 않고 오류 코드만 남긴다
    const code = body.error_code || body.code || body.error || res.status;
    const msg = body.error_description || body.msg || '';
    throw new Error(`${what} 실패 (${code}) ${msg}`.trim());
  }
  return body;
}

export async function refreshAccessToken({ restKey, clientSecret, refreshToken }, fetchImpl, base = KAUTH) {
  const res = await fetchImpl(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: restKey, client_secret: clientSecret, refresh_token: refreshToken,
    }),
  });
  return kakaoJson(res, '카카오 토큰 갱신');
}

export async function sendMemo(accessToken, text, siteUrl, fetchImpl, base = KAPI) {
  const link = siteUrl || 'https://www.kakao.com';
  const res = await fetchImpl(`${base}/v2/api/talk/memo/default/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({
      template_object: JSON.stringify({
        object_type: 'text', text, link: { web_url: link, mobile_web_url: link }, button_title: '수학 확인 열기',
      }),
    }),
  });
  const body = await kakaoJson(res, '카카오톡 보내기');
  if (body.result_code !== 0) throw new Error(`카카오톡 보내기 실패 (result_code ${body.result_code})`);
}

// ---------------------------------------------------------------------------
// 한 번 실행
// ---------------------------------------------------------------------------

/**
 * @returns {{status:'sent'|'dry-run'|'skipped', reason?:string, count?:number, text?:string}}
 */
export async function runNotify({
  config, room = 'main', env = {}, dryRun = false, force = false, now = new Date(),
  fetchImpl = globalThis.fetch, log = () => {},
}) {
  const roomData = await readRoom(config, room, fetchImpl);
  if (!roomData.mathCode) return { status: 'skipped', reason: '수학 반 코드가 아직 없어요 (사이트 우리 반 탭)' };

  const report = await buildReport({
    classCode: roomData.mathCode,
    offDays: parseOffDays(roomData.offDaysText),
    roster: roomData.roster,
    excludeNames: parseNames(roomData.mathExcludeText),
    countStart: roomData.mathCountStart,
    limit: roomData.mathLimit,
    cleared: roomData.mathCleared,
    dayCache: makeDayCache(config, room, fetchImpl, dryRun), // 연습 실행은 저장하지 않음
    baseCache: makeBaseCache(config, room, fetchImpl, dryRun),
    now,
    fetchImpl,
  });
  if (report.todayOff && !force) return { status: 'skipped', reason: `오늘은 ${report.todayOff}이라 보내지 않아요` };

  const text = buildMessage(report, { className: roomData.className });
  const count = report.missing.length;
  if (dryRun) {
    log(`(연습 실행) 안 한 학생 ${count}명, 기준 ${report.dateLabel}`);
    return { status: 'dry-run', count, text };
  }

  const { KAKAO_REST_API_KEY: restKey, KAKAO_CLIENT_SECRET: clientSecret, KAKAO_REFRESH_TOKEN: envToken, SITE_URL: siteUrl } = env;
  if (!restKey || !clientSecret || !envToken) {
    throw new Error('카카오 설정(KAKAO_REST_API_KEY, KAKAO_CLIENT_SECRET, KAKAO_REFRESH_TOKEN)이 비어 있어요');
  }

  const vault = `rooms/${encodeURIComponent(room)}/private/kakao`;
  const blob = await fsGet(config, vault, fetchImpl).catch(() => null);
  const refreshToken = pickRefreshToken(envToken, blob, clientSecret);

  const tokens = await refreshAccessToken({ restKey, clientSecret, refreshToken }, fetchImpl);
  if (tokens.refresh_token) {
    // 만료 1개월 전부터 새 리프레시 토큰이 온다. 먼저 보관해서 잃어버리지 않게 한다.
    await fsSet(config, vault, encryptToken(tokens.refresh_token, envToken, clientSecret), fetchImpl);
    log('리프레시 토큰이 갱신되어 새로 보관했어요');
  }
  await sendMemo(tokens.access_token, text, siteUrl, fetchImpl);
  return { status: 'sent', count, text };
}
