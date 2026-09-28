'use strict';

// ============ 전체 랭킹 (같이 해본 사람들의 전적) ============
// 서버가 없는 정적 사이트라 전적은 각자 브라우저에만 쌓인다. 그래서 랭킹은
// "같은 방에서 대전한 사람끼리 자기 기록을 주고받아" 만든다. 대전이 끝나면
// 각자 갱신된 기록을 방 안에 돌리고, 받은 쪽은 자기 브라우저에 모아둔다.
//
// 공개된 곳에 올리지 않는 이유: 온라인 대전에 쓰는 중계 서버는 누구나 들어올
// 수 있는 공개 서버다. 거기에 기록을 남겨두면 모르는 사람도 닉네임과 전적을
// 볼 수 있고 가짜 기록을 넣을 수도 있다. 방 안에서만 주고받으면 어차피 같이
// 게임한 사람들끼리만 오간다.
//
// 그래서 랭킹에는 "나와 같이 해본 사람"만 나온다. 남이 나 없이 둔 판은
// 그 사람을 다시 만났을 때 갱신된다.

const ROSTER_KEY = 'splendorLiteRoster';
const BOARD_MIN_GAMES = 5; // 승률 순위에 넣으려면 필요한 판수
const BOARD_MAX_PLAYERS = 100; // 보관할 사람 수 상한

const BOARD = { sort: 'rate' }; // rate | wins | games
window.BOARD = BOARD;

// ---- 값 다듬기 ----
// 남이 보낸 것이므로 그대로 믿지 않는다. 모양이 안 맞으면 버린다.
function boardNum(v) {
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 99999) : 0;
}

function boardCounts(map) {
  const out = {};
  ['2', '3', '4'].forEach((n) => {
    const r = map && map[n];
    out[n] = { w: boardNum(r && r.w), l: boardNum(r && r.l), d: boardNum(r && r.d) };
  });
  return out;
}

function boardSanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 40) : '';
  if (!id) return null;
  const name = (typeof raw.name === 'string' ? raw.name : '').trim().slice(0, 12);
  const at = Number.isFinite(raw.at) ? Math.min(Math.max(raw.at, 0), Date.now() + 86400000) : 0;
  return { id, name: name || '이름 없음', at, online: boardCounts(raw.online) };
}

// ---- 내 기록 ----
// 랭킹에는 온라인 대전만 넣는다. AI를 이긴 것까지 섞으면 순위가 뜻이 없다.
function boardMyRecord() {
  const s = statsLoad();
  return {
    id: statsProfile().id,
    name: statsMyDisplayName(),
    at: Date.now(),
    online: boardCounts(s.totals.online),
  };
}

// ---- 받아둔 사람들 ----
function boardRosterLoad() {
  const raw = statsReadJson(ROSTER_KEY, null);
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  Object.keys(raw).forEach((k) => {
    const rec = boardSanitize(raw[k]);
    if (rec) out[rec.id] = rec;
  });
  return out;
}

function boardRosterSave(map) {
  // 오래 안 본 사람부터 잘라낸다
  const list = Object.keys(map)
    .map((k) => map[k])
    .sort((a, b) => b.at - a.at)
    .slice(0, BOARD_MAX_PLAYERS);
  const out = {};
  list.forEach((r) => {
    out[r.id] = r;
  });
  statsWriteJson(ROSTER_KEY, out);
}

// 한 사람의 기록을 받아 넣는다. 더 최신 것만 남긴다.
function boardMerge(raw) {
  const rec = boardSanitize(raw);
  if (!rec) return false;
  if (rec.id === statsProfile().id) return false; // 내 기록은 내 것이 최신이다
  const map = boardRosterLoad();
  const prev = map[rec.id];
  if (prev && prev.at > rec.at) return false;
  map[rec.id] = rec;
  boardRosterSave(map);
  return true;
}

function boardMergeMany(list) {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  list.slice(0, BOARD_MAX_PLAYERS).forEach((r) => {
    if (boardMerge(r)) n += 1;
  });
  return n;
}

