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
// 랭킹에 쓸 명단. 전부 같은 판 기록에서 나온 값이다. 내 줄도 마찬가지라
// 내 화면과 남의 화면에 서로 다른 숫자가 뜰 수 없다.
function boardAll() {
  return BOARD.players || [];
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

// ============ 전체 랭킹 ============
// 판 기록 보관소(db.js)에서 판들을 읽어 전적을 센다. 각자 신고한 숫자를 모으는
// 것이 아니라, 모두가 같은 판 기록을 같은 방법으로 세므로 화면마다 값이 다를 수
// 없다. 대전한 적 없는 사람도, 접속해 있지 않은 사람도 그대로 나온다.

BOARD.status = 'idle'; // idle | loading | ok | error
BOARD.msg = '';
BOARD.at = 0;
BOARD.players = []; // 판 기록에서 센 사람들

// 판이 끝나면 그 판을 남긴다. 참가자 전원이 같은 자리에 같은 내용을 올린다.
function boardSaveGame(rec) {
  if (!rec || typeof dbSaveGame !== 'function') return Promise.resolve(false);
  return dbSaveGame(rec);
}

// 전적 창뿐 아니라 자리별 전적도 이 값을 쓰므로, 받아오면 판도 다시 그린다.
function boardRerender() {
  if (typeof renderStatsPanel === 'function') renderStatsPanel();
  if (typeof render === 'function' && typeof G !== 'undefined' && G) render();
}

// 대전이 시작될 때처럼 "지금 값이 필요한" 순간에 부른다. 이미 받는 중이면
// 겹쳐 부르지 않는다. maxAgeMs를 주면 그만큼 된 값은 그대로 쓴다.
function boardEnsureFresh(maxAgeMs) {
  if (BOARD.status === 'loading') return;
  const age = Number.isFinite(maxAgeMs) ? maxAgeMs : 0;
  if (BOARD.status === 'ok' && age > 0 && Date.now() - BOARD.at < age) return;
  boardRefresh();
}

function boardRefresh() {
  if (BOARD.status === 'loading') return Promise.resolve();
  if (typeof dbLoadGames !== 'function' || !dbAvailable()) {
    BOARD.status = 'error';
    BOARD.msg = '이 브라우저에서는 랭킹을 불러올 수 없습니다.';
    boardRerender();
    return Promise.resolve();
  }
  BOARD.status = 'loading';
  BOARD.msg = '';
  if (typeof renderStatsPanel === 'function') renderStatsPanel();
  return dbLoadGames()
    .then((games) => {
      BOARD.players = dbTally(games);
      BOARD.games = games.length;
      BOARD.status = 'ok';
      BOARD.at = Date.now();
      boardRerender();
    })
    .catch(() => {
      BOARD.status = 'error';
      BOARD.msg = '랭킹 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
      boardRerender();
    });
}
