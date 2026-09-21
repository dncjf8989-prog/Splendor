'use strict';

// ============ 온라인 대전 (PeerJS / WebRTC, 로그인·서버 저장소 불필요) ============
// game.js가 정의하는 전역 G, render(), log(), newGame(), GEMS 등을 그대로 사용한다.
//
// 구조: 호스트가 허브 역할을 하는 스타 토폴로지.
//   게스트 ── 호스트 ── 게스트
//              └─ 게스트
// 게스트끼리는 직접 연결하지 않고, 호스트가 받은 상태를 나머지에게 중계한다.
// 덕분에 2~4인을 같은 방식으로 다룰 수 있다.
const PEER_ID_PREFIX = 'splendor-lite-';

const NET = {
  mode: 'single', // 'single' | 'online'
  role: null, // 'host' | 'guest'
  roomCode: null,
  roomSize: 2, // 방 정원 (호스트가 방을 만들 때 정한다)
  seat: null, // 내 자리 번호 (호스트는 0)
  peer: null,
  links: [], // 호스트: 게스트별 연결 목록 / 게스트: 호스트 연결 하나
  status: 'idle', // idle | creating | waiting | connecting | active | error
  errorMsg: '',
  opponents: [], // 상대 프로필 목록 - 상대전적 집계에 쓴다
  lobby: [], // 로비에 표시할 참가자 이름
};
// game.js는 window.NET으로 존재 여부를 확인하므로 전역 객체에 명시적으로 노출한다.
// (top-level const는 window의 프로퍼티가 되지 않는다.)
window.NET = NET;

function netAvailable() {
  return typeof Peer !== 'undefined';
}

function netRandomRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 혼동되는 0/O/1/I/L 제외
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ============ 상태 직렬화 ============
function netSerializeState() {
  return {
    gameId: G.gameId,
    playerCount: G.playerCount,
    winPoints: G.winPoints,
    bank: G.bank,
    tiers: G.tiers.map((t) => ({ deck: t.deck, faceUp: t.faceUp })),
    nobles: G.nobles,
    players: G.players,
    startIndex: G.startIndex,
    currentIndex: G.currentIndex,
    logs: G.logs.slice(0, 20),
    gameOver: G.gameOver,
    winnerText: G.winnerText,
  };
}

function netApplyRemoteState(state) {
  G = {
    gameId: state.gameId,
    playerCount: state.playerCount,
    winPoints: state.winPoints,
    bank: state.bank,
    tiers: state.tiers,
    nobles: state.nobles,
    players: state.players,
    startIndex: state.startIndex || 0,
    currentIndex: state.currentIndex,
    pending: [],
    discardState: null,
    nobleChoice: null,
    logs: state.logs || [],
    gameOver: !!state.gameOver,
    winnerText: state.winnerText || '',
  };
  render();
}

// ============ 프로필 ============
// 내 프로필(기기 ID + 닉네임)을 알려야 상대전적을 집계할 수 있다.
function netMyProfile() {
  if (typeof statsProfile !== 'function') return { id: 'unknown', name: '플레이어' };
  const p = statsProfile();
  return { id: p.id, name: statsMyDisplayName() };
}

// 상대가 보낸 프로필은 신뢰할 수 없으므로 형태와 길이를 다듬어 받는다.
function netSanitizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const id = typeof profile.id === 'string' ? profile.id.slice(0, 40) : '';
  const name = typeof profile.name === 'string' ? profile.name.replace(/\s+/g, ' ').trim().slice(0, 12) : '';
  if (!id) return null;
  return { id, name: name || '상대' };
}

// 자리 번호가 붙은 전체 참가자 프로필 (호스트가 만들어 게스트에게 내려준다)
function netProfileList() {
  const list = [Object.assign({ seat: 0 }, netMyProfile())];
  NET.links.forEach((link) => {
    if (link.profile) list.push(Object.assign({ seat: link.seat }, link.profile));
  });
  return list;
}