// 방 안에 돌릴 명단: 내 기록 + 내가 아는 사람들
function boardShareList() {
  const map = boardRosterLoad();
  return [boardMyRecord()].concat(Object.keys(map).map((k) => map[k])).slice(0, BOARD_MAX_PLAYERS);
}

// 랭킹에 쓸 전체 명단. 세 갈래에서 모은다.
//   1) 내 기록 - 항상 지금 것이고, 남이 덮어쓸 수 없다
//   2) 방에서 만나 받아둔 사람들
//   3) 그룹에서 불러온 사람들
// 같은 사람이 겹치면 더 최근 것을 쓴다.
function boardAll() {
  const map = boardRosterLoad();
  const mine = boardMyRecord();
  const out = Object.create(null);
  Object.keys(map).forEach((k) => {
    out[k] = map[k];
  });
  (BOARD.players || []).forEach((r) => {
    const prev = out[r.id];
    if (!prev || r.at >= prev.at) out[r.id] = r;
  });
  delete out[mine.id];
  return [mine].concat(Object.keys(out).map((k) => out[k]));
}

function boardKnownCount() {
  return Object.keys(boardRosterLoad()).length;
}

// ---- 순위 매기기 ----
function boardRowOf(p, filter) {
  const rec = statsSum(p.online, filter);
  const total = rec.w + rec.l + rec.d;
  return {
    id: p.id,
    name: p.name,
    at: p.at,
    w: rec.w,
    l: rec.l,
    d: rec.d,
    total,
    rate: total ? (rec.w / total) * 100 : 0,
  };
}

// 승률 순위는 판수가 적으면 뜻이 없다. 1승 0패가 1등이 되면 안 되므로
// BOARD_MIN_GAMES 미만은 뒤로 내리고 따로 표시한다.
function boardRanking(players, filter, sort) {
  const rows = (players || []).map((p) => boardRowOf(p, filter)).filter((r) => r.total > 0);

  let cmp;
  if (sort === 'wins') {
    cmp = (a, b) => b.w - a.w || b.rate - a.rate || b.total - a.total;
  } else if (sort === 'games') {
    cmp = (a, b) => b.total - a.total || b.w - a.w;
  } else {
    cmp = (a, b) => {
      const qa = a.total >= BOARD_MIN_GAMES ? 1 : 0;
      const qb = b.total >= BOARD_MIN_GAMES ? 1 : 0;
      if (qa !== qb) return qb - qa;
      return b.rate - a.rate || b.w - a.w || b.total - a.total;
    };
  }
  rows.sort((a, b) => cmp(a, b) || String(a.name).localeCompare(String(b.name)));

  // 성적이 같으면 같은 등수를 준다
  const keyOf = (r) => {
    if (sort === 'wins') return `${r.w}`;
    if (sort === 'games') return `${r.total}`;
    return `${r.total >= BOARD_MIN_GAMES ? 1 : 0}|${boardRateText(r.rate)}`;
  };
  let rank = 0;
  let prevKey = null;
  rows.forEach((r, i) => {
    const k = keyOf(r);
    if (k !== prevKey) {
      rank = i + 1;
      prevKey = k;
    }
    r.rank = rank;
    r.few = r.total < BOARD_MIN_GAMES;
  });
  return rows;
}

// 화면에 쓰는 승률 문구 (소수 한 자리)
function boardRateText(rate) {
  return (Math.round(rate * 10) / 10).toFixed(1);
}

function boardAgo(at) {
  if (!at) return '';
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d < 100 ? `${d}일 전` : '오래전';
}

// 판이 끝나 내 기록이 바뀌면 같은 방 사람들에게 알린다.
function boardShareResult() {
  if (typeof netShareRecord === 'function') netShareRecord();
  boardGroupPublish(); // 그룹을 쓰고 있으면 거기에도 올린다
}

