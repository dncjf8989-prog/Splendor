'use strict';

// ============ 전적 기록 (브라우저 localStorage에만 저장) ============
// 서버가 없는 정적 사이트이므로 전적은 각자의 브라우저에만 쌓인다.
// 상대 구분은 "상대 브라우저에 심어둔 기기 ID"를 기준으로 하고,
// 화면에 보여줄 이름으로는 상대가 입력한 닉네임을 함께 저장한다.

const PROFILE_KEY = 'splendorLiteProfile';
const STATS_KEY = 'splendorLiteStats';

const STATS = { lastRecordedGameId: null };
window.STATS = STATS;

function statsReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function statsWriteJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* 사생활 보호 모드 등에서 저장이 막혀도 게임은 그대로 진행한다 */
  }
}

// ============ 내 프로필 (기기 ID + 닉네임) ============
function statsProfile() {
  const p = statsReadJson(PROFILE_KEY, null);
  if (p && p.id) return p;
  const fresh = { id: 'd-' + Math.random().toString(36).slice(2, 10), name: '' };
  statsWriteJson(PROFILE_KEY, fresh);
  return fresh;
}

function statsGetName() {
  return statsProfile().name || '';
}

function statsSetName(name) {
  const p = statsProfile();
  p.name = (name || '').trim().slice(0, 12);
  statsWriteJson(PROFILE_KEY, p);
  return p.name;
}

function statsMyDisplayName() {
  return statsGetName() || '플레이어 1';
}

// ============ 전적 데이터 ============
// v2: 인원수(2/3/4인)별로 나눠 센다.
//   totals[mode][인원]        = {w,l,d}   내 판 결과
//   opponents[키].counts[인원] = {w,l,d}   그 상대와의 1:1 비교
// v1에는 인원 정보가 없어서 되살릴 수 없으므로 legacy로 따로 보관해 보여준다.
const STATS_VERSION = 2;

function statsBlank() {
  return { w: 0, l: 0, d: 0 };
}

function statsEmpty() {
  return {
    version: STATS_VERSION,
    lastRecordedGameId: null,
    totals: { single: {}, online: {} },
    legacy: { single: statsBlank(), online: statsBlank() },
    opponents: {},
  };
}

const statsNum = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

// 인원을 모르는 옛 기록은 legacy로 옮긴다. 지우지는 않는다.
function statsMigrateV1(old) {
  const s = statsEmpty();
  if (old && old.totals) {
    ['single', 'online'].forEach((m) => {
      const t = old.totals[m];
      if (t) s.legacy[m] = { w: statsNum(t.w), l: statsNum(t.l), d: statsNum(t.d) };
    });
  }
  if (old && old.opponents) {
    Object.entries(old.opponents).forEach(([key, rec]) => {
      if (!rec) return;
      s.opponents[key] = {
        name: rec.name || '상대',
        last: statsNum(rec.last),
        counts: {},
        legacy: { w: statsNum(rec.w), l: statsNum(rec.l), d: statsNum(rec.d) },
      };
    });
  }
  if (old && typeof old.lastRecordedGameId === 'string') s.lastRecordedGameId = old.lastRecordedGameId;
  return s;
}

function statsLoad() {
  const raw = statsReadJson(STATS_KEY, null);
  if (!raw || typeof raw !== 'object') return statsEmpty();
  if (raw.version === STATS_VERSION && raw.totals && raw.opponents && raw.legacy) return raw;
  if (raw.totals && raw.opponents) return statsMigrateV1(raw); // v1 기록
  return statsEmpty();
}

function statsSave(s) {
  statsWriteJson(STATS_KEY, s);
}

function statsBucket(map, key) {
  if (!map[key]) map[key] = statsBlank();
  return map[key];
}

// 인원 필터에 맞는 기록만 더한다. filter가 'all'이면 전부.
function statsSum(map, filter) {
  const out = statsBlank();
  Object.entries(map || {}).forEach(([n, rec]) => {
    if (filter !== 'all' && String(n) !== String(filter)) return;
    out.w += statsNum(rec.w);
    out.l += statsNum(rec.l);
    out.d += statsNum(rec.d);
  });
  return out;
}

// ============ 결과 판정 및 기록 ============
function statsMySeat() {
  return window.NET && NET.mode === 'online' ? NET.seat : HUMAN_SEAT;
}

// endGame()과 같은 우열 기준: 점수 -> 개발 카드가 적은 쪽.
function statsBeats(a, b) {
  return a.points !== b.points ? a.points > b.points : a.cards.length < b.cards.length;
}

// 내 판 전체 결과 (전원과 비교). 전체 전적에 쓴다.
function statsMyResult() {
  const mySeat = statsMySeat();
  if (mySeat == null || !G || !G.players[mySeat]) return null;
  const me = G.players[mySeat];
  const others = G.players.filter((_, i) => i !== mySeat);
  if (others.some((p) => statsBeats(p, me))) return 'l';
  if (others.some((p) => p.points === me.points && p.cards.length === me.cards.length)) return 'd';
  return 'w';
}

