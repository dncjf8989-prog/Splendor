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
function statsLoad() {
  const s = statsReadJson(STATS_KEY, null);
  if (s && s.totals && s.opponents) return s;
  return {
    lastRecordedGameId: null,
    totals: { single: { w: 0, l: 0, d: 0 }, online: { w: 0, l: 0, d: 0 } },
    opponents: {},
  };
}

function statsSave(s) {
  statsWriteJson(STATS_KEY, s);
}

function statsReset() {
  statsWriteJson(STATS_KEY, null);
  STATS.lastRecordedGameId = null;
  renderStatsPanel();
  render();
}

// ============ 결과 판정 및 기록 ============
// endGame()의 승패 판정과 같은 기준(점수 -> 개발 카드 수)을 쓴다.
function statsMyResult() {
  const mySeat = window.NET && NET.mode === 'online' ? NET.seat : 0;
  if (mySeat == null || !G || !G.players[mySeat]) return null;
  const me = G.players[mySeat];
  const opp = G.players[1 - mySeat];
  if (me.points !== opp.points) return me.points > opp.points ? 'w' : 'l';
  if (me.cards.length !== opp.cards.length) return me.cards.length < opp.cards.length ? 'w' : 'l';
  return 'd';
}

function statsOpponent() {
  if (!window.NET || NET.mode !== 'online') return { key: 'AI', name: 'AI' };
  const opp = NET.opponent;
  if (opp && opp.id) return { key: opp.id, name: opp.name || '상대' };
  return { key: 'unknown', name: '알 수 없는 상대' };
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
  const opp = statsOpponent();

  s.totals[mode][result] += 1;
  if (!s.opponents[opp.key]) s.opponents[opp.key] = { name: opp.name, w: 0, l: 0, d: 0, last: 0 };
  s.opponents[opp.key][result] += 1;
  s.opponents[opp.key].name = opp.name; // 상대가 닉네임을 바꿨으면 최신 이름으로
  s.opponents[opp.key].last = Date.now();
  s.lastRecordedGameId = G.gameId;

  STATS.lastRecordedGameId = G.gameId;
  statsSave(s);
  renderStatsPanel();
}

// ============ 렌더링 ============
function statsSummary(rec) {
  const total = rec.w + rec.l + rec.d;
  const rate = total ? Math.round((rec.w / total) * 100) : 0;
  return { total, rate };
}

function renderStatsPanel() {
  const el = document.getElementById('statsBody');
  if (!el) return;
  const s = statsLoad();
  const all = {
    w: s.totals.single.w + s.totals.online.w,
    l: s.totals.single.l + s.totals.online.l,
    d: s.totals.single.d + s.totals.online.d,
  };
  const allSum = statsSummary(all);

  const opponents = Object.entries(s.opponents)
    .map(([key, rec]) => ({ key, ...rec }))
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
    : `<tr><td colspan="6" class="stats-empty">아직 기록이 없습니다.</td></tr>`;

  el.innerHTML = `
    <div class="stats-name-row">
      <label for="nickInput">내 닉네임</label>
      <input id="nickInput" maxlength="12" placeholder="플레이어 1" value="${escapeHtml(statsGetName())}">
      <button data-stats-act="saveName">저장</button>
    </div>

    <div class="stats-overall">
      <div class="stats-big">
        <span class="stats-big-num">${allSum.total}</span><span class="stats-big-label">전</span>
        <span class="stats-big-num stats-w">${all.w}</span><span class="stats-big-label">승</span>
        <span class="stats-big-num stats-l">${all.l}</span><span class="stats-big-label">패</span>
        <span class="stats-big-num">${all.d}</span><span class="stats-big-label">무</span>
      </div>
      <div class="stats-sub">승률 ${allSum.rate}% · 싱글 ${s.totals.single.w}승 ${s.totals.single.l}패 · 온라인 ${s.totals.online.w}승 ${s.totals.online.l}패</div>
    </div>

    <div class="stats-section-label">상대별 전적</div>
    <table class="stats-table"><tbody>${oppRows}</tbody></table>

    <div class="stats-footer">
      <span class="stats-note">전적은 이 브라우저에만 저장됩니다. 기기나 브라우저를 바꾸면 따로 쌓입니다.</span>
      <button data-stats-act="reset">전적 초기화</button>
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
      if (btnEl.dataset.statsAct === 'reset') statsReset();
    });
  }

  const closeBtn = document.getElementById('statsCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => toggleStatsPanel(false));
});
