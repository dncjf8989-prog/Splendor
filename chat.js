'use strict';

// ============ 온라인 대전 채팅 ============
// 메시지는 게임 상태와 같은 경로(방장 허브 중계)로 오간다.
// 다만 채팅은 게임 상태(G)에 넣지 않는다. G는 턴마다 통째로 덮어써지므로
// 채팅을 넣으면 동기화될 때마다 날아가기 때문이다. 각자 자기 기록을 들고 있는다.

const CHAT = {
  messages: [],
  max: 60, // 화면에 남겨두는 최대 줄 수
  maxLen: 120, // 한 줄 최대 길이
};
window.CHAT = CHAT;

// 방에 들어와 있으면(대기방 포함) 채팅할 수 있다.
function chatAvailable() {
  if (!window.NET || NET.mode !== 'online') return false;
  return NET.status === 'waiting' || NET.status === 'active';
}

function chatClean(text) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u001f\u007f]/g, ' ') // 제어문자 제거
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT.maxLen);
}

function chatAppend(entry) {
  CHAT.messages.push(entry);
  if (CHAT.messages.length > CHAT.max) CHAT.messages.splice(0, CHAT.messages.length - CHAT.max);
  renderChat();
}

function chatSystem(text) {
  chatAppend({ system: true, text: chatClean(text) });
}

function chatClear() {
  CHAT.messages = [];
  renderChat();
}

// 내가 보내기
function chatSend(raw) {
  if (!chatAvailable()) return;
  const text = chatClean(raw);
  if (!text) return;
  const entry = { seat: NET.seat, name: chatMyName(), text };
  chatAppend(entry);
  netSendChat(entry);
}

function chatMyName() {
  // 대기방에서는 아직 자리 이름이 정해지지 않았으므로 닉네임을 쓴다.
  if (NET.status === 'active' && G && G.players && G.players[NET.seat]) return G.players[NET.seat].name;
  return typeof statsMyDisplayName === 'function' ? statsMyDisplayName() : '나';
}

// 남에게서 받은 메시지 (보낸 사람 정보는 신뢰하지 않고 다듬어 쓴다)
function chatReceive(entry) {
  const text = chatClean(entry && entry.text);
  if (!text) return null;
  const clean = {
    seat: Number.isInteger(entry.seat) ? entry.seat : null,
    name: chatClean(entry.name).slice(0, 12) || '상대',
    text,
  };
  chatAppend(clean);
  return clean;
}

// ============ 렌더링 ============
function renderChat() {
  const panel = document.getElementById('chatPanel');
  const listEl = document.getElementById('chatLog');
  if (!panel || !listEl) return;

  const online = !!(window.NET && NET.mode === 'online');
  panel.hidden = !online;
  if (!online) return;

  const mySeat = NET.seat;
  listEl.innerHTML = CHAT.messages
    .map((m) => {
      if (m.system) return `<li class="chat-system">${escapeHtml(m.text)}</li>`;
      const mine = m.seat === mySeat ? ' chat-mine' : '';
      return `<li class="chat-line${mine}"><span class="chat-name">${escapeHtml(m.name)}</span>${escapeHtml(m.text)}</li>`;
    })
    .join('');
  listEl.scrollTop = listEl.scrollHeight;

  const input = document.getElementById('chatInput');
  const btn = document.getElementById('chatSendBtn');
  const usable = chatAvailable();
  if (input) {
    input.disabled = !usable;
    input.placeholder = usable ? '메시지를 입력하세요' : '대전에 참여하면 채팅할 수 있습니다';
  }
  if (btn) btn.disabled = !usable;
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('chatSendBtn');

  const send = () => {
    if (!input) return;
    chatSend(input.value);
    input.value = '';
    input.focus();
  };

  if (btn) btn.addEventListener('click', send);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
  }
  renderChat();
});
