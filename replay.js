'use strict';

// ============ 판 한 수씩 기록과 복기 (스플렌더 오리지널) ============
// 판이 끝나면(또는 중간에 끝나면) 그 판이 어떻게 흘러갔는지를 한 수(한 턴)씩 남긴다.
// 전적(/games)은 "누가 이겼나"만 남기지만, 이 기록은 "어디서 앞서고 어디서 뒤집혔나"를 볼 수 있게 한다.
//
// 오리지널은 규칙 엔진이 따로 없고 각자 자기 화면에서 한 수를 두고 판 전체를 보낸다. 그래서 행동을
// 다시 두는 방식이 아니라, 턴이 끝날 때마다 "그때 모두가 볼 수 있던 판의 모습"을 변화분만 적는다.
//   - 내가 한 수:  game.js 의 notifyNet() 에서
//   - 남이 둔 수:  net.js 의 netApplyRemoteState() 에서
// 둘 다 replayCapture() 를 부른다. 같은 모습이 또 오면(재전송 등) 건너뛴다.
// 상대의 예약 카드는 내용을 모른다(장수만 안다). 내 예약 카드는 내가 올린 기록에만 들어 있다.
//
// 저장: 이 기기(localStorage) 와 서버(/replays/판번호). 서버는 보안 규칙에 replays 가 열려 있어야 올라간다
// (README 참고). 안 열려 있어도 게임과 이 기기의 기록은 그대로 돌아간다.

const RP_GEMS = ['white', 'blue', 'green', 'red', 'black'];
const RP_TOKENS = ['gold'].concat(RP_GEMS); // 토큰은 이 순서의 숫자 6개로 적는다
const RP_CODE = { white: 'w', blue: 'u', green: 'g', red: 'r', black: 'k' };
const RP_FROM = { w: 'white', u: 'blue', g: 'green', r: 'red', k: 'black' };
const RP_LOCAL_KEY = 'splendorReplays';
const RP_LOCAL_MAX = 20; // 이 기기에 남겨 두는 판 수
const RP_MAX_BYTES = 120 * 1024; // 한 판 기록의 상한 (넘으면 올리지 않는다)
const RP_MAX_FRAMES = 600;

// ---------------------------------------------------------------------------
// 카드를 짧은 글자로: 흰 1점 카드가 초록 4를 요구하면 "w1:g4"
function rpCardCode(c) {
  if (!c) return '';
  if (c.h || !c.cost || !RP_CODE[c.gem]) return '?'; // 남의 예약(내용을 모른다)이나 모양이 깨진 값
  const cost = RP_GEMS.filter((g) => c.cost[g] > 0).map((g) => RP_CODE[g] + c.cost[g]).join('');
  return RP_CODE[c.gem] + (c.points || 0) + ':' + cost;
}

function rpCardOf(code) {
  const m = /^([wugrk])(\d{1,2}):((?:[wugrk]\d{1,2})*)$/.exec(String(code || ''));
  if (!m) return null;
  const cost = {};
  const re = /([wugrk])(\d{1,2})/g;
  let x;
  while ((x = re.exec(m[3]))) cost[RP_FROM[x[1]]] = Number(x[2]);
  return { gem: RP_FROM[m[1]], points: Number(m[2]), cost };
}

// ---------------------------------------------------------------------------
// 판의 한 순간(frame). g = 판 상태(G). x = 이 순간까지 새로 남은 진행 기록 문장들(오래된 것부터)
function rpFrameOf(g) {
  return {
    i: g.currentIndex,
    o: g.gameOver ? 1 : 0,
    b: RP_TOKENS.map((k) => (g.bank && g.bank[k]) || 0),
    t: g.tiers.map((t) => ({ f: t.faceUp.map(rpCardCode), d: t.deck.length })),
    nb: g.nobles.map((n) => (n ? n.id : '')),
    p: g.players.map((p) => ({
      t: RP_TOKENS.map((k) => (p.tokens && p.tokens[k]) || 0),
      c: (p.cards || []).map(rpCardCode),
      r: (p.reserved || []).map(rpCardCode),
      n: (p.nobles || []).map((n) => (n ? n.id : '')),
      s: p.points || 0,
      l: p.left ? 1 : 0,
    })),
    x: [],
  };
}

const rpJ = (v) => JSON.stringify(v);
const rpPrefix = (a, b) => b.length >= a.length && a.every((v, k) => v === b[k]); // a 가 b 의 앞부분인가