// 나 vs 그 상대 1:1 비교. 3~4인에서 A가 우승했다고 해서 B와 C가 서로에게
// 진 것은 아니므로, 상대별 전적은 판 결과가 아니라 둘 사이의 순위로 매긴다.
function statsResultAgainst(oppSeat) {
  const mySeat = statsMySeat();
  const me = G && G.players[mySeat];
  const opp = G && G.players[oppSeat];
  if (!me || !opp) return null;
  if (me.points !== opp.points) return me.points > opp.points ? 'w' : 'l';
  if (me.cards.length !== opp.cards.length) return me.cards.length < opp.cards.length ? 'w' : 'l';
  return 'd';
}

// 그 판에 함께한 상대들. 온라인은 자리 번호까지 들고 온다.
function statsOpponents() {
  if (!window.NET || NET.mode !== 'online') return [{ key: 'AI', name: 'AI', seat: null }];
  const list = (NET.opponents || [])
    .filter((o) => o && o.id)
    .map((o) => ({ key: o.id, name: o.name || '상대', seat: Number.isInteger(o.seat) ? o.seat : null }));
  return list.length ? list : [{ key: 'unknown', name: '알 수 없는 상대', seat: null }];
}

// 게임이 끝날 때 한 번만 기록한다. G.gameId는 온라인에서도 양쪽이 공유하므로
// 같은 판을 두 번 세지 않는다.
function maybeRecordResult() {
  if (!G || !G.gameOver || !G.gameId) return;

  const s = statsLoad();
  if (STATS.lastRecordedGameId === G.gameId || s.lastRecordedGameId === G.gameId) {
    STATS.lastRecordedGameId = G.gameId;
    return;
  }

  const result = statsMyResult();
  if (!result) return;

  const mode = window.NET && NET.mode === 'online' ? 'online' : 'single';
  const count = G.playerCount || G.players.length;

  statsBucket(s.totals[mode], count)[result] += 1;

  statsOpponents().forEach((opp) => {
    if (!s.opponents[opp.key]) {
      s.opponents[opp.key] = { name: opp.name, last: 0, counts: {}, legacy: statsBlank() };
    }
    const rec = s.opponents[opp.key];
    // 싱글은 AI 전체를 한 상대로 보므로 판 결과를 그대로 쓴다.
    const pair = opp.seat != null && G.players[opp.seat] ? statsResultAgainst(opp.seat) : null;
    statsBucket(rec.counts, count)[pair || result] += 1;
    rec.name = opp.name; // 상대가 닉네임을 바꿨으면 최신 이름으로
    rec.last = Date.now();
  });
  s.lastRecordedGameId = G.gameId;

  STATS.lastRecordedGameId = G.gameId;
  statsSave(s);
  renderStatsPanel();
}

// ============ 렌더링 ============
let statsFilter = 'all'; // 'all' | '2' | '3' | '4'

function statsSummary(rec) {
  const total = rec.w + rec.l + rec.d;
  const rate = total ? Math.round((rec.w / total) * 100) : 0;
  return { total, rate };
}

function statsAddInto(target, src) {
  target.w += src.w;
  target.l += src.l;
  target.d += src.d;
  return target;
}

