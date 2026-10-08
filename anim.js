'use strict';

// ============ 카드가 날아가는 모션 ============
// 보드만 보고 있으면 상대가 어떤 카드를 가져갔는지 알기 어렵다. 한 장이
// 보드에서 그 사람 자리로 날아가게 해서 눈으로 따라갈 수 있게 한다.
//
// 무엇이 움직였는지는 G.lastAction에 들어 있고, 그 값은 상태와 함께
// 전달되므로 상대 화면에서도 똑같이 보인다. 번호(no)로 같은 행동을 두 번
// 그리지 않는다.

const ANIM = { shown: 0, ms: 620 };
window.ANIM = ANIM;

// 이미 지나간 행동은 띄우지 않는다. 방에 처음 들어왔을 때처럼 "과거의 한 수"를
// 받아든 경우에 쓴다.
//
// 상태를 적용하기 "전에" 불러야 한다. netApplyRemoteState가 안에서 render()를
// 부르므로, 적용한 뒤에 부르면 이미 날아간 뒤다.
function animSkipTo(no) {
  ANIM.shown = Number.isFinite(no) ? no : 0;
}

// 지금 들고 있는 상태를 기준으로 맞춘다 (이미 적용한 뒤에 쓰는 보조 수단)
function animCatchUp() {
  animSkipTo(G && G.lastAction ? G.lastAction.no || 0 : 0);
}

function animCenter(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

// 보드에서 그 카드가 있던 칸. 이미 새 카드로 바뀌었지만 자리는 그대로다.
function animSourceEl(a) {
  if (a.kind === 'buyReserved') return null; // 예약해둔 카드는 자기 자리에서 나간다
  const tier = document.getElementById('tier' + ((a.tier || 0) + 1));
  const row = tier && tier.querySelector('.tier-cards');
  return row ? row.children[a.idx] || null : null;
}

function animTargetEl(a) {
  return document.querySelector(`.player-panel[data-seat="${a.seat}"]`);
}

function animMaybePlay() {
  if (!G || !G.lastAction) return;
  const a = G.lastAction;
  if (!a.no || a.no <= ANIM.shown) return;
  ANIM.shown = a.no;
  // 보이지 않는 탭에서는 그릴 필요가 없다 (돌아왔을 때 뒤늦게 날아가면 더 헷갈린다)
  if (typeof document.hidden === 'boolean' && document.hidden) return;
  try {
    animFly(a);
  } catch (e) {
    /* 모션은 거들 뿐이다. 실패해도 판은 그대로 돌아간다 */
  }
}

function animFly(a) {
  const target = animTargetEl(a);
  if (!target) return;
  animPulse(target);

  const src = animSourceEl(a);
  if (!src || !a.card) return; // 출발점을 못 찾으면 깜빡임만 준다

  const from = animCenter(src);
  const to = animCenter(target);

  const ghost = document.createElement('div');
  ghost.className = 'fly-card card-tile gem-border-' + a.card.gem;
  ghost.innerHTML = `
    <div class="card-top">
      <span class="card-points">${a.card.points > 0 ? a.card.points : ''}</span>
      <span class="card-gem gem-${a.card.gem}"></span>
    </div>
    <div class="card-cost">${typeof renderCostIcons === 'function' ? renderCostIcons(a.card.cost) : ''}</div>`;
  ghost.style.width = from.w + 'px';
  ghost.style.minHeight = from.h + 'px';
  ghost.style.left = from.x - from.w / 2 + 'px';
  ghost.style.top = from.y - from.h / 2 + 'px';
  document.body.appendChild(ghost);

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // 다음 프레임에 옮겨야 출발 위치가 한 번 그려진다
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${dx}px, ${dy}px) scale(0.3)`;
      ghost.style.opacity = '0';
    });
  });
  setTimeout(() => {
    if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
  }, ANIM.ms + 120);
}

// 누구에게 갔는지 자리도 한 번 깜빡여 준다.
function animPulse(el) {
  el.classList.remove('panel-got');
  void el.offsetWidth; // 애니메이션을 다시 돌리려면 한 번 끊어줘야 한다
  el.classList.add('panel-got');
  setTimeout(() => el.classList.remove('panel-got'), 900);
}