// ============ 랭킹 그룹 (같이 안 해본 사람도 바로 조회) ============
// 방에서 주고받는 것만으로는 "나와 붙어본 사람"밖에 못 본다. 그룹 코드를 정해
// 같이 쓰면, 각자 자기 기록을 중계 서버에 남겨두고(retain) 서로 바로 불러온다.
//
// 중계 서버는 누구나 들어올 수 있는 공개 서버다. 그래서 올리는 내용은 그룹
// 코드로 만든 열쇠로 잠근다(AES-GCM). 코드를 모르면 이름도 전적도 읽을 수
// 없고, 남의 그룹에 가짜 기록을 끼워 넣을 수도 없다. 주제 이름에도 코드를
// 그대로 쓰지 않고 짧게 접어 넣는다.
//
// 그러므로 그룹 코드는 사실상 비밀번호다. 아는 사람끼리만 나눠 써야 한다.

// relay.js보다 먼저 읽힐 수 있으므로 쓸 때 계산한다 (top-level const는 TDZ에 걸린다)
function groupRoot() {
  return `${RELAY_ROOT}/g`;
}
const GROUP_FETCH_MS = 4000;
const GROUP_KDF_ROUNDS = 60000;

BOARD.status = 'idle'; // idle | loading | ok | error
BOARD.msg = '';
BOARD.at = 0;
BOARD.players = []; // 그룹에서 불러온 사람들

function boardGroup() {
  return statsProfile().group || '';
}

function boardSetGroup(code) {
  const p = statsProfile();
  p.group = String(code || '').trim().slice(0, 24);
  statsWriteJson(PROFILE_KEY, p);
  return p.group;
}

function boardCryptoOk() {
  return (
    typeof crypto !== 'undefined' &&
    !!crypto.subtle &&
    !!crypto.getRandomValues &&
    typeof TextEncoder !== 'undefined'
  );
}

// 주제 이름에 쓸 짧은 지문. 코드 자체를 드러내지 않기 위한 것이고,
// 어쩌다 겹치더라도 내용을 못 여니 그냥 건너뛰게 된다.
function boardSlug(code) {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

let boardKeyCache = { code: null, key: null };

function boardKey(code) {
  if (boardKeyCache.code === code && boardKeyCache.key) return Promise.resolve(boardKeyCache.key);
  const enc = new TextEncoder();
  return crypto.subtle
    .importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey'])
    .then((base) =>
      crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode('splendor-lite-board'), iterations: GROUP_KDF_ROUNDS, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
    )
    .then((key) => {
      boardKeyCache = { code, key };
      return key;
    });
}

function boardToB64(bytes) {
  let s = '';
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}

function boardFromB64(text) {
  const s = atob(text);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

function boardSeal(code, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return boardKey(code)
    .then((key) => crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))))
    .then((ct) => JSON.stringify({ v: 1, iv: boardToB64(iv), d: boardToB64(ct) }));
}

// 열지 못하면 null. 다른 그룹 것이거나 장난친 것이므로 조용히 버린다.
function boardOpen(code, text) {
  let box;
  try {
    box = JSON.parse(text);
  } catch (e) {
    return Promise.resolve(null);
  }
  if (!box || box.v !== 1 || typeof box.iv !== 'string' || typeof box.d !== 'string') {
    return Promise.resolve(null);
  }
  return boardKey(code)
    .then((key) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: boardFromB64(box.iv) }, key, boardFromB64(box.d)))
    .then((buf) => JSON.parse(new TextDecoder().decode(buf)))
    .catch(() => null);
}

// 브로커 전부에 붙어 한 가지 일을 시킨다. 한 곳이라도 되면 성공이다.
function boardBrokers(job) {
  return new Promise((resolve) => {
    let left = RELAY_URLS.length;
    let ok = false;
    const clients = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clients.forEach((c) => {
        try {
          c.end(true);
        } catch (e) {
          /* noop */
        }
      });
      resolve(ok);
    };
    const timer = setTimeout(finish, RELAY_CONNECT_MS + 2000);
    const one = (good) => {
      ok = ok || good;
      left -= 1;
      if (left <= 0) finish();
    };
    RELAY_URLS.forEach((url) => {
      let client;
      try {
        client = mqtt.connect(url, {
          clientId: 'sl-g-' + relayRandomId(),
          connectTimeout: RELAY_CONNECT_MS,
          reconnectPeriod: 0,
          clean: true,
        });
      } catch (e) {
        one(false);
        return;
      }
      clients.push(client);
      let settled = false;
      const mine = (good) => {
        if (settled) return;
        settled = true;
        one(good);
      };
      client.on('connect', () => job(client, mine));
      client.on('error', () => mine(false));
    });
  });
}

