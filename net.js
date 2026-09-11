'use strict';

// ============ 온라인 대전 (PeerJS / WebRTC, 로그인·서버 저장소 불필요) ============
// game.js가 정의하는 전역 G, render(), log(), newGame(), GEMS 등을 그대로 사용한다.
// PeerJS의 무료 공개 시그널링 서버로 두 브라우저가 서로를 찾아 연결하면,
// 이후 게임 상태는 두 브라우저 사이에 직접(P2P) 오간다 — 클로드 로그인이나
// 별도 서버가 필요 없어 링크만 있으면 누구나 접속할 수 있다.
const PEER_ID_PREFIX = 'splendor-lite-';

const NET = {
  mode: 'local', // 'local' | 'online'
  role: null, // 'host' | 'guest'
  roomCode: null,
  seat: null, // 0 또는 1
  peer: null,
  conn: null,
  status: 'idle', // idle | creating | waiting | connecting | active | error
  errorMsg: '',
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
    bank: G.bank,
    tiers: G.tiers.map((t) => ({ deck: t.deck, faceUp: t.faceUp })),
    nobles: G.nobles,
    players: G.players,
    currentIndex: G.currentIndex,
    logs: G.logs.slice(0, 20),
    gameOver: G.gameOver,
    winnerText: G.winnerText,
  };
}

function netApplyRemoteState(state) {
  G = {
    bank: state.bank,
    tiers: state.tiers,
    nobles: state.nobles,
    players: state.players,
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

function netSend(msg) {
  if (NET.conn && NET.conn.open) {
    try {
      NET.conn.send(msg);
    } catch (e) {
      console.error('[온라인 대전] 전송 실패', e);
    }
  }
}

NET.commit = function commit() {
  if (NET.mode !== 'online' || NET.status !== 'active') return;
  netSend({ type: 'state', state: netSerializeState() });
};

NET.requestNewGame = function requestNewGame() {
  if (NET.role !== 'host') {
    log('방장만 새 게임을 시작할 수 있습니다.');
    render();
    return;
  }
  newGame();
  NET.commit();
};

// ============ 메시지 처리 ============
function netHandleMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'init') {
    NET.seat = msg.seat;
    NET.status = 'active';
    netApplyRemoteState(msg.state);
    renderNetPanel();
    return;
  }
  if (msg.type === 'state') {
    netApplyRemoteState(msg.state);
    return;
  }
  if (msg.type === 'left') {
    NET.status = 'error';
    NET.errorMsg = '상대방이 방을 나갔습니다.';
    netCleanupPeer();
    renderNetPanel();
  }
}

function netSetupConn(conn) {
  NET.conn = conn;
  conn.on('data', netHandleMessage);
  conn.on('close', netHandlePeerGone);
  conn.on('error', netHandlePeerGone);
}

function netHandlePeerGone() {
  if (NET.mode !== 'online' || NET.status === 'error' || NET.status === 'idle') return;
  NET.status = 'error';
  NET.errorMsg = '상대방과의 연결이 끊어졌습니다.';
  renderNetPanel();
}