function renderStatsPanel() {
  const el = document.getElementById('statsBody');
  if (!el) return;
  const s = statsLoad();
  const f = statsFilter;

  const single = statsSum(s.totals.single, f);
  const online = statsSum(s.totals.online, f);
  const all = statsAddInto(statsAddInto(statsBlank(), single), online);
  // 인원을 모르는 옛 기록은 '전체'에서만 합산한다.
  if (f === 'all') {
    statsAddInto(all, s.legacy.single);
    statsAddInto(all, s.legacy.online);
  }
  const allSum = statsSummary(all);

  const tabs = [['all', '전체'], ['2', '2인'], ['3', '3인'], ['4', '4인']]
    .map(([key, label]) => `<button class="stats-tab${f === key ? ' active' : ''}" data-stats-filter="${key}">${label}</button>`)
    .join('');

  // 인원별 한 줄 요약 (전체 탭에서만)
  let byCount = '';
  if (f === 'all') {
    const rows = ['2', '3', '4']
      .map((n) => {
        const rec = statsAddInto(statsSum(s.totals.single, n), statsSum(s.totals.online, n));
        const sum = statsSummary(rec);
        if (!sum.total) return '';
        return `<span class="stats-chip">${n}인 <strong>${sum.total}전</strong> ${rec.w}승 ${rec.l}패 ${sum.rate}%</span>`;
      })
      .filter(Boolean)
      .join('');
    if (rows) byCount = `<div class="stats-chips">${rows}</div>`;
  }

  // 옛 상대별 기록(legacy)은 일부러 더하지 않는다. 그 값은 판 전체 결과를 상대
  // 모두에게 똑같이 적던 시절의 것이라, 3~4인에서 함께 진 상대에게도 패로
  // 남아 있다. 전체 승패(totals)는 판 단위로 맞게 셌으므로 그대로 합산한다.
  const opponents = Object.entries(s.opponents)
    .map(([key, rec]) => ({ key, name: rec.name, ...statsSum(rec.counts, f) }))
    .filter((o) => o.w + o.l + o.d > 0)
    .sort((a, b) => b.w + b.l + b.d - (a.w + a.l + a.d));

  const oppRows = opponents.length
    ? opponents
        .map((o) => {
          const sum = statsSummary(o);
          return `<tr>
            <td class="stats-name">${o.key === 'AI' ? '🤖 AI' : escapeHtml(o.name)}</td>
            <td>${sum.total}전</td>
            <td class="stats-w">${o.w}승</td>
            <td class="stats-l">${o.l}패</td>
            <td>${o.d}무</td>
            <td class="stats-rate">${sum.rate}%</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="6" class="stats-empty">${f === 'all' ? '아직 기록이 없습니다.' : `${f}인 기록이 아직 없습니다.`}</td></tr>`;

  const legacyTotal = ['single', 'online'].reduce((n, m) => n + s.legacy[m].w + s.legacy[m].l + s.legacy[m].d, 0);
  const legacyNote =
    f === 'all' && legacyTotal
      ? `<span class="stats-note">전체 ${legacyTotal}전은 인원수를 나누기 전에 쌓인 기록이라 인원별 집계에는 빠져 있습니다.</span>`
      : '';

  // 옛 상대별 기록이 남아 있으면 왜 표에서 빠졌는지 밝힌다.
  const oppLegacy = Object.values(s.opponents).reduce((n, rec) => {
    const lg = rec.legacy || statsBlank();
    return n + lg.w + lg.l + lg.d;
  }, 0);
  const oppNote = oppLegacy
    ? `<div class="stats-warn">예전 ${oppLegacy}전은 상대별 집계에서 뺐습니다. 그때는 3~4인에서 판을 지면 함께 진 상대에게도 패로 적혀, 실제로 이긴 상대에게 패가 남아 있었습니다.</div>`
    : '';

  el.innerHTML = `
    <div class="stats-name-row">
      <label for="nickInput">내 닉네임</label>
      <input id="nickInput" maxlength="12" placeholder="플레이어 1" value="${escapeHtml(statsGetName())}">
      <button data-stats-act="saveName">저장</button>
    </div>

    <div class="stats-tabs">${tabs}</div>

    <div class="stats-overall">
      <div class="stats-big">
        <span class="stats-big-num">${allSum.total}</span><span class="stats-big-label">전</span>
        <span class="stats-big-num stats-w">${all.w}</span><span class="stats-big-label">승</span>
        <span class="stats-big-num stats-l">${all.l}</span><span class="stats-big-label">패</span>
        <span class="stats-big-num">${all.d}</span><span class="stats-big-label">무</span>
      </div>
      <div class="stats-sub">승률 ${allSum.rate}% · 싱글 ${single.w}승 ${single.l}패 · 온라인 ${online.w}승 ${online.l}패</div>
      ${byCount}
    </div>

    <div class="stats-section-label">상대별 전적<span class="stats-hint">나와 그 상대의 순위만 비교합니다</span></div>
    <table class="stats-table"><tbody>${oppRows}</tbody></table>
    ${oppNote}

    <div class="stats-footer">
      <span class="stats-note">전적은 이 브라우저에만 저장되며, 게임 결과로만 갱신됩니다. 기기나 브라우저를 바꾸면 따로 쌓입니다.</span>
      ${legacyNote}
    </div>`;
}

function toggleStatsPanel(force) {
  const overlay = document.getElementById('statsOverlay');
  if (!overlay) return;
  const show = force != null ? force : overlay.classList.contains('hidden');
  if (show) renderStatsPanel();
  overlay.classList.toggle('hidden', !show);
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('statsBtn');
  if (btn) btn.addEventListener('click', () => toggleStatsPanel());

  const overlay = document.getElementById('statsOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) toggleStatsPanel(false);
    });
  }

  const body = document.getElementById('statsBody');
  if (body) {
    body.addEventListener('click', (e) => {
      const tabEl = e.target.closest('[data-stats-filter]');
      if (tabEl) {
        statsFilter = tabEl.dataset.statsFilter;
        renderStatsPanel();
        return;
      }
      const btnEl = e.target.closest('[data-stats-act]');
      if (!btnEl) return;
      if (btnEl.dataset.statsAct === 'saveName') {
        const input = document.getElementById('nickInput');
        statsSetName(input ? input.value : '');
        // 싱글 플레이는 진행 중인 판에도 바로 반영한다.
        // (온라인은 이름이 양쪽에 동기화되어야 하므로 다음 판부터 적용된다)
        if (G && (!window.NET || NET.mode !== 'online')) {
          G.players[0].name = statsMyDisplayName();
        }
        renderStatsPanel();
        render();
      }
    });
  }

  const closeBtn = document.getElementById('statsCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => toggleStatsPanel(false));
});