// prev -> cur 의 변화분. 카드와 귀족은 늘기만 하므로 늘어난 것만 적는다 (한 판이 작아진다).
function rpDiff(prev, cur) {
  const d = { i: cur.i, b: cur.b };
  if (cur.o) d.o = 1;
  const tf = {};
  cur.t.forEach((t, k) => {
    if (rpJ(t) !== rpJ(prev.t[k])) tf[k] = t;
  });
  if (Object.keys(tf).length) d.t = tf;
  if (rpJ(cur.nb) !== rpJ(prev.nb)) d.nb = cur.nb;
  d.p = cur.p.map((p, k) => {
    const q = prev.p[k];
    const e = { t: p.t, s: p.s };
    if (p.l) e.l = 1;
    if (rpPrefix(q.c, p.c)) {
      if (p.c.length > q.c.length) e.ca = p.c.slice(q.c.length);
    } else e.c = p.c;
    if (rpJ(p.r) !== rpJ(q.r)) e.r = p.r;
    if (rpPrefix(q.n, p.n)) {
      if (p.n.length > q.n.length) e.na = p.n.slice(q.n.length);
    } else e.n = p.n;
    return e;
  });
  if (cur.x && cur.x.length) d.x = cur.x;
  return d;
}

// rpDiff 의 반대. 기록(변화분)에서 그 순간의 전체 모습을 되살린다.
function rpApply(prev, d) {
  const cur = {
    i: d.i,
    o: d.o ? 1 : 0,
    b: d.b,
    t: prev.t.map((t, k) => (d.t && d.t[k] ? d.t[k] : t)),
    nb: d.nb || prev.nb,
    p: prev.p.map((q, k) => {
      const e = (d.p && d.p[k]) || {};
      return {
        t: e.t || q.t,
        c: e.c ? e.c : e.ca ? q.c.concat(e.ca) : q.c,
        r: e.r || q.r,
        n: e.n ? e.n : e.na ? q.n.concat(e.na) : q.n,
        s: e.s != null ? e.s : q.s,
        l: e.l ? 1 : 0,
      };
    }),
    x: d.x || [],
  };
  return cur;
}

// 같은 판 기록(f0 + d[])에서 모든 순간을 전체 모습으로 되살린다.
function rpExpand(rec) {
  const frames = [rec.f0];
  for (const d of rec.d) frames.push(rpApply(frames[frames.length - 1], d));
  return frames;
}

// ---------------------------------------------------------------------------
// 기록하는 쪽
const RP = {
  rec: null, // 지금 기록 중인 판 { id, at, n, wp, f, d: [변화분들] }
  full: [], // 지금까지의 전체 모습들
  lastN: null, // 진행 기록 줄 수(G.logN)와
  lastTop: null, // 맨 위 줄 (logN 이 없는 옛 상대와 맞출 때)
  savedFor: null, // 저장을 마친 판 번호
};
window.RP = RP;

function rpStart(g) {
  RP.rec = { id: g.gameId, at: Date.now(), n: g.players.length, wp: g.winPoints || 15, f: g.startIndex || 0, d: [] };
  RP.full = [];
  RP.lastN = null;
  RP.lastTop = null;
}

// 마지막으로 본 뒤에 새로 남은 진행 기록 문장들 (오래된 것부터). 상태를 바꾸지 않는다.
function rpNewLines(g) {
  const logs = Array.isArray(g.logs) ? g.logs : [];
  if (RP.lastN == null && RP.lastTop == null) return logs.slice().reverse();
  if (Number.isInteger(g.logN) && Number.isInteger(RP.lastN)) {
    const k = Math.max(0, Math.min(logs.length, g.logN - RP.lastN));
    return logs.slice(0, k).reverse();
  }
  const at = logs.indexOf(RP.lastTop);
  return (at < 0 ? logs.slice(0, 3) : logs.slice(0, at)).reverse();
}

// 지금 판의 모습을 한 순간으로 남긴다. 변한 게 없으면 건너뛴다. 기록 때문에 게임이 멈추면 안 되므로 오류는 삼킨다.
function replayCapture() {
  try {
    if (typeof G === 'undefined' || !G || !G.gameId || !Array.isArray(G.players) || !G.tiers) return;
    if (typeof netIsSpectator === 'function' && netIsSpectator()) return; // 관전자는 기록하지 않는다
    if (!RP.rec || RP.rec.id !== G.gameId) rpStart(G);
    if (RP.full.length >= RP_MAX_FRAMES) return;
    const cur = rpFrameOf(G);
    cur.x = rpNewLines(G);
    const prev = RP.full[RP.full.length - 1];
    if (prev) {
      if (cur.p.length !== prev.p.length) return;
      const same = rpJ(Object.assign({}, prev, { x: [] })) === rpJ(Object.assign({}, cur, { x: [] }));
      if (same && !cur.x.length) return;
      if (same && RP.full.length === 1) {
        // 한 수도 두기 전에 문장만 더 붙었다 (방장은 판을 만든 뒤에 "선공은 ..."을 남긴다). 시작 모습에 합친다.
        prev.x = prev.x.concat(cur.x);
        RP.lastN = Number.isInteger(G.logN) ? G.logN : null;
        RP.lastTop = G.logs && G.logs.length ? G.logs[0] : null;
        return;
      }
    }
    RP.lastN = Number.isInteger(G.logN) ? G.logN : null;
    RP.lastTop = G.logs && G.logs.length ? G.logs[0] : null;
    if (prev) RP.rec.d.push(rpDiff(prev, cur));
    RP.full.push(cur);
  } catch (e) {
    /* 기록은 덤이다. 게임을 멈추지 않는다. */
  }
}

