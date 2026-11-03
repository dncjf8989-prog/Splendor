'use strict';

// ============ 스플렌더 듀얼 판 기록과 전적 ============
// 판이 끝나면 그 판을 서버의 /games 에 한 줄 남긴다. 오리지널과 같은 곳에 쌓되
// k:'duel' 표시를 붙여 구분한다. (오리지널 랭킹과 전적에는 이 표시가 붙은 판을 세지 않는다)
// 전적은 그 줄들을 세어서 계산하므로 누가 어디서 열어도 같은 숫자가 나온다.
//
//   at=때  n=2(인원)  k='duel'  f=선공 자리  v=승리 방식(p 점수 / c 왕관 / x 한 색)
//   ab=1 이면 중도에 끝난 판 (나간 사람이 패)
//   p[] = { id, name, r: 'w'|'l', s: 점수, cr: 왕관, cc: 산 카드 수 }

const DSTATS = { status: 'idle', games: [], at: 0, msg: '' };
const D_KIND_CODE = { points: 'p', crowns: 'c', color: 'x' };
const D_KIND_LABEL = { p: '점수 20', c: '왕관 10', x: '한 색 10점' };
const D_MIN_GAMES = 5; // 승률 순위에 넣으려면 필요한 판수

function dSaveGame(gameId, rec, keepalive) {
  if (!rec || !gameId || typeof dbRequest !== 'function') return Promise.resolve(false);
  const id = String(gameId).replace(/[.#$/[\]]/g, '-');
  const opts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) };
  if (keepalive) opts.keepalive = true; // 창을 닫는 중에도 요청이 나가게 한다
  return dbRequest('/games/' + id + '.json', opts)
    .then(() => true)
    .catch(() => false);
}

// 끝난 판의 기록. profiles = [{id,name}, {id,name}] (자리 순서)
function dGameRecord(S, profiles) {
  if (!S || !S.over || !profiles || profiles.length !== 2 || !profiles[0] || !profiles[1]) return null;
  const w = S.over.winner;
  return {
    at: Date.now(),
    n: 2,
    k: 'duel',
    f: S.start,
    v: D_KIND_CODE[S.over.kind] || 'p',
    p: [0, 1].map((s) => ({
      id: profiles[s].id,
      name: String(profiles[s].name || '').slice(0, 12),
      r: s === w ? 'w' : 'l',
      s: duelPoints(S, s),
      cr: duelCrowns(S, s),
      cc: S.players[s].cards.length,
    })),
  };
}

// 중도에 끝난 판의 기록. leaverSeat 가 나간 사람이다.
function dGameRecordAbandoned(S, profiles, leaverSeat) {
  if (!S || !profiles || profiles.length !== 2 || !profiles[0] || !profiles[1]) return null;
  return {
    at: Date.now(),
    n: 2,
    k: 'duel',
    f: S.start,
    ab: 1,
    p: [0, 1].map((s) => ({
      id: profiles[s].id,
      name: String(profiles[s].name || '').slice(0, 12),
      r: s === leaverSeat ? 'l' : 'w',
      s: duelPoints(S, s),
      cr: duelCrowns(S, s),
      cc: S.players[s].cards.length,
    })),
  };
}

// ---- 판들을 읽어 전적을 센다 ----
function dIsDuelGame(g) {
  return !!g && g.k === 'duel' && g.n === 2 && Array.isArray(g.p) && g.p.length === 2;
}

function dTally(games) {
  const by = Object.create(null);
  games.filter(dIsDuelGame).forEach((g) => {
    g.p.forEach((x, seat) => {
      let r = by[x.id];
      if (!r) r = by[x.id] = { id: x.id, name: '이름 없음', at: 0, w: 0, l: 0, byKind: { p: 0, c: 0, x: 0 }, first: { w: 0, n: 0 }, second: { w: 0, n: 0 } };
      if (x.r === 'w') r.w += 1;
      else if (x.r === 'l') r.l += 1;
      if (x.r === 'w' && !g.ab && g.v && r.byKind[g.v] !== undefined) r.byKind[g.v] += 1;
      if (!g.ab && Number.isInteger(g.f)) {
        const slot = g.f === seat ? r.first : r.second;
        slot.n += 1;
        if (x.r === 'w') slot.w += 1;
      }
      if ((g.at || 0) >= r.at) {
        r.at = g.at || 0;
        if (typeof x.name === 'string' && x.name.trim()) r.name = x.name.trim().slice(0, 12);
      }
    });
  });
  return Object.keys(by).map((k) => by[k]);
}

function dRate(r) {
  const t = r.w + r.l;
  return t ? (r.w / t) * 100 : 0;
}
function dRateText(rate) {
  return (Math.round(rate * 10) / 10).toFixed(1);
}

function dRanking(rows) {
  const list = rows.filter((r) => r.w + r.l > 0).slice();
  list.sort((a, b) => {
    const qa = a.w + a.l >= D_MIN_GAMES ? 1 : 0;
    const qb = b.w + b.l >= D_MIN_GAMES ? 1 : 0;
    if (qa !== qb) return qb - qa;
    return dRate(b) - dRate(a) || b.w - a.w || String(a.name).localeCompare(String(b.name));
  });
  return list;
}

function dAgo(at) {
  if (!at) return '';
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d < 100 ? `${d}일 전` : '오래전';
}