function netSetOpponentsFrom(profiles) {
  NET.opponents = (profiles || [])
    .filter((p) => p && p.seat !== NET.seat)
    .map((p) => netSanitizeProfile(p))
    .filter(Boolean);
}

// ============ 송신 ============
function netSendTo(conn, msg) {
  if (!conn || !conn.open) return;
  try {
    conn.send(msg);
  } catch (e) {
    console.error('[온라인 대전] 전송 실패', e);
  }
}

// 호스트가 모든 게스트에게 (except를 주면 그 연결만 건너뛴다)
function netBroadcast(msg, except) {
  NET.links.forEach((link) => {
    if (link.conn !== except) netSendTo(link.conn, msg);
  });
}

function netSendToHost(msg) {
  const link = NET.links[0];
  if (link) netSendTo(link.conn, msg);
}

// 채팅도 상태와 같은 경로로 오간다. 방장이면 전원에게, 게스트면 방장에게.
function netSendChat(entry) {
  const msg = { type: 'chat', seat: entry.seat, name: entry.name, text: entry.text };
  if (NET.role === 'host') netBroadcast(msg);
  else netSendToHost(msg);
}

NET.commit = function commit() {
  if (NET.mode !== 'online' || NET.status !== 'active') return;
  const msg = { type: 'state', state: netSerializeState() };
  if (NET.role === 'host') netBroadcast(msg);
  else netSendToHost(msg);
};

NET.requestNewGame = function requestNewGame() {
  if (NET.role !== 'host') {
    log('방장만 새 게임을 시작할 수 있습니다.');
    render();
    return;
  }
  netHostStartGame();
};

// ============ 호스트 ============
function netCreateRoom() {
  if (!netAvailable()) {
    NET.status = 'error';
    NET.errorMsg = '이 브라우저에서는 온라인 대전을 사용할 수 없습니다.';
    renderNetPanel();
    return;
  }
  NET.status = 'creating';
  renderNetPanel();

  const code = netRandomRoomCode();
  NET.mode = 'online';
  NET.role = 'host';
  NET.roomCode = code;
  NET.roomSize = RULES[selectedPlayerCount] ? selectedPlayerCount : 2;
  NET.seat = 0;
  NET.links = [];
  NET.opponents = [];

  const peer = new Peer(PEER_ID_PREFIX + code);
  NET.peer = peer;

  peer.on('open', () => {
    NET.status = 'waiting';
    netUpdateLobby();
  });

  peer.on('connection', (conn) => {
    conn.on('open', () => {
      // 이미 시작했거나 정원이 찼으면 받지 않는다.
      if (NET.status === 'active' || NET.links.length >= NET.roomSize - 1) {
        netSendTo(conn, { type: 'full' });
        setTimeout(() => {
          try {
            conn.close();
          } catch (e) {
            /* noop */
          }
        }, 200);
        return;
      }
      const seat = NET.links.length + 1;
      NET.links.push({ conn, seat, profile: null });
      netSendTo(conn, { type: 'welcome', seat, roomSize: NET.roomSize });
      netUpdateLobby();
    });
    conn.on('data', (msg) => netHostHandle(conn, msg));
    conn.on('close', () => netHostLinkGone(conn));
    conn.on('error', () => netHostLinkGone(conn));
  });

  peer.on('error', (err) => {
    if (err && err.type === 'unavailable-id') {
      peer.destroy();
      netCreateRoom(); // 코드 충돌 시 재시도
      return;
    }
    NET.status = 'error';
    NET.errorMsg = '방을 여는 중 오류가 발생했습니다.';
    renderNetPanel();
  });
}