// render() 끝에서 부른다. 판이 끝난 것을 처음 보면 마지막 모습을 남기고 저장한다.
function replayOnRender() {
  try {
    if (typeof G === 'undefined' || !G || !G.gameOver || !G.gameId) return;
    if (RP.savedFor === G.gameId) return;
    replayCapture();
    replayFinish({ ab: 0 });
  } catch (e) {
    /* noop */
  }
}

// 자리별 이름과 기기 ID (온라인에서만 안다)
function rpSeats() {
  const out = G.players.map((p) => ({ name: String(p.name || '').slice(0, 12), id: null }));
  if (window.NET && NET.mode === 'online') {
    if (NET.seat != null && out[NET.seat] && typeof statsProfile === 'function') out[NET.seat].id = statsProfile().id;
    (NET.opponents || []).forEach((o) => {
      if (o && o.id && o.seat != null && out[o.seat]) out[o.seat].id = o.id;
    });
  }
  return out;
}

// 자리별 결과: 끝까지 둔 판은 전적과 같은 계산, 중간에 끝난 판은 나간 사람이 패
function rpResults(opts) {
  return G.players.map((p, i) => {
    if (opts && opts.ab) {
      const seat = rpSeats()[i];
      const out = p.left || (opts.leaverId && seat.id === opts.leaverId);
      return out ? 'l' : 'w';
    }
    if (typeof statsResultOf === 'function') {
      const r = statsResultOf(i);
      if (r === 'w' || r === 'l' || r === 'd') return r;
    }
    return null;
  });
}

// 저장할 기록을 만든다. ab=1 이면 중간에 끝난 판.
function rpBuildRecord(opts) {
  const seats = rpSeats();
  const online = !!(window.NET && NET.mode === 'online');
  return {
    ver: 1,
    k: 'orig',
    id: RP.rec.id,
    at: RP.rec.at,
    end: Date.now(),
    n: RP.rec.n,
    wp: RP.rec.wp,
    f: RP.rec.f,
    ab: opts && opts.ab ? 1 : 0,
    on: online ? 1 : 0,
    by: online && NET.seat != null ? { seat: NET.seat, id: seats[NET.seat] ? seats[NET.seat].id : null } : null,
    p: seats,
    r: rpResults(opts),
    w: G.winnerText ? String(G.winnerText).slice(0, 80) : '',
    f0: RP.full[0],
    d: RP.rec.d,
  };
}

