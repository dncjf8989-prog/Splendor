'use strict';

// ============ 업데이트 공지 ============
// 규칙이 바뀌었는데 모르고 들어오면 "왜 갑자기 다르지?" 하게 된다.
// 들어올 때마다 띄운다. '다시 보지 않기'를 체크하고 닫은 사람에게만 안 띄운다.
// 체크를 풀고 닫으면 다시 띄운다. 언제든 헤더의 '공지' 버튼으로 열 수 있다.
// NOTICE_VERSION을 바꾸면 체크해 둔 사람에게도 다시 한 번 뜬다.

const NOTICE_KEY = 'splendorLiteNoticeSeen';
const NOTICE_VERSION = '2026-10-01c';

const NOTICE = {
  title: '바뀐 점 안내',
  date: '2026년 10월 1일',
  groups: [
    {
      heading: '저채도 모드 (새로 생김)',
      lines: [
        '오른쪽 위 <b>저채도</b> 버튼을 누르면 화면이 회색 표처럼 바뀝니다. 멀리서 보면 게임이 아니라 문서로 보입니다.',
        '보석 색은 지우지 않고 톤만 낮췄습니다. <b>가까이서는 평소대로 둘 수 있습니다.</b>',
        '켜면 브라우저 탭 이름도 파일 이름처럼 바뀝니다. <b>색 복구</b>를 누르면 원래대로 돌아오고, 켠 상태는 저장됩니다.',
      ],
    },
    {
      heading: '승리 점수',
      lines: [
        '2인 <b>21점</b> · 3인 <b>17점</b> · 4인 <b>15점</b>',
        '사람이 많을수록 한 바퀴가 길어져, 인원이 늘수록 목표를 낮췄습니다.',
      ],
    },
    {
      heading: '대전 중 나가기',
      lines: [
        '진행 중에 나가면 <b>그 판은 패배로 기록</b>됩니다. 창을 그냥 닫아도 같습니다.',
        '3인 이상은 한 명이 나가도 <b>남은 사람끼리 끝까지</b> 둡니다. 나간 자리는 건너뛰고, 그 사람이 들고 있던 토큰은 은행으로 돌아옵니다.',
      ],
    },
    {
      heading: '전적과 랭킹',
      lines: [
        '판이 끝나면 그 판이 자동으로 기록되어 <b>전체 랭킹</b>에 반영됩니다. 상대가 접속해 있지 않아도 보입니다.',
        '랭킹은 <b>승률 / 최다승 / 판수</b>로 볼 수 있고, 인원수별로 나눠 집계합니다.',
      ],
    },
    {
      heading: '화면',
      lines: [
        '보유 토큰을 <b>(9/10)</b> 처럼 한도와 함께 보여줍니다.',
        '각자 <b>몇 번째 차례</b>인지 표시하고, 그 바퀴의 마지막 사람을 강조합니다. 마지막 사람이 두고 나야 판이 끝나기 때문입니다.',
      ],
    },
    {
      heading: '이 공지',
      lines: [
        '들어올 때마다 뜹니다. 아래 <b>다시 보지 않기</b>를 체크하고 닫으면 그만 뜹니다.',
        '그만 뜨게 해두었더라도 오른쪽 위 <b>공지</b> 버튼을 누르면 언제든 다시 볼 수 있습니다. 게임 중에 열었다 닫아도 두던 판은 그대로입니다.',
      ],
    },
    {
      heading: '카드',
      lines: ['티어1·2·3 모두 <b>시중 스플렌더 카드와 같은 구성</b>입니다. (40 / 30 / 20장)'],
    },
  ],
};

function noticeSeen() {
  try {
    return localStorage.getItem(NOTICE_KEY);
  } catch (e) {
    return NOTICE_VERSION; // 저장이 막힌 환경에서는 띄우지 않는다
  }
}

function noticeMarkSeen() {
  try {
    localStorage.setItem(NOTICE_KEY, NOTICE_VERSION);
  } catch (e) {
    /* 사생활 보호 모드 등에서 저장이 막혀도 그냥 넘어간다 */
  }
}

// 체크를 풀고 닫으면 다시 띄워야 한다.
function noticeClearSeen() {
  try {
    localStorage.removeItem(NOTICE_KEY);
  } catch (e) {
    /* 위와 같다 */
  }
}

// 이번 접속에서 공지를 이미 닫았는가. 체크를 안 하고 닫은 사람에게는
// 다음 접속에 또 띄워야 하지만, 지금 이 화면까지 가리고 있으면 안 된다.
let noticeDone = false;

// 지금 화면을 가리고 띄워야 할 공지가 있는가. 시작 화면을 띄울지 정할 때 쓴다.
function noticePending() {
  return !noticeDone && noticeSeen() !== NOTICE_VERSION;
}

function noticeHtml() {
  const body = NOTICE.groups
    .map(
      (g) => `<div class="notice-group">
        <h3>${g.heading}</h3>
        <ul>${g.lines.map((t) => `<li>${t}</li>`).join('')}</ul>
      </div>`
    )
    .join('');
  return `<div class="notice-head">
      <h2>${NOTICE.title}</h2>
      <span class="notice-date">${NOTICE.date}</span>
    </div>
    ${body}
    <div class="notice-foot">
      <label id="noticeSkip"><input type="checkbox" id="noticeSkipBox"${noticeSeen() === NOTICE_VERSION ? ' checked' : ''}> 다시 보지 않기</label>
      <button id="noticeCloseBtn" type="button">확인했습니다</button>
    </div>`;
}

function toggleNotice(show) {
  const overlay = document.getElementById('noticeOverlay');
  if (!overlay) return;
  if (show) {
    const box = document.getElementById('noticeBox');
    if (box) box.innerHTML = noticeHtml();
  }
  overlay.classList.toggle('hidden', !show);
}

function closeNotice() {
  // 체크했으면 그만 띄우고, 안 했으면 다음에 또 띄운다.
  const box = document.getElementById('noticeSkipBox');
  if (box && box.checked) noticeMarkSeen();
  else noticeClearSeen();
  noticeDone = true;
  toggleNotice(false);
  // 공지를 닫으면 시작 화면이 뜬다. 판은 싱글/온라인을 고를 때 시작된다.
  if (typeof updateModeTabs === 'function') updateModeTabs();
}

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('noticeOverlay');
  if (!overlay) return;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeNotice(); // 바깥을 눌러도 닫힌다
    if (e.target && e.target.id === 'noticeCloseBtn') closeNotice();
  });

  // 헤더의 '공지' 버튼으로 언제든 다시 볼 수 있다.
  const btn = document.getElementById('noticeBtn');
  if (btn) btn.addEventListener('click', () => toggleNotice(true));

  if (noticePending()) toggleNotice(true);
});
