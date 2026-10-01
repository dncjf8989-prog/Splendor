'use strict';

// ============ 저채도 모드 ============
// 사무실에서 하다 보면 화면이 알록달록해서 멀리서도 눈에 띈다. 넓은 색면과
// 둥근 모서리를 걷어내고 표처럼 보이게 바꾼다. 색이 곧 정보인 보석 점은
// 지우지 않고 톤만 낮춘다. 그래야 멀리서 안 보이면서 본인은 둘 수 있다.
//
// 실제 색은 style.css의 :root[data-quiet] 블록에 있다. 여기서는 그 표시를
// 붙였다 떼는 일만 한다.

const QUIET_KEY = 'splendorLiteQuiet';
const QUIET_TITLE = '분기_집계_v3.xlsx';
const GAME_TITLE = '스플렌더 라이트';

let QUIET_ON = false;

function quietLoad() {
  try {
    return localStorage.getItem(QUIET_KEY) === '1';
  } catch (e) {
    return false; // 저장이 막힌 환경에서는 평소 색으로 둔다
  }
}

function quietSave(on) {
  try {
    if (on) localStorage.setItem(QUIET_KEY, '1');
    else localStorage.removeItem(QUIET_KEY);
  } catch (e) {
    /* 저장이 막혀도 이번 세션에서는 동작한다 */
  }
}

function quietApply(on) {
  QUIET_ON = !!on;
  const root = document.documentElement;
  if (QUIET_ON) root.setAttribute('data-quiet', '1');
  else root.removeAttribute('data-quiet');

  // 제목이 가장 멀리서도 읽힌다. 켜면 같이 바꾼다.
  const title = document.getElementById('appTitle');
  if (title) title.textContent = QUIET_ON ? QUIET_TITLE : GAME_TITLE;
  document.title = QUIET_ON ? QUIET_TITLE : GAME_TITLE;

  const btn = document.getElementById('quietBtn');
  if (btn) {
    btn.textContent = QUIET_ON ? '색 복구' : '저채도';
    btn.setAttribute('aria-pressed', QUIET_ON ? 'true' : 'false');
    btn.title = QUIET_ON ? '평소 색으로 되돌립니다' : '화면을 표처럼 바꿔 눈에 덜 띄게 합니다';
  }
}

function quietToggle() {
  quietApply(!QUIET_ON);
  quietSave(QUIET_ON);
}

// 이 파일은 markup 뒤에서 읽히므로 버튼과 제목이 이미 있다. 바로 적용해서
// 켜둔 사람에게 평소 색이 한 번 번쩍이지 않게 한다.
quietApply(quietLoad());
(function quietBind() {
  const btn = document.getElementById('quietBtn');
  if (btn) btn.addEventListener('click', quietToggle);
})();
