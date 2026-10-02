'use strict';

// ============ 판 기록 보관소 (Firebase Realtime Database) ============
// 전에는 각자가 "내 총 전적은 5승"이라고 신고하는 방식이었다. 그래서
//   - 상대가 앱을 열어야만 순위표에 떴고
//   - 3인 판은 참가자가 안 남아 숫자가 어긋났고
//   - 사람마다 다른 숫자를 들고 있어도 맞출 방법이 없었다.
//
// 이제는 판이 끝나면 "누가 같이 두어 누가 이겼는지" 그 판 자체를 한 줄 남긴다.
// 전적은 그 줄들을 세어서 계산한다. 같은 기록을 모두가 같은 방법으로 세므로
// 화면마다 숫자가 다를 수 없다.
//
// SDK를 쓰지 않고 평범한 HTTPS 요청(fetch)만 쓴다. 회사망에서 막힐 확률이
// 가장 낮은 방식이다.

const DB_URL = 'https://hoplendor-c9054-default-rtdb.asia-southeast1.firebasedatabase.app';
const DB_RECENT = 2000; // 랭킹에 쓸 최근 판 수
const DB_TIMEOUT_MS = 9000;

function dbAvailable() {
  return typeof fetch === 'function' && !!DB_URL;
}

// 응답이 없을 때 영원히 기다리지 않도록 시간 제한을 건다.
function dbRequest(path, options) {
  if (!dbAvailable()) return Promise.reject(new Error('no-db'));
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), DB_TIMEOUT_MS);
  const opts = Object.assign({}, options, ctrl ? { signal: ctrl.signal } : {});
  return fetch(DB_URL + path, opts)
    .then((res) => {
      clearTimeout(timer);
      if (!res.ok) throw new Error('http-' + res.status);
      return res.json();
    })
    .catch((e) => {
      clearTimeout(timer);
      throw e;
    });
}

// ---- 한 판을 적는다 ----
// 같은 판을 참가자 전원이 각각 올린다. 판 번호(gameId)가 모두 같으므로
// 같은 자리에 같은 내용이 쓰인다. 한 명이 나가버려도 남은 사람이 올린다.
function dbGameRecord() {
  if (!G || !G.gameId) return null;
  if (!window.NET || NET.mode !== 'online') return null;
  // 관전자는 참가자가 아니다. 판 기록은 둔 사람들이 올린다.
  if (typeof netIsSpectator === 'function' && netIsSpectator()) return null;

  const count = G.playerCount || G.players.length;
  const seats = [];
  // 내 자리
  if (NET.seat != null) seats.push({ seat: NET.seat, id: statsProfile().id, name: statsMyDisplayName() });
  // 상대 자리
  (NET.opponents || []).forEach((o) => {
    if (o && o.id && o.seat != null) seats.push({ seat: o.seat, id: o.id, name: o.name || '상대' });
  });
  if (seats.length !== count) return null; // 자리를 다 모르면 적지 않는다

  const p = seats
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({ id: s.id, name: String(s.name).slice(0, 12), r: statsResultOf(s.seat) }));
  // 도중에 나간 사람도 그 판의 참가자다. statsResultOf가 이미 'l'로 돌려준다.
  if (p.some((x) => !x.r)) return null;

  return { at: Date.now(), n: count, p };
}

// 중도에 끝난 판. 나간 사람은 패, 남은 사람은 승으로 적는다.
function dbGameRecordAbandoned(leaverId) {
  if (!G || !G.gameId || !window.NET || NET.mode !== 'online') return null;
  if (typeof netIsSpectator === 'function' && netIsSpectator()) return null;
  const count = G.playerCount || G.players.length;
  const seats = [];
  if (NET.seat != null) seats.push({ id: statsProfile().id, name: statsMyDisplayName(), seat: NET.seat });
  (NET.opponents || []).forEach((o) => {
    if (o && o.id && o.seat != null) seats.push({ id: o.id, name: o.name || '상대', seat: o.seat });
  });
  if (seats.length !== count) return null;
  return {
    at: Date.now(),
    n: count,
    p: seats
      .sort((a, b) => a.seat - b.seat)
      // 이번에 나간 사람뿐 아니라, 앞서 이미 나간 사람도 패다.
      .map((s) => {
        const seat = G.players[s.seat];
        const out = s.id === leaverId || (seat && seat.left);
        return { id: s.id, name: String(s.name).slice(0, 12), r: out ? 'l' : 'w' };
      }),
  };
}

// 이미 있는 판은 덮어쓰지 않는다 (보안 규칙에서도 막아둔다).
function dbSaveGame(rec) {
  if (!rec || !G || !G.gameId) return Promise.resolve(false);
  const id = String(G.gameId).replace(/[.#$/[\]]/g, '-');
  return dbRequest('/games/' + id + '.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rec),
  })
    .then(() => true)
    .catch(() => false);
}

// ---- 판들을 읽어 전적을 센다 ----
function dbLoadGames() {
  return dbRequest('/games.json?orderBy=%22%24key%22&limitToLast=' + DB_RECENT).then((data) => {
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data)
      .map((k) => data[k])
      .filter(dbValidGame);
  });
}

function dbValidGame(g) {
  if (!g || typeof g !== 'object') return false;
  if (!Array.isArray(g.p) || g.p.length < 2 || g.p.length > 4) return false;
  if (g.n !== g.p.length) return false;
  const ids = {};
  return g.p.every((x) => {
    if (!x || typeof x.id !== 'string' || !x.id) return false;
    if (ids[x.id]) return false; // 같은 사람이 두 자리에 앉을 수 없다
    ids[x.id] = true;
    return x.r === 'w' || x.r === 'l' || x.r === 'd';
  });
}

// 판 목록 -> 사람별 전적. 랭킹 화면이 쓰는 모양 그대로 만든다.
function dbTally(games) {
  const by = Object.create(null);
  (games || []).forEach((g) => {
    if (!dbValidGame(g)) return;
    const n = String(g.n);
    if (n !== '2' && n !== '3' && n !== '4') return;
    g.p.forEach((x) => {
      let rec = by[x.id];
      if (!rec) {
        rec = { id: x.id, name: '이름 없음', at: 0, online: boardCounts(null) };
        by[x.id] = rec;
      }
      rec.online[n][x.r] += 1;
      // 이름은 가장 최근 판의 것을 쓴다 (닉네임을 바꿨을 수 있다)
      if (g.at >= rec.at) {
        rec.at = g.at;
        if (typeof x.name === 'string' && x.name.trim()) rec.name = x.name.trim().slice(0, 12);
      }
    });
  });
  return Object.keys(by).map((k) => by[k]);
}