function dStatsHtml() {
  const myId = dProfile().id;
  if (DSTATS.status === 'loading' && !DSTATS.games.length) return '<div class="d-note">불러오는 중입니다...</div>';
  if (DSTATS.status === 'error') return `<div class="d-note d-flash-msg">${dEsc(DSTATS.msg || '전적을 불러오지 못했습니다.')}</div><button type="button" data-d-stats="refresh">다시 시도</button>`;

  const games = DSTATS.games.filter(dIsDuelGame);
  const rows = dTally(games);
  const me = rows.find((r) => r.id === myId);
  const rank = dRanking(rows);

  let html = '<div class="d-note" style="text-align:left">온라인 대전만 기록됩니다. 오리지널 전적과는 따로 셉니다.</div>';
  if (me) {
    const t = me.w + me.l;
    const k = me.byKind;
    html += `<div class="d-panel" style="margin:10px 0"><h3>내 전적</h3>
      <div class="d-stat"><div><b>${t}</b><span> 전</span></div><div><b>${me.w}</b><span> 승</span></div><div><b>${me.l}</b><span> 패</span></div><div><b>${dRateText(dRate(me))}</b><span> %</span></div></div>
      <div class="d-goal">이긴 방식: 점수 <b>${k.p}</b> · 왕관 <b>${k.c}</b> · 한 색 <b>${k.x}</b><br>
      선공일 때 <b>${me.first.w}/${me.first.n}</b>승 · 후공일 때 <b>${me.second.w}/${me.second.n}</b>승 <span class="d-label">(중도 종료 판 제외)</span></div></div>`;
  } else {
    html += '<div class="d-note" style="margin:12px 0">아직 이 기기로 둔 듀얼 온라인 대전 기록이 없습니다.</div>';
  }

  html += `<div class="d-row" style="justify-content:space-between"><b>랭킹</b><span>
    <button type="button" data-d-stats="refresh">새로고침</button>
    <span class="d-label">${DSTATS.status === 'loading' ? '불러오는 중...' : `${rows.length}명 · ${dAgo(DSTATS.at)} 기준`}</span></span></div>`;
  if (!rank.length) html += '<div class="d-note">아직 기록된 판이 없습니다.</div>';
  else {
    html += '<table class="d-rank-table"><thead><tr><th>#</th><th>이름</th><th>전</th><th>승</th><th>패</th><th>승률</th></tr></thead><tbody>';
    rank.forEach((r, i) => {
      const t = r.w + r.l;
      html += `<tr class="${r.id === myId ? 'd-rank-me' : ''}"><td>${i + 1}</td><td>${dEsc(r.name)}${r.id === myId ? ' <span class="d-tag on">나</span>' : ''}${t < D_MIN_GAMES ? ` <span class="d-label">${D_MIN_GAMES}전 미만</span>` : ''}</td><td>${t}</td><td>${r.w}</td><td>${r.l}</td><td>${dRateText(dRate(r))}%</td></tr>`;
    });
    html += '</tbody></table>';
    html += `<div class="d-note" style="text-align:left;margin-top:6px">승률 순위는 ${D_MIN_GAMES}전 이상인 사람을 위에 둡니다.</div>`;
  }

  const mine = games.filter((g) => g.p.some((x) => x.id === myId)).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 8);
  if (mine.length) {
    html += '<div style="margin-top:14px"><b>최근 내 판</b></div><table class="d-rank-table"><thead><tr><th>때</th><th>상대</th><th>결과</th><th>점수</th><th>방식</th></tr></thead><tbody>';
    mine.forEach((g) => {
      const mi = g.p.findIndex((x) => x.id === myId);
      const o = g.p[1 - mi];
      const m = g.p[mi];
      html += `<tr><td>${dAgo(g.at)}</td><td>${dEsc(o.name)}</td><td>${m.r === 'w' ? '승' : '패'}</td><td>${m.s == null ? '-' : m.s} : ${o.s == null ? '-' : o.s}</td><td>${g.ab ? '중도 종료' : D_KIND_LABEL[g.v] || ''}</td></tr>`;
    });
    html += '</tbody></table>';
  }
  return html;
}

function dRenderStats() {
  const el = document.getElementById('statsBody');
  if (el) el.innerHTML = dStatsHtml();
}

function dStatsRefresh() {
  if (DSTATS.status === 'loading') return Promise.resolve();
  if (typeof dbLoadGames !== 'function' || !dbAvailable()) {
    DSTATS.status = 'error';
    DSTATS.msg = '이 브라우저에서는 전적을 불러올 수 없습니다.';
    dRenderStats();
    return Promise.resolve();
  }
  DSTATS.status = 'loading';
  dRenderStats();
  return dbLoadGames()
    .then((games) => {
      DSTATS.games = games;
      DSTATS.status = 'ok';
      DSTATS.at = Date.now();
      dRenderStats();
    })
    .catch(() => {
      DSTATS.status = 'error';
      DSTATS.msg = '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
      dRenderStats();
    });
}

function dToggleStats(force) {
  const overlay = document.getElementById('statsOverlay');
  if (!overlay) return;
  const show = force != null ? force : overlay.classList.contains('hidden');
  if (show) {
    dRenderStats();
    if (Date.now() - (DSTATS.at || 0) > 60000) dStatsRefresh();
  }
  overlay.classList.toggle('hidden', !show);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-d-stats]');
  if (t && t.dataset.dStats === 'refresh') dStatsRefresh();
});

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('dStatsBtn');
  if (btn) btn.addEventListener('click', () => dToggleStats());
  const close = document.getElementById('statsCloseBtn');
  if (close) close.addEventListener('click', () => dToggleStats(false));
  const overlay = document.getElementById('statsOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dToggleStats(false);
    });
  }
});