function netHostHandle(conn, msg) {
  if (!msg || !msg.type) return;
  const link = NET.links.find((l) => l.conn === conn);

  if (msg.type === 'hello') {
    if (link) link.profile = netSanitizeProfile(msg.profile);
    netUpdateLobby();
    // 정원이 다 찼고 모두 프로필을 보냈으면 시작한다.
    if (NET.status === 'waiting' && NET.links.length === NET.roomSize - 1 && NET.links.every((l) => l.profile)) {
      netHostStartGame();
    }
    return;
  }

  if (msg.type === 'state') {
    // 게스트가 자기 턴을 마쳤다. 내 화면에 반영하고 나머지 게스트에게 중계한다.
    netApplyRemoteState(msg.state);
    netBroadcast({ type: 'state', state: msg.state }, conn);
    return;
  }

  if (msg.type === 'chat') {
    if (!link) return;
    // 도배 방지: 같은 사람이 너무 빠르게 보내면 흘려보낸다.
    const now = Date.now();
    if (link.lastChatAt && now - link.lastChatAt < 400) return;
    link.lastChatAt = now;
    // 보낸 사람은 연결 정보로 덮어쓴다. 게스트가 남의 이름을 사칭할 수 없다.
    const entry = {
      seat: link.seat,
      name: link.profile ? link.profile.name : '상대',
      text: msg.text,
    };
    const shown = chatReceive(entry);
    if (shown) netBroadcast({ type: 'chat', seat: shown.seat, name: shown.name, text: shown.text }, conn);
    return;
  }

  if (msg.type === 'left') {
    netHostLinkGone(conn);
  }
}

function netHostStartGame() {
  // 선공은 매 판 무작위로 정한다. 방장이 뽑아서 상태에 담아 전원에게 알리므로
  // 모두가 같은 선공을 본다 (재대결 때도 다시 뽑는다).
  newGame(NET.roomSize, Math.floor(Math.random() * NET.roomSize));
  NET.links.forEach((link) => {
    if (link.profile && G.players[link.seat]) G.players[link.seat].name = link.profile.name;
  });
  logFirstPlayer();
  NET.status = 'active';
  chatClear();
  chatSystem('대전이 시작되었습니다. 자유롭게 대화하세요.');
  const profiles = netProfileList();
  netSetOpponentsFrom(profiles);
  render();
  NET.links.forEach((link) => {
    netSendTo(link.conn, { type: 'init', seat: link.seat, state: netSerializeState(), profiles });
  });
  renderNetPanel();
}

function netHostLinkGone(conn) {
  const idx = NET.links.findIndex((l) => l.conn === conn);
  if (idx < 0) return;
  const gone = NET.links[idx];
  NET.links.splice(idx, 1);

  if (NET.status === 'active') {
    // 진행 중에 한 명이라도 빠지면 판을 이어갈 수 없다.
    netBroadcast({ type: 'peerLeft', name: gone.profile ? gone.profile.name : '상대' });
    chatSystem(`${gone.profile ? gone.profile.name : '참가자'}님의 연결이 끊어졌습니다.`);
    NET.status = 'error';
    NET.errorMsg = `${gone.profile ? gone.profile.name : '참가자'}님의 연결이 끊어져 게임을 종료합니다.`;
    netCleanupPeer();
    renderNetPanel();
    return;
  }

  // 로비에서 나간 경우에는 자리를 다시 매겨 계속 기다린다.
  NET.links.forEach((l, i) => {
    l.seat = i + 1;
    netSendTo(l.conn, { type: 'welcome', seat: l.seat, roomSize: NET.roomSize });
  });
  netUpdateLobby();
}

