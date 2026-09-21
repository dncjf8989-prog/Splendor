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
// v3: 전적을 새로 시작한다. 인원수(2/3/4인)별로 나눠 세고,
//     상대별 전적은 1:1(2인) 대전에서만 남긴다.
//   totals[mode][인원] = {w,l,d}   판 승패 (이긴 사람만 승, 나머지는 패)
//   opponents[키]      = {name,last,w,l,d}   2인 대전 전용
// v1/v2 기록은 집계 규칙이 달라 이어붙일 수 없으므로 버리고 새로 시작한다.
const STATS_VERSION = 3;

function statsBlank() {
  return { w: 0, l: 0, d: 0 };
}

function statsEmpty() {
  return {
    version: STATS_VERSION,
    lastRecordedGameId: null,
    totals: { single: {}, online: {} },
    opponents: {},
  };
}

const statsNum = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function statsLoad() {
  const raw = statsReadJson(STATS_KEY, null);
  if (!raw || typeof raw !== 'object') return statsEmpty();
  if (raw.version === STATS_VERSION && raw.totals && raw.opponents) return raw;
  return statsEmpty(); // 옛 판본은 버린다
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
// endGame()과 같은 우열 기준: 점수 -> 개발 카드가 적은 쪽.
function statsBeats(a, b) {
  return a.points !== b.points ? a.points > b.points : a.cards.length < b.cards.length;
}

// 판 승패. 이긴 사람만 승이고 나머지는 전부 패다.
// (맨 위에서 점수와 카드 수까지 똑같이 겹치면 그 인원은 무승부)
function statsMyResult() {
  const mySeat = window.NET && NET.mode === 'online' ? NET.seat : HUMAN_SEAT;
  if (mySeat == null || !G || !G.players[mySeat]) return null;
  const me = G.players[mySeat];
  const others = G.players.filter((_, i) => i !== mySeat);
  if (others.some((p) => statsBeats(p, me))) return 'l';
  if (others.some((p) => p.points === me.points && p.cards.length === me.cards.length)) return 'd';
  return 'w';
}

// 1:1 상대. 3인 이상에서는 상대별 전적을 남기지 않으므로 빈 배열이다.
function statsOpponents() {
  const count = G && (G.playerCount || G.players.length);
  if (count !== 2) return [];
  if (!window.NET || NET.mode !== 'online') return [{ key: 'AI', name: 'AI' }];
  const list = (NET.opponents || [])
    .filter((o) => o && o.id)
    .map((o) => ({ key: o.id, name: o.name || '상대' }));
  return list.length ? list : [{ key: 'unknown', name: '알 수 없는 상대' }];
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

  // 2인 대전에서는 판 승패가 곧 그 상대와의 승패다.
  statsOpponents().forEach((opp) => {
    if (!s.opponents[opp.key]) s.opponents[opp.key] = { name: opp.name, last: 0, w: 0, l: 0, d: 0 };
    const rec = s.opponents[opp.key];
    rec[result] += 1;
    rec.name = opp.name; // 상대가 닉네임을 바꿨으면 최신 이름으로
    rec.last = Date.now();
  });
  s.lastRecordedGameId = G.gameId;

  STATS.lastRecordedGameId = G.gameId;
  statsSave(s);
  renderStatsPanel();
}

// 대전이 중도에 끝난 경우의 기록. 나간 사람은 패('l'), 남은 사람은 승('w').
// 이미 끝난 판은 정상 집계(maybeRecordResult)를 따르므로 건드리지 않는다.
function statsRecordAbandoned(result) {
  if (!G || !G.gameId || G.gameOver) return false;
  if (!window.NET || NET.mode !== 'online') return false;

  const s = statsLoad();
  if (STATS.lastRecordedGameId === G.gameId || s.lastRecordedGameId === G.gameId) return false;

  const count = G.playerCount || G.players.length;
  statsBucket(s.totals.online, count)[result] += 1;

  // 2인이면 그 상대에게도 남는다. (3인 이상은 상대별 전적을 쓰지 않는다)
  // NET.opponents가 정리되기 전에 불러야 하므로, 연결을 끊기 전에 기록한다.
  statsOpponents().forEach((opp) => {
    if (!s.opponents[opp.key]) s.opponents[opp.key] = { name: opp.name, last: 0, w: 0, l: 0, d: 0 };
    const rec = s.opponents[opp.key];
    rec[result] += 1;
    rec.name = opp.name;
    rec.last = Date.now();
  });
  s.lastRecordedGameId = G.gameId;

  STATS.lastRecordedGameId = G.gameId;
  statsSave(s);
  renderStatsPanel();
  return true;
}

// 내가 대전 도중에 나갔다 -> 패
function statsRecordForfeit() {
  return statsRecordAbandoned('l');
}

// 상대가 대전 도중에 나갔다 -> 부전승
function statsRecordWalkover() {
  return statsRecordAbandoned('w');
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
  const allSum = statsSummary(all);

  const tabs = [['all', '전체'], ['2', '2인'], ['3', '3인'], ['4', '4인']]
    .map(([key, label]) => `<button class="stats-tab${f === key ? ' active' : ''}" data-stats-filter="${key}">${label}</button>`)
    .join('');

  // 인원별 한 줄 요약 (전체 탭에서만)
  let byCount = '';
  if (f === 'all') {
    const chips = ['2', '3', '4']
      .map((n) => {
        const rec = statsAddInto(statsSum(s.totals.single, n), statsSum(s.totals.online, n));
        const sum = statsSummary(rec);
        if (!sum.total) return '';
        return `<span class="stats-chip">${n}인 <strong>${sum.total}전</strong> ${rec.w}승 ${rec.l}패 ${sum.rate}%</span>`;
      })
      .filter(Boolean)
      .join('');
    if (chips) byCount = `<div class="stats-chips">${chips}</div>`;
  }

  // 상대별 전적은 2인 기록뿐이므로 3인/4인 탭에서는 표 대신 안내를 둔다.
  let oppSection;
  if (f === '3' || f === '4') {
    oppSection = `<div class="stats-warn">${f}인 대전은 상대별 전적을 남기지 않습니다. 이긴 사람만 승, 나머지는 패로 집계합니다.</div>`;
  } else {
    const opponents = Object.entries(s.opponents)
      .map(([key, rec]) => ({ key, name: rec.name, w: statsNum(rec.w), l: statsNum(rec.l), d: statsNum(rec.d) }))
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
      : `<tr><td colspan="6" class="stats-empty">아직 1:1 기록이 없습니다.</td></tr>`;
    oppSection = `<table class="stats-table"><tbody>${oppRows}</tbody></table>`;
  }

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

    <div class="stats-section-label">상대별 전적<span class="stats-hint">1:1(2인) 대전만 기록합니다</span></div>
    ${oppSection}

    <div class="stats-footer">
      <span class="stats-note">전적은 이 브라우저에만 저장되며, 게임 결과로만 갱신됩니다. 기기나 브라우저를 바꾸면 따로 쌓입니다.</span>
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