// ============ 방 생성 / 참가 ============
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
  NET.seat = 0;

  const peer = new Peer(PEER_ID_PREFIX + code);
  NET.peer = peer;

  peer.on('open', () => {
    NET.status = 'waiting';
    renderNetPanel();
  });

  peer.on('connection', (conn) => {
    netSetupConn(conn);
    conn.on('open', () => {
      newGame();
      NET.status = 'active';
      netSend({ type: 'init', seat: 1, state: netSerializeState() });
      renderNetPanel();
    });
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
  renderNetPanel();

  const peer = new Peer();
  NET.peer = peer;

  peer.on('open', () => {
    const conn = peer.connect(PEER_ID_PREFIX + code, { reliable: true });
    netSetupConn(conn);
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

function netCleanupPeer() {
  if (NET.conn) {
    try {
      NET.conn.close();
    } catch (e) {
      /* noop */
    }
    NET.conn = null;
  }
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
}

function netLeaveRoom() {
  netSend({ type: 'left' });
  netCleanupPeer();
  NET.status = 'idle';
  NET.errorMsg = '';
  renderNetPanel();
}

function netRetry() {
  netCleanupPeer();
  NET.status = 'idle';
  NET.errorMsg = '';
  renderNetPanel();
}

function netSwitchMode(mode) {
  if (mode === NET.mode) return;
  if (mode === 'local') {
    if (NET.mode === 'online') netLeaveRoom();
    NET.mode = 'local';
    if (!G) newGame();
    else render();
  } else {
    NET.mode = 'online';
    NET.status = 'idle';
    render();
  }
  renderNetPanel();
  updateModeTabs();
}

// ============ 렌더링 ============
function updateModeTabs() {
  const localBtn = document.getElementById('modeLocalBtn');
  const onlineBtn = document.getElementById('modeOnlineBtn');
  if (!localBtn || !onlineBtn) return;
  localBtn.classList.toggle('active', NET.mode === 'local');
  onlineBtn.classList.toggle('active', NET.mode === 'online');
  const gameArea = document.getElementById('gameArea');
  const netPanel = document.getElementById('netPanel');
  if (NET.mode === 'local') {
    gameArea.hidden = false;
    netPanel.hidden = true;
  } else {
    netPanel.hidden = false;
    gameArea.hidden = NET.status !== 'active';
  }
  updateNewGameButton();
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
      <br><button data-net-act="toLocal">로컬 플레이로 돌아가기</button>
    </div>`;
    return;
  }

  if (NET.status === 'idle') {
    el.innerHTML = `<div class="net-box">
      <div class="net-row">
        <button data-net-act="create">방 만들기</button>
        <span class="net-or">또는</span>
        <input id="joinCodeInput" maxlength="4" placeholder="방 코드 4자리" autocomplete="off">
        <button data-net-act="join">참가하기</button>
      </div>
    </div>`;
    return;
  }

  if (NET.status === 'creating' || NET.status === 'connecting') {
    el.innerHTML = `<div class="net-box">${NET.status === 'creating' ? '방을 만드는 중...' : '연결하는 중...'}</div>`;
    return;
  }

  if (NET.status === 'error') {
    el.innerHTML = `<div class="net-box net-warn">
      ${NET.errorMsg}
      <br><button data-net-act="retry">다시 시도</button>
    </div>`;
    return;
  }

  if (NET.status === 'waiting') {
    el.innerHTML = `<div class="net-box">
      <div class="room-code-label">방 코드</div>
      <div class="room-code">${NET.roomCode}</div>
      <div class="net-sub">이 코드를 상대방에게 알려주세요. 상대방을 기다리는 중...</div>
      <button data-net-act="leave">방 나가기</button>
    </div>`;
    return;
  }

  if (NET.status === 'active') {
    const roleLabel = NET.role === 'host' ? '호스트' : '게스트';
    el.innerHTML = `<div class="net-strip">
      온라인 대전 · 방 코드 <strong>${NET.roomCode}</strong> · 나: 플레이어 ${NET.seat + 1} (${roleLabel})
      <button class="net-leave" data-net-act="leave">나가기</button>
    </div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modeLocalBtn').addEventListener('click', () => netSwitchMode('local'));
  document.getElementById('modeOnlineBtn').addEventListener('click', () => netSwitchMode('online'));

  document.getElementById('netPanel').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-net-act]');
    if (!btn) return;
    const act = btn.dataset.netAct;
    if (act === 'create') netCreateRoom();
    if (act === 'join') {
      const input = document.getElementById('joinCodeInput');
      netJoinRoom(input ? input.value : '');
    }
    if (act === 'leave') netLeaveRoom();
    if (act === 'retry') netRetry();
    if (act === 'toLocal') netSwitchMode('local');
  });

  document.getElementById('netPanel').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.id === 'joinCodeInput') {
      netJoinRoom(e.target.value);
    }
  });

  updateModeTabs();
});