// ============ 게스트 ============
function netJoinRoom(rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!netAvailable()) {
    NET.status = 'error';
    NET.errorMsg = '이 브라우저에서는 온라인 대전을 사용할 수 없습니다.';
    renderNetPanel();
    return;
  }
  if (!code) {
    NET.status = 'error';
    NET.errorMsg = '방 코드를 입력해 주세요.';
    renderNetPanel();
    return;
  }
  NET.mode = 'online';
  NET.role = 'guest';
  NET.roomCode = code;
  NET.status = 'connecting';
  NET.links = [];
  NET.opponents = [];
  renderNetPanel();

  const peer = new Peer();
  NET.peer = peer;

  peer.on('open', () => {
    const conn = peer.connect(PEER_ID_PREFIX + code, { reliable: true });
    NET.links = [{ conn, seat: null, profile: null }];
    conn.on('open', () => netSendTo(conn, { type: 'hello', profile: netMyProfile() }));
    conn.on('data', netGuestHandle);
    conn.on('close', netGuestHostGone);
    conn.on('error', netGuestHostGone);
  });

  peer.on('error', (err) => {
    if (err && err.type === 'peer-unavailable') {
      NET.status = 'error';
      NET.errorMsg = '존재하지 않는 방 코드입니다.';
    } else {
      NET.status = 'error';
      NET.errorMsg = '연결 중 오류가 발생했습니다.';
    }
    renderNetPanel();
  });
}

function netGuestHandle(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'welcome') {
    NET.seat = msg.seat;
    NET.roomSize = msg.roomSize;
    NET.status = 'waiting';
    renderNetPanel();
    return;
  }

  if (msg.type === 'lobby') {
    NET.lobby = Array.isArray(msg.names) ? msg.names.slice(0, 4).map((n) => String(n).slice(0, 12)) : [];
    NET.roomSize = msg.roomSize || NET.roomSize;
    renderNetPanel();
    return;
  }

  if (msg.type === 'init') {
    NET.seat = msg.seat;
    NET.status = 'active';
    chatClear();
    chatSystem('대전이 시작되었습니다. 자유롭게 대화하세요.');
    netSetOpponentsFrom(msg.profiles);
    netApplyRemoteState(msg.state);
    renderNetPanel();
    return;
  }

  if (msg.type === 'state') {
    netApplyRemoteState(msg.state);
    return;
  }

  if (msg.type === 'chat') {
    chatReceive(msg);
    return;
  }

  if (msg.type === 'full') {
    NET.status = 'error';
    NET.errorMsg = '방이 가득 찼습니다.';
    netCleanupPeer();
    renderNetPanel();
    return;
  }

  if (msg.type === 'peerLeft') {
    chatSystem(`${msg.name || '참가자'}님의 연결이 끊어졌습니다.`);
    NET.status = 'error';
    NET.errorMsg = `${msg.name || '참가자'}님의 연결이 끊어져 게임을 종료합니다.`;
    netCleanupPeer();
    renderNetPanel();
  }
}

function netGuestHostGone() {
  if (NET.mode !== 'online' || NET.status === 'error' || NET.status === 'idle') return;
  chatSystem('방장과의 연결이 끊어졌습니다.');
  NET.status = 'error';
  NET.errorMsg = '방장과의 연결이 끊어졌습니다.';
  netCleanupPeer();
  renderNetPanel();
}

// ============ 로비 ============
function netUpdateLobby() {
  if (NET.role !== 'host') return;
  const names = [netMyProfile().name].concat(NET.links.map((l) => (l.profile ? l.profile.name : '접속 중...')));
  NET.lobby = names;
  netBroadcast({ type: 'lobby', names, roomSize: NET.roomSize });
  renderNetPanel();
}

// ============ 정리 ============
function netCleanupPeer() {
  NET.links.forEach((link) => {
    try {
      link.conn.close();
    } catch (e) {
      /* noop */
    }
  });
  NET.links = [];
  if (NET.peer) {
    try {
      NET.peer.destroy();
    } catch (e) {
      /* noop */
    }
    NET.peer = null;
  }
  NET.role = null;
  NET.roomCode = null;
  NET.seat = null;
  NET.opponents = [];
  NET.lobby = [];
}

// 대전 중에 나가면 그 판은 패배로 남는다. 나가기 전에 한 번 묻는다.
// 로비에서 나가거나 판이 이미 끝났으면 그냥 나간다.
function netLeavingCostsGame() {
  return NET.mode === 'online' && NET.status === 'active' && G && !G.gameOver;
}

