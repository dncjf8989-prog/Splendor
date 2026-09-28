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

// 판이 끝나 내 기록이 바뀌면 알린다. 같은 방 사람들에게 한 번, 전체 랭킹에 한 번.
function boardShareResult() {
  if (typeof netShareRecord === 'function') netShareRecord();
  boardPublish();
}

// ============ 전체 랭킹 ============
// 모두가 같은 곳에 자기 기록을 남겨두고(retain) 서로 불러온다. 방에서 만난 적이
// 없어도, 접속해 있지 않아도 보인다.
//
// 이것은 말 그대로 공개 게시판이다. 중계 서버는 누구나 들어올 수 있으므로
//   - 올린 닉네임과 전적은 누구나 볼 수 있고
//   - 마음만 먹으면 아무나 가짜 기록을 올릴 수 있다
// 막을 방법이 없으니, 대신 말이 안 되는 값은 걸러내고(boardSanitize) 너무 오래된
// 기록과 지나치게 많은 양은 잘라낸다. 아는 사람끼리 재미로 보는 순위표다.

const BOARD_FETCH_MS = 4000; // 보관된 기록을 모으는 시간
const BOARD_STALE_DAYS = 90; // 이보다 오래된 기록은 숨긴다
const BOARD_FETCH_MAX = 500; // 한 번에 받아들일 기록 수 상한

BOARD.status = 'idle'; // idle | loading | ok | error
BOARD.msg = '';
BOARD.at = 0;
BOARD.players = []; // 전체 랭킹에서 불러온 사람들

// 중계 계층이 실제로 올라와 있는지. relay.js가 차단되면 이름 자체가 없으므로
// typeof로 확인한다. (그냥 부르면 ReferenceError가 난다)
function boardRelayReady() {
  return (
    typeof RELAY_ROOT === 'string' &&
    typeof RELAY_URLS !== 'undefined' &&
    typeof relayAvailable === 'function' &&
    relayAvailable()
  );
}

function boardRoot() {
  return `${RELAY_ROOT}/all`;
}

function boardMyTopic() {
  return `${boardRoot()}/${statsProfile().id}`;
}

// 올리지 않을 수도 있다. 기본은 올리기.
function boardShareEnabled() {
  return statsProfile().share !== false;
}

function boardSetShare(on) {
  const p = statsProfile();
  p.share = !!on;
  statsWriteJson(PROFILE_KEY, p);
  return p.share;
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
    const timer = setTimeout(finish, RELAY_CONNECT_MS + BOARD_FETCH_MS + 2000);
    const one = (good) => {
      ok = ok || good;
      left -= 1;
      if (left <= 0) finish();
    };
    RELAY_URLS.forEach((url) => {
      let client;
      try {
        client = mqtt.connect(url, {
          clientId: 'sl-b-' + relayRandomId(),
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

// 내 기록을 남겨둔다. retain이라 나중에 들어온 사람도 바로 받는다.
function boardPublish() {
  if (!boardRelayReady() || !boardShareEnabled()) return Promise.resolve(false);
  const body = JSON.stringify(boardMyRecord());
  const topic = boardMyTopic();
  return boardBrokers((client, done) => {
    try {
      client.publish(topic, body, { qos: 0, retain: true }, () => done(true));
    } catch (e) {
      done(false);
    }
  });
}

// 랭킹에서 내 기록을 내린다 (빈 값을 retain으로 덮으면 사라진다).
function boardWithdraw() {
  if (!boardRelayReady()) return Promise.resolve(false);
  const topic = boardMyTopic();
  return boardBrokers((client, done) => {
    try {
      client.publish(topic, '', { qos: 0, retain: true }, () => done(true));
    } catch (e) {
      done(false);
    }
  });
}

// 올라와 있는 기록을 전부 받아 온다.
function boardFetch() {
  if (!boardRelayReady()) {
    return Promise.resolve({
      ok: false,
      msg: '중계 서버를 쓸 수 없습니다. 스크립트가 차단되었을 수 있습니다.',
      players: [],
    });
  }
  const found = Object.create(null);
  let seen = 0;
  let reached = 0;

  return boardBrokers((client, done) => {
    client.subscribe(`${boardRoot()}/+`, { qos: 0 }, (err) => {
      if (err) {
        done(false);
        return;
      }
      reached += 1;
      setTimeout(() => done(true), BOARD_FETCH_MS); // 보관된 기록이 도착할 시간
    });
    client.on('message', (topic, payload) => {
      if (seen >= BOARD_FETCH_MAX) return;
      const text = String(payload);
      if (!text) return; // 올리기를 끈 사람은 빈 값으로 지워져 있다
      seen += 1;
      let rec;
      try {
        rec = boardSanitize(JSON.parse(text));
      } catch (e) {
        return;
      }
      if (!rec) return;
      const prev = found[rec.id];
      if (!prev || rec.at >= prev.at) found[rec.id] = rec; // 더 최신 것만
    });
  }).then(() => {
    if (!reached) {
      return { ok: false, msg: '중계 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', players: [] };
    }
    const cutoff = Date.now() - BOARD_STALE_DAYS * 86400000;
    const players = Object.keys(found)
      .map((k) => found[k])
      .filter((r) => r.at >= cutoff);
    return { ok: true, msg: '', players };
  });
}

// 화면의 "새로고침". 내 것을 올리고 나서 전부 받아 온다.
function boardRefresh() {
  if (BOARD.status === 'loading') return Promise.resolve();
  BOARD.status = 'loading';
  BOARD.msg = '';
  renderStatsPanel();
  return boardPublish()
    .then(() => boardFetch())
    .then((res) => {
      BOARD.status = res.ok ? 'ok' : 'error';
      BOARD.msg = res.msg;
      BOARD.players = res.players;
      BOARD.at = Date.now();
      renderStatsPanel();
    });
}