// 판이 끝났을 때(또는 중간에 끝났을 때) 저장한다.
function replayFinish(opts) {
  try {
    if (typeof G === 'undefined' || !G || !RP.rec || RP.rec.id !== G.gameId || !RP.full.length) return null;
    if (typeof netIsSpectator === 'function' && netIsSpectator()) return null;
    if (RP.savedFor === G.gameId) return null;
    RP.savedFor = G.gameId;
    const rec = rpBuildRecord(opts);
    rpLocalAdd(rec);
    // 서버에는 온라인 판만 올린다 (혼자 연습한 판은 이 기기에만 남긴다)
    if (rec.on) rpSaveDb(rec);
    if (typeof replayRefreshButton === 'function') replayRefreshButton();
    return rec;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 저장: 이 기기
function rpValid(rec) {
  if (!rec || typeof rec !== 'object' || rec.ver !== 1 || rec.k !== 'orig') return false;
  if (typeof rec.id !== 'string' || !rec.id || rec.id.length > 80) return false;
  const f = rec.f0;
  if (!f || !Array.isArray(f.p) || f.p.length < 2 || f.p.length > 4) return false;
  if (!Array.isArray(f.b) || f.b.length !== 6 || !Array.isArray(f.t) || f.t.length !== 3 || !Array.isArray(f.nb)) return false;
  if (!f.p.every((p) => p && Array.isArray(p.t) && p.t.length === 6 && Array.isArray(p.c) && Array.isArray(p.r) && Array.isArray(p.n))) return false;
  if (!Array.isArray(rec.d) || rec.d.length > RP_MAX_FRAMES) return false;
  if (!Array.isArray(rec.p) || rec.p.length !== f.p.length) return false;
  return rec.d.every((d) => d && typeof d === 'object' && Array.isArray(d.b) && d.b.length === 6 && Array.isArray(d.p) && d.p.length === f.p.length);
}

function rpLocalList() {
  try {
    const a = JSON.parse(localStorage.getItem(RP_LOCAL_KEY) || '[]');
    return Array.isArray(a) ? a.filter(rpValid) : [];
  } catch (e) {
    return [];
  }
}

function rpLocalWrite(list) {
  try {
    localStorage.setItem(RP_LOCAL_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

function rpLocalAdd(rec) {
  if (rpJ(rec).length > RP_MAX_BYTES) return false;
  const list = rpLocalList().filter((x) => x.id !== rec.id);
  list.unshift(rec);
  list.length = Math.min(list.length, RP_LOCAL_MAX);
  // 저장 공간이 모자라면 오래된 판부터 줄여 가며 다시 시도한다
  while (!rpLocalWrite(list) && list.length > 1) list.pop();
  return true;
}

// ---------------------------------------------------------------------------
// 저장: 서버. 보안 규칙에 replays 가 열려 있지 않으면 거절된다. 그래도 게임에는 아무 일도 없다.
function rpSaveDb(rec) {
  if (typeof dbRequest !== 'function' || typeof dbAvailable !== 'function' || !dbAvailable()) return Promise.resolve(false);
  const body = rpJ(rec);
  if (body.length > RP_MAX_BYTES) return Promise.resolve(false);
  const id = String(rec.id).replace(/[.#$/[\]]/g, '-');
  return dbRequest('/replays/' + id + '.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
    .then(() => true)
    .catch(() => false);
}

function rpLoadDb(id) {
  const key = String(id || '').trim().replace(/[.#$/[\]]/g, '-');
  if (!key) return Promise.reject(new Error('empty'));
  return dbRequest('/replays/' + key + '.json').then((rec) => {
    if (!rpValid(rec)) throw new Error('not-found');
    return rec;
  });
}

// ---------------------------------------------------------------------------
// 보여 주기 (복기 화면)
const RPV = { mode: 'list', rec: null, frames: [], idx: 0, seat: 0, timer: null, msg: '' };

function rpDate(ms) {
  const d = new Date(Number(ms) || 0);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

// 이 기록에서 "나"의 자리: 내가 올린 기록이면 그 자리, 아니면 내 기기 ID 와 맞는 자리, 그도 아니면 0
function rpMySeat(rec) {
  try {
    const myId = typeof statsProfile === 'function' ? statsProfile().id : null;
    if (myId) {
      const k = rec.p.findIndex((x) => x && x.id === myId);
      if (k >= 0) return k;
    }
  } catch (e) {
    /* noop */
  }
  return rec.by && Number.isInteger(rec.by.seat) && rec.by.seat < rec.p.length ? rec.by.seat : 0;
}

function rpResultLabel(r) {
  return r === 'w' ? '승' : r === 'l' ? '패' : r === 'd' ? '무' : '';
}

function rpTitle(rec) {
  return rec.p.map((x, i) => `${escapeHtml(x.name || '플레이어 ' + (i + 1))}${rpResultLabel(rec.r && rec.r[i]) ? ` (${rpResultLabel(rec.r[i])})` : ''}`).join(' 대 ');
}

// 한 수가 어떤 종류인지 (앞 모습과 뒤 모습의 차이로 안다)
function rpMoveKind(prev, cur, seat) {
  const a = prev.p[seat];
  const b = cur.p[seat];
  if (!a || !b) return '기타';
  if (b.c.length > a.c.length) return '구매';
  if (b.r.length > a.r.length) return '예약';
  if (rpJ(b.t) !== rpJ(a.t)) return '토큰';
  return '기타';
}

function rpBonusCounts(p) {
  const n = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  p.c.forEach((code) => {
    const c = rpCardOf(code);
    if (c) n[c.gem] += 1;
  });
  return n;
}

function rpTokensHtml(t) {
  return RP_TOKENS.map((k, j) => (t[j] > 0 ? gemDot(k, t[j]) : '')).join('') || '<em>없음</em>';
}

function rpCardHtml(code) {
  const c = rpCardOf(code);
  if (!c) return '<div class="card-tile card-back" title="내용을 모르는 카드"></div>';
  return renderCardTile(c, {});
}

function rpNobleHtml(id) {
  const n = (typeof NOBLES !== 'undefined' ? NOBLES : []).find((x) => x.id === id);
  if (!n) return '<div class="noble-tile empty"></div>';
  return `<div class="noble-tile"><div class="noble-points">${n.points}</div><div class="noble-req">${renderCostIcons(n.requires)}</div></div>`;
}

function rpPlayerHtml(rec, f, k, mySeat) {
  const p = f.p[k];
  const name = (rec.p[k] && rec.p[k].name) || '플레이어 ' + (k + 1);
  const bonus = rpBonusCounts(p);
  const held = p.t.reduce((a, b) => a + b, 0);
  const cur = !f.o && f.i === k;
  const res = rec.r && rec.r[k] ? ` <span class="rp-res rp-res-${rec.r[k]}">${rpResultLabel(rec.r[k])}</span>` : '';
  const bonusHtml = RP_GEMS.map((g) => (bonus[g] > 0 ? gemDot(g, bonus[g]) : '')).join('') || '<em>없음</em>';
  const reserved = p.r.map((code) => rpCardHtml(code)).join('');
  return `<div class="player-panel${cur ? ' active' : ''}">
    <h3>${escapeHtml(name)}${k === mySeat ? ' <span class="you-tag">나</span>' : ''}${res}${cur ? '<span class="turn-tag">현재 턴</span>' : ''}</h3>
    <div class="player-points">점수: ${p.s}점 · 카드 ${p.c.length}장 ${p.n.map(() => '<span class="noble-mini">★</span>').join('')}</div>
    <div class="player-row"><span class="row-label">보유 토큰 <span class="token-count">(${held}/10)</span></span><span class="row-items">${rpTokensHtml(p.t)}</span></div>
    <div class="player-row"><span class="row-label">카드 보너스</span><span class="row-items">${bonusHtml}</span></div>
    <div class="player-row"><span class="row-label">예약 카드 (${p.r.length}/3)</span></div>
    <div class="reserved-cards">${reserved}</div>
  </div>`;
}

// 점수 그래프: 가로는 몇 번째 수, 세로는 점수. 눌러서 그 수로 간다.
function rpChartHtml(rec, frames) {
  const W = 600;
  const H = 120;
  const maxPts = Math.max(rec.wp || 15, ...frames.map((f) => Math.max(...f.p.map((p) => p.s))));
  const x = (k) => (frames.length <= 1 ? 0 : (k / (frames.length - 1)) * W);
  const y = (v) => H - (v / maxPts) * (H - 8) - 4;
  const colors = ['var(--accent)', '#4a7fb0', '#6a9a5a', '#b0604a'];
  const lines = rec.p
    .map((_, s) => `<polyline fill="none" stroke="${colors[s % 4]}" stroke-width="2" points="${frames.map((f, k) => `${x(k).toFixed(1)},${y(f.p[s].s).toFixed(1)}`).join(' ')}"/>`)
    .join('');
  const goal = `<line x1="0" x2="${W}" y1="${y(rec.wp || 15).toFixed(1)}" y2="${y(rec.wp || 15).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="4 4" stroke-width="1"/>`;
  const now = `<line x1="${x(RPV.idx).toFixed(1)}" x2="${x(RPV.idx).toFixed(1)}" y1="0" y2="${H}" stroke="var(--text)" stroke-width="1.5"/>`;
  const legend = rec.p.map((q, s) => `<span class="rp-leg"><i style="background:${colors[s % 4]}"></i>${escapeHtml(q.name || '')}</span>`).join('');
  return `<div class="rp-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-rp-chart="1" role="img" aria-label="점수 변화">${goal}${lines}${now}</svg><div class="rp-legend">${legend}<span class="rp-leg rp-goal">점선 = 목표 ${rec.wp || 15}점</span></div></div>`;
}

// 행동 요약: 구매/토큰/예약 횟수, 5점·10점·목표에 처음 닿은 수
function rpSummaryHtml(rec, frames) {
  const rows = rec.p.map((q, s) => {
    const c = { 구매: 0, 토큰: 0, 예약: 0 };
    let turns = 0;
    for (let k = 1; k < frames.length; k++) {
      if (frames[k - 1].i !== s) continue;
      turns += 1;
      const kind = rpMoveKind(frames[k - 1], frames[k], s);
      if (c[kind] != null) c[kind] += 1;
    }
    const reach = (pts) => {
      const k = frames.findIndex((f) => f.p[s].s >= pts);
      return k < 0 ? '-' : k + '번째 수';
    };
    const last = frames[frames.length - 1].p[s];
    return `<tr><td>${escapeHtml(q.name || '')}</td><td>${turns}</td><td>${c.구매}</td><td>${c.토큰}</td><td>${c.예약}</td><td>${reach(5)}</td><td>${reach(10)}</td><td>${reach(rec.wp || 15)}</td><td>${last.s}점 · ${last.c.length}장</td></tr>`;
  });
  return `<table class="rp-sum"><thead><tr><th>플레이어</th><th>턴</th><th>구매</th><th>토큰</th><th>예약</th><th>5점</th><th>10점</th><th>${rec.wp || 15}점</th><th>끝</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function rpMovesHtml(rec, frames) {
  const items = [];
  for (let k = 1; k < frames.length; k++) {
    const who = frames[k - 1].i;
    const kind = rpMoveKind(frames[k - 1], frames[k], who);
    const text = frames[k].x.length ? frames[k].x.map(escapeHtml).join(' / ') : '(기록 없음)';
    const diff = frames[k].p[who].s - frames[k - 1].p[who].s;
    items.push(`<li class="rp-move${k === RPV.idx ? ' on' : ''}" data-rp-go="${k}"><span class="rp-no">${k}</span><span class="rp-who rp-s${who % 4}">${escapeHtml((rec.p[who] && rec.p[who].name) || '')}</span><span class="rp-kind">${kind}</span><span class="rp-text">${text}</span>${diff > 0 ? `<span class="rp-gain">+${diff}점</span>` : ''}</li>`);
  }
  return `<ol class="rp-moves">${items.join('')}</ol>`;
}

function rpViewerHtml() {
  const rec = RPV.rec;
  const frames = RPV.frames;
  const f = frames[RPV.idx];
  const last = frames.length - 1;
  const tiersHtml = [2, 1, 0]
    .map(
      (t) => `<div class="tier"><div class="tier-label">티어 ${t + 1} <span class="deck-count">(남은 덱: ${f.t[t].d})</span></div>
      <div class="tier-cards">${f.t[t].f.map((code) => (code ? rpCardHtml(code) : '<div class="card-tile empty"></div>')).join('')}</div></div>`
    )
    .join('');
  const bank = `<div class="bank-row">${RP_GEMS.map((g, j) => `<div class="bank-chip gem-${g} static"><span class="chip-label">${GEM_LABEL[g]}</span><span class="chip-count">${f.b[j + 1]}</span></div>`).join('')}<div class="bank-chip gem-gold static"><span class="chip-label">${GEM_LABEL.gold}</span><span class="chip-count">${f.b[0]}</span></div></div>`;
  const stepText = RPV.idx === 0 ? '시작 모습입니다.' : f.x.length ? f.x.map(escapeHtml).join('<br>') : '(이 수의 진행 기록이 없습니다)';
  const who = RPV.idx > 0 ? (rec.p[frames[RPV.idx - 1].i] || {}).name || '' : '';
  const players = rec.p.map((_, k) => rpPlayerHtml(rec, f, k, RPV.seat)).join('');
  return `
    <div class="rp-sub">${rpDate(rec.at)} · ${rec.n}인 · ${rpTitle(rec)}${rec.ab ? ' · <b>중간에 끝난 판</b>' : ''}${rec.w ? ` · ${escapeHtml(rec.w)}` : ''}</div>
    ${rpChartHtml(rec, frames)}
    <div class="rp-nav">
      <button type="button" data-rp="first" ${RPV.idx === 0 ? 'disabled' : ''}>⏮</button>
      <button type="button" data-rp="prev" ${RPV.idx === 0 ? 'disabled' : ''}>◀</button>
      <span class="rp-pos">${RPV.idx} / ${last}</span>
      <button type="button" data-rp="next" ${RPV.idx === last ? 'disabled' : ''}>▶</button>
      <button type="button" data-rp="last" ${RPV.idx === last ? 'disabled' : ''}>⏭</button>
      <button type="button" data-rp="play">${RPV.timer ? '멈추기' : '자동 재생'}</button>
      <input type="range" min="0" max="${last}" value="${RPV.idx}" data-rp-range="1" aria-label="몇 번째 수">
    </div>
    <div class="rp-step">${RPV.idx > 0 ? `<b>${RPV.idx}번째 수 · ${escapeHtml(who)}</b><br>` : ''}${stepText}</div>
    <div class="rp-stage">
      <div class="rp-table">
        <div class="rp-nobles">${f.nb.map(rpNobleHtml).join('')}</div>
        ${tiersHtml}
        ${bank}
      </div>
      <div class="rp-players">${players}</div>
    </div>
    ${rpSummaryHtml(rec, frames)}
    ${rpMovesHtml(rec, frames)}`;
}

function rpListHtml() {
  const list = rpLocalList();
  const rows = list
    .map((rec) => {
      const mine = rpMySeat(rec);
      const res = rec.r && rec.r[mine] ? rpResultLabel(rec.r[mine]) : '';
      const last = rec.d.length;
      return `<li class="rp-item"><div class="rp-item-main"><b>${rpDate(rec.at)}</b> · ${rec.n}인${rec.on ? ' · 온라인' : ' · 연습'}${res ? ` · <span class="rp-res rp-res-${rec.r[mine]}">${res}</span>` : ''}${rec.ab ? ' · 중간에 끝남' : ''}<br><span class="rp-item-sub">${rpTitle(rec)} · ${last}수</span></div><button type="button" data-rp-open="${escapeHtml(rec.id)}">복기</button></li>`;
    })
    .join('');
  return `
    <div class="rp-sub">이 기기에 남은 최근 ${RP_LOCAL_MAX}판입니다. 한 판이 끝나면 저절로 쌓입니다.</div>
    ${rows ? `<ul class="rp-list">${rows}</ul>` : '<div class="rp-empty">아직 기록이 없습니다. 판을 한 번 끝까지 두면 여기에 나타납니다.</div>'}
    <div class="rp-tools">
      <div class="rp-tool"><label for="rpIdInput">서버에서 판 번호로 불러오기</label>
        <span><input id="rpIdInput" type="text" placeholder="판 번호 (g-로 시작)" autocomplete="off"><button type="button" data-rp="load">불러오기</button></span></div>
      <div class="rp-tool"><label>파일</label>
        <span><button type="button" data-rp="export" ${rows ? '' : 'disabled'}>내 기록 모두 저장</button>
        <button type="button" data-rp="import">파일 열기</button><input id="rpFileInput" type="file" accept=".json,application/json" hidden></span></div>
    </div>
    ${RPV.msg ? `<div class="rp-msg">${escapeHtml(RPV.msg)}</div>` : ''}`;
}

function rpEnsureOverlay() {
  let el = document.getElementById('replayOverlay');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'replayOverlay';
  el.className = 'hidden';
  el.innerHTML = `<div id="replayBox" role="dialog" aria-label="복기">
    <div id="replayHeader"><b id="replayTitle">복기</b>
      <span class="rp-head-actions"><button type="button" data-rp="list">목록</button><button type="button" data-rp="save">파일로 저장</button><button type="button" data-rp="close">닫기</button></span></div>
    <div id="replayBody"></div></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', rpOnClick);
  el.addEventListener('input', (e) => {
    if (e.target && e.target.dataset && e.target.dataset.rpRange) rpGo(Number(e.target.value));
  });
  el.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'rpFileInput') rpImportFile(e.target.files && e.target.files[0]);
  });
  return el;
}

function rpRender() {
  const el = rpEnsureOverlay();
  const body = document.getElementById('replayBody');
  const title = document.getElementById('replayTitle');
  const viewer = RPV.mode === 'view' && RPV.rec;
  title.textContent = viewer ? '복기' : '복기 목록';
  el.querySelector('[data-rp="list"]').hidden = !viewer;
  el.querySelector('[data-rp="save"]').hidden = !viewer;
  const keepScroll = body.scrollTop;
  const keepIdInput = document.getElementById('rpIdInput');
  const idText = keepIdInput ? keepIdInput.value : '';
  body.innerHTML = viewer ? rpViewerHtml() : rpListHtml();
  const idInput = document.getElementById('rpIdInput');
  if (idInput) idInput.value = idText;
  body.scrollTop = keepScroll;
  if (viewer) {
    const on = body.querySelector('.rp-move.on');
    const list = body.querySelector('.rp-moves');
    if (on && list) list.scrollTop = Math.max(0, on.offsetTop - list.clientHeight / 2);
  }
}

function replayOpenList() {
  rpStopPlay();
  RPV.mode = 'list';
  rpEnsureOverlay().classList.remove('hidden');
  rpRender();
}

function replayOpen(rec, idx) {
  if (!rpValid(rec)) {
    RPV.msg = '읽을 수 없는 기록입니다.';
    return replayOpenList();
  }
  let frames;
  try {
    frames = rpExpand(rec);
  } catch (e) {
    RPV.msg = '기록이 망가져 있어 열 수 없습니다.';
    return replayOpenList();
  }
  rpStopPlay();
  RPV.mode = 'view';
  RPV.rec = rec;
  RPV.frames = frames;
  RPV.idx = Number.isInteger(idx) ? Math.max(0, Math.min(frames.length - 1, idx)) : 0;
  RPV.seat = rpMySeat(rec);
  RPV.msg = '';
  rpEnsureOverlay().classList.remove('hidden');
  rpRender();
  return undefined;
}

// 방금 끝난 판을 바로 연다 (결과 창의 "복기" 버튼)
function replayOpenCurrent() {
  replayCapture();
  const rec = RP.rec && G && RP.rec.id === G.gameId && RP.full.length ? rpBuildRecord({ ab: G.gameOver ? 0 : 1 }) : null;
  if (!rec) {
    RPV.msg = '아직 기록된 수가 없습니다.';
    return replayOpenList();
  }
  return replayOpen(rec, 0); // 처음부터 한 수씩 되짚어 본다
}

function replayClose() {
  rpStopPlay();
  const el = document.getElementById('replayOverlay');
  if (el) el.classList.add('hidden');
}

function rpGo(k) {
  if (RPV.mode !== 'view') return;
  RPV.idx = Math.max(0, Math.min(RPV.frames.length - 1, k));
  rpRender();
}

function rpStopPlay() {
  if (RPV.timer) clearInterval(RPV.timer);
  RPV.timer = null;
}

function rpTogglePlay() {
  if (RPV.timer) {
    rpStopPlay();
    rpRender();
    return;
  }
  if (RPV.idx >= RPV.frames.length - 1) RPV.idx = 0;
  RPV.timer = setInterval(() => {
    if (RPV.idx >= RPV.frames.length - 1) {
      rpStopPlay();
      rpRender();
      return;
    }
    RPV.idx += 1;
    rpRender();
  }, 900);
  rpRender();
}

// ---- 파일 ----
function rpDownload(name, data) {
  try {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  } catch (e) {
    RPV.msg = '파일로 저장하지 못했습니다.';
    rpRender();
  }
}

function rpImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || ''));
      const recs = (Array.isArray(data) ? data : [data]).filter(rpValid);
      if (!recs.length) throw new Error('none');
      recs.forEach(rpLocalAdd);
      if (recs.length === 1) replayOpen(recs[0], 0);
      else {
        RPV.msg = `${recs.length}판을 불러왔습니다.`;
        replayOpenList();
      }
    } catch (e) {
      RPV.msg = '읽을 수 있는 복기 파일이 아닙니다.';
      replayOpenList();
    }
  };
  reader.readAsText(file);
}

function rpOnClick(e) {
  const t = e.target.closest('[data-rp], [data-rp-go], [data-rp-open], [data-rp-chart]');
  if (!t) {
    if (e.target.id === 'replayOverlay') replayClose();
    return;
  }
  if (t.dataset.rpGo != null) return rpGo(Number(t.dataset.rpGo));
  if (t.dataset.rpOpen != null) {
    const rec = rpLocalList().find((x) => x.id === t.dataset.rpOpen);
    return replayOpen(rec, 0);
  }
  if (t.dataset.rpChart) {
    const r = t.getBoundingClientRect();
    const k = Math.round(((e.clientX - r.left) / r.width) * (RPV.frames.length - 1));
    return rpGo(k);
  }
  switch (t.dataset.rp) {
    case 'close':
      return replayClose();
    case 'list':
      return replayOpenList();
    case 'first':
      return rpGo(0);
    case 'prev':
      return rpGo(RPV.idx - 1);
    case 'next':
      return rpGo(RPV.idx + 1);
    case 'last':
      return rpGo(RPV.frames.length - 1);
    case 'play':
      return rpTogglePlay();
    case 'save':
      return RPV.rec && rpDownload(`splendor-${RPV.rec.id}.json`, RPV.rec);
    case 'export': {
      const list = rpLocalList();
      return list.length && rpDownload('splendor-replays.json', list);
    }
    case 'import': {
      const f = document.getElementById('rpFileInput');
      return f && f.click();
    }
    case 'load': {
      const input = document.getElementById('rpIdInput');
      const id = input ? input.value : '';
      RPV.msg = '불러오는 중...';
      rpRender();
      return rpLoadDb(id)
        .then((rec) => replayOpen(rec, 0))
        .catch(() => {
          RPV.msg = '그 판 번호의 기록을 서버에서 찾지 못했습니다. (서버에 올라가 있지 않거나 번호가 다릅니다)';
          replayOpenList();
        });
    }
    default:
      return undefined;
  }
}

document.addEventListener('keydown', (e) => {
  const el = document.getElementById('replayOverlay');
  if (!el || el.classList.contains('hidden')) return;
  if (e.key === 'Escape') replayClose();
  if (RPV.mode === 'view' && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range')) {
    if (e.key === 'ArrowRight') rpGo(RPV.idx + 1);
    if (e.key === 'ArrowLeft') rpGo(RPV.idx - 1);
  }
});

function replayRefreshButton() {
  const b = document.getElementById('replayBtn');
  if (b) b.title = `이 기기에 ${rpLocalList().length}판의 복기가 남아 있습니다`;
}

document.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('replayBtn');
  if (b) b.addEventListener('click', replayOpenList);
  replayRefreshButton();
  // 주소로 판 번호를 주면 서버에서 불러와 연다 (?replay=판번호)
  try {
    const id = new URLSearchParams(location.search).get('replay');
    if (id) {
      rpLoadDb(id)
        .then((rec) => replayOpen(rec, 0))
        .catch(() => {
          RPV.msg = '그 판 번호의 기록을 서버에서 찾지 못했습니다.';
          replayOpenList();
        });
    }
  } catch (e) {
    /* noop */
  }
});