function netLeaveRequested() {
  if (!netLeavingCostsGame()) {
    netLeaveRoom();
    return;
  }
  askConfirm({
    title: '대전에서 나가시겠습니까?',
    body: '진행 중인 판은 패배로 기록됩니다.',
    okLabel: '나가기 (패배 처리)',
    onOk: () => {
      statsRecordForfeit();
      netLeaveRoom();
    },
  });
}

function netLeaveRoom() {
  if (NET.role === 'host') netBroadcast({ type: 'peerLeft', name: netMyProfile().name });
  else netSendToHost({ type: 'left' });
  netCleanupPeer();
  NET.status = 'idle';
  NET.errorMsg = '';
  chatClear();
  renderNetPanel();
}

function netRetry() {
  netCleanupPeer();
  NET.status = 'idle';
  NET.errorMsg = '';
  chatClear();
  renderNetPanel();
}

function netSwitchMode(mode) {
  if (mode === NET.mode) return;
  // 대전 중에 싱글로 넘어가는 것도 나가는 것과 같다. 똑같이 묻는다.
  if (mode === 'single' && netLeavingCostsGame()) {
    askConfirm({
      title: '싱글 플레이로 넘어가시겠습니까?',
      body: '진행 중인 대전은 패배로 기록됩니다.',
      okLabel: '넘어가기 (패배 처리)',
      onOk: () => {
        statsRecordForfeit();
        netApplyMode(mode);
      },
    });
    return;
  }
  netApplyMode(mode);
}

function netApplyMode(mode) {
  if (window.AI) clearTimeout(AI.timer);
  if (mode === 'single') {
    if (NET.mode === 'online') netLeaveRoom();
    NET.mode = 'single';
    newGame();
  } else {
    NET.mode = 'online';
    NET.status = 'idle';
    newGame(selectedPlayerCount);
  }
  renderNetPanel();
  updateModeTabs();
}

// ============ 렌더링 ============
function updateModeTabs() {
  const singleBtn = document.getElementById('modeSingleBtn');
  const onlineBtn = document.getElementById('modeOnlineBtn');
  if (!singleBtn || !onlineBtn) return;
  singleBtn.classList.toggle('active', NET.mode === 'single');
  onlineBtn.classList.toggle('active', NET.mode === 'online');
  const gameArea = document.getElementById('gameArea');
  const netPanel = document.getElementById('netPanel');
  if (NET.mode === 'single') {
    gameArea.hidden = false;
    netPanel.hidden = true;
  } else {
    netPanel.hidden = false;
    gameArea.hidden = NET.status !== 'active';
  }
  updateCountPicker();
  updateNewGameButton();
}

// 인원은 싱글 플레이에서, 그리고 온라인에서는 방을 만들기 전에만 고를 수 있다.
function updateCountPicker() {
  const picker = document.getElementById('countPicker');
  if (!picker) return;
  const locked = NET.mode === 'online' && NET.status !== 'idle';
  picker.classList.toggle('locked', locked);
  picker.title = locked ? '방을 만든 뒤에는 인원을 바꿀 수 없습니다' : '';
  const shown = NET.mode === 'online' ? NET.roomSize : currentPlayerCount();
  picker.querySelectorAll('[data-count]').forEach((btn) => {
    btn.disabled = locked;
    btn.classList.toggle('active', Number(btn.dataset.count) === shown);
  });
}

function updateNewGameButton() {
  const btn = document.getElementById('newGameBtn');
  if (!btn) return;
  if (NET.mode === 'online') {
    btn.textContent = '재대결';
    btn.disabled = !(NET.status === 'active' && NET.role === 'host');
  } else {
    btn.textContent = '새 게임';
    btn.disabled = false;
  }
}

function renderNetPanel() {
  renderNetPanelBody();
  renderChat();
}