// 내 기록을 그룹 주제에 남겨둔다. retain이라 나중에 켠 사람도 바로 받는다.
function boardGroupPublish() {
  const code = boardGroup();
  if (!code || !relayAvailable() || !boardCryptoOk()) return Promise.resolve(false);
  const topic = `${groupRoot()}/${boardSlug(code)}/${statsProfile().id}`;
  return boardSeal(code, boardMyRecord()).then((body) =>
    boardBrokers((client, done) => {
      try {
        client.publish(topic, body, { qos: 0, retain: true }, () => done(true));
      } catch (e) {
        done(false);
      }
    })
  );
}

// 그룹에서 내 기록을 지운다 (빈 값을 retain으로 덮으면 사라진다).
function boardGroupWithdraw(code) {
  if (!code || !relayAvailable()) return Promise.resolve(false);
  const topic = `${groupRoot()}/${boardSlug(code)}/${statsProfile().id}`;
  return boardBrokers((client, done) => {
    try {
      client.publish(topic, '', { qos: 0, retain: true }, () => done(true));
    } catch (e) {
      done(false);
    }
  });
}

// 그룹에 올라와 있는 기록을 전부 받아 온다.
function boardGroupFetch() {
  const code = boardGroup();
  if (!code) return Promise.resolve({ ok: false, msg: '', players: [] });
  if (!relayAvailable()) {
    return Promise.resolve({ ok: false, msg: '중계 서버를 쓸 수 없습니다. 스크립트가 차단되었을 수 있습니다.', players: [] });
  }
  if (!boardCryptoOk()) {
    return Promise.resolve({ ok: false, msg: '이 브라우저에서는 그룹 랭킹을 쓸 수 없습니다.', players: [] });
  }

  const raw = [];
  let reached = 0;
  return boardBrokers((client, done) => {
    client.subscribe(`${groupRoot()}/${boardSlug(code)}/+`, { qos: 0 }, (err) => {
      if (err) {
        done(false);
        return;
      }
      reached += 1;
      // 보관된 기록이 도착할 시간을 준다
      setTimeout(() => done(true), GROUP_FETCH_MS);
    });
    client.on('message', (topic, payload) => {
      const text = String(payload);
      if (text) raw.push(text);
    });
  }).then(() => {
    if (!reached) {
      return { ok: false, msg: '중계 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', players: [] };
    }
    return Promise.all(raw.map((t) => boardOpen(code, t))).then((list) => {
      const found = Object.create(null);
      list.forEach((obj) => {
        const rec = boardSanitize(obj);
        if (!rec) return;
        const prev = found[rec.id];
        if (!prev || rec.at >= prev.at) found[rec.id] = rec;
      });
      return { ok: true, msg: '', players: Object.keys(found).map((k) => found[k]) };
    });
  });
}

// 화면의 "새로고침". 내 것을 올리고 나서 전부 받아 온다.
function boardRefresh() {
  if (BOARD.status === 'loading') return Promise.resolve();
  if (!boardGroup()) {
    BOARD.status = 'idle';
    BOARD.players = [];
    renderStatsPanel();
    return Promise.resolve();
  }
  BOARD.status = 'loading';
  BOARD.msg = '';
  renderStatsPanel();
  return boardGroupPublish()
    .then(() => boardGroupFetch())
    .then((res) => {
      BOARD.status = res.ok ? 'ok' : 'error';
      BOARD.msg = res.msg;
      BOARD.players = res.players;
      BOARD.at = Date.now();
      renderStatsPanel();
    });
}