function renderNetPanelBody() {
  const el = document.getElementById('netPanel');
  if (!el) return;
  updateModeTabs();
  if (NET.mode !== 'online') {
    el.innerHTML = '';
    return;
  }

  if (!netAvailable()) {
    el.innerHTML = `<div class="net-box net-warn">
      이 화면에서는 온라인 대전을 사용할 수 없습니다. (온라인 대전용 스크립트를 불러오지 못했습니다)
      <br><button data-net-act="toSingle">싱글 플레이로 돌아가기</button>
    </div>`;
    return;
  }

  if (NET.status === 'idle') {
    el.innerHTML = `<div class="net-box">
      <div class="net-row">
        <button data-net-act="create">${selectedPlayerCount}인 방 만들기</button>
        <span class="net-or">또는</span>
        <input id="joinCodeInput" maxlength="4" placeholder="방 코드 4자리" autocomplete="off">
        <button data-net-act="join">참가하기</button>
      </div>
      <div class="net-sub">방 인원은 위의 "인원"에서 고른 뒤 방을 만들어 주세요.</div>
    </div>`;
    return;
  }

  if (NET.status === 'creating' || NET.status === 'connecting') {
    el.innerHTML = `<div class="net-box">${NET.status === 'creating' ? '방을 만드는 중...' : '연결하는 중...'}</div>`;
    return;
  }

  if (NET.status === 'error') {
    el.innerHTML = `<div class="net-box net-warn">
      ${escapeHtml(NET.errorMsg)}
      <br><button data-net-act="retry">다시 시도</button>
    </div>`;
    return;
  }

  if (NET.status === 'waiting') {
    const joined = NET.lobby.length || 1;
    const roster = NET.lobby.length
      ? `<div class="lobby-list">${NET.lobby.map((n) => `<span class="lobby-chip">${escapeHtml(n)}</span>`).join('')}</div>`
      : '';
    if (NET.role === 'host') {
      el.innerHTML = `<div class="net-box">
        <div class="room-code-label">방 코드</div>
        <div class="room-code">${NET.roomCode}</div>
        ${roster}
        <div class="net-sub">${joined} / ${NET.roomSize}명 참가 · 이 코드를 상대에게 알려주세요.</div>
        <button data-net-act="leave">방 나가기</button>
      </div>`;
    } else {
      el.innerHTML = `<div class="net-box">
        <div class="room-code-label">방 코드 ${NET.roomCode}</div>
        ${roster}
        <div class="net-sub">${joined} / ${NET.roomSize}명 참가 · 방장이 시작하기를 기다리는 중...</div>
        <button data-net-act="leave">방 나가기</button>
      </div>`;
    }
    return;
  }

  if (NET.status === 'active') {
    const roleLabel = NET.role === 'host' ? '방장' : '참가자';
    el.innerHTML = `<div class="net-strip">
      온라인 ${NET.roomSize}인 대전 · 방 코드 <strong>${NET.roomCode}</strong> · 나: 플레이어 ${NET.seat + 1} (${roleLabel})
      <button class="net-leave" data-net-act="leave">나가기</button>
    </div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modeSingleBtn').addEventListener('click', () => netSwitchMode('single'));
  document.getElementById('modeOnlineBtn').addEventListener('click', () => netSwitchMode('online'));

  document.getElementById('countPicker').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-count]');
    if (!btn || btn.disabled) return;
    selectedPlayerCount = Number(btn.dataset.count);
    if (NET.mode === 'online') {
      NET.roomSize = selectedPlayerCount;
      renderNetPanel();
    } else {
      newGame(selectedPlayerCount);
    }
    updateModeTabs();
  });

  document.getElementById('netPanel').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-net-act]');
    if (!btn) return;
    const act = btn.dataset.netAct;
    if (act === 'create') netCreateRoom();
    if (act === 'join') {
      const input = document.getElementById('joinCodeInput');
      netJoinRoom(input ? input.value : '');
    }
    if (act === 'leave') netLeaveRequested();
    if (act === 'retry') netRetry();
    if (act === 'toSingle') netSwitchMode('single');
  });

  document.getElementById('netPanel').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.id === 'joinCodeInput') {
      netJoinRoom(e.target.value);
    }
  });

  updateModeTabs();
});
