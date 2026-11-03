'use strict';

// ============ 스플렌더 듀얼 카드 데이터 ============
//
// !! 임시 카드 세트입니다. 실제 상자에 든 카드와 다릅니다. !!
//
// 규칙서와 실제 카드 목록을 이 세션에서 열 수 없어서, 구조(3단계 피라미드, 보너스 색,
// 점수, 왕관, 진주 비용, 카드 능력, 와일드 카드)만 맞추고 숫자는 자동 대국으로
// 맞춘 것입니다. 실제 카드 목록을 알려 주시면 이 파일의 c(...) 줄만 바꾸면 됩니다.
// 엔진과 화면은 이 데이터를 읽기만 하므로 다른 곳은 고칠 필요가 없습니다.
//
// c(단계, 보너스 색, 점수, 왕관, 비용, 능력)
//   보너스 색 : white blue green red black, 또는 'wild'(이미 가진 카드의 색을 따른다)
//   비용      : { white:n, blue:n, green:n, red:n, black:n, pearl:n }
//   능력      : null | 'replay'(한 번 더) | 'token'(판에서 같은 색 보석 1개)
//               | 'scroll'(특권 받기) | 'steal'(상대의 보석/진주 1개)
//   id는 아래 나열 순서대로 매겨지므로 모든 기기에서 같은 파일을 써야 한다.

const DUEL_CARDS = [];
function c(lv, bonus, pts, crowns, cost, power) {
  DUEL_CARDS.push({ id: DUEL_CARDS.length, lv, bonus, pts, crowns, cost, power: power || null });
}

c(1, 'white', 0, 0, { blue: 1, green: 1, red: 1 }, null);
c(1, 'white', 0, 0, { blue: 2, green: 1 }, 'token');
c(1, 'white', 0, 0, { green: 2, red: 2 }, null);
c(1, 'white', 1, 0, { blue: 2, pearl: 1 }, null);
c(1, 'white', 1, 0, { red: 3, blue: 1 }, null);
c(1, 'white', 0, 0, { green: 1, red: 2, black: 1 }, 'scroll');
c(2, 'white', 2, 0, { blue: 3, green: 2 }, 'token');
c(2, 'white', 2, 1, { green: 2, red: 2, pearl: 1 }, null);
c(2, 'white', 3, 0, { blue: 4, red: 2 }, null);
c(2, 'white', 1, 1, { green: 3, black: 2 }, 'replay');
c(3, 'white', 4, 2, { blue: 5, green: 3 }, null);
c(3, 'white', 3, 3, { green: 4, red: 3, pearl: 1 }, 'scroll');
c(1, 'blue', 0, 0, { green: 1, red: 1, black: 1 }, null);
c(1, 'blue', 0, 0, { green: 2, red: 1 }, 'token');
c(1, 'blue', 0, 0, { red: 2, black: 2 }, null);
c(1, 'blue', 1, 0, { green: 2, pearl: 1 }, null);
c(1, 'blue', 1, 0, { black: 3, green: 1 }, null);
c(1, 'blue', 0, 0, { red: 1, black: 2, white: 1 }, 'replay');
c(2, 'blue', 2, 0, { green: 3, red: 2 }, 'token');
c(2, 'blue', 2, 1, { red: 2, black: 2, pearl: 1 }, null);
c(2, 'blue', 3, 0, { green: 4, black: 2 }, null);
c(2, 'blue', 1, 1, { red: 3, white: 2 }, 'steal');
c(3, 'blue', 4, 2, { green: 5, red: 3 }, null);
c(3, 'blue', 3, 3, { red: 4, black: 3, pearl: 1 }, 'replay');
c(1, 'green', 0, 0, { red: 1, black: 1, white: 1 }, null);
c(1, 'green', 0, 0, { red: 2, black: 1 }, 'token');
c(1, 'green', 0, 0, { black: 2, white: 2 }, null);
c(1, 'green', 1, 0, { red: 2, pearl: 1 }, null);
c(1, 'green', 1, 0, { white: 3, red: 1 }, null);
c(1, 'green', 0, 0, { black: 1, white: 2, blue: 1 }, 'steal');
c(2, 'green', 2, 0, { red: 3, black: 2 }, 'token');
c(2, 'green', 2, 1, { black: 2, white: 2, pearl: 1 }, null);
c(2, 'green', 3, 0, { red: 4, white: 2 }, null);
c(2, 'green', 1, 1, { black: 3, blue: 2 }, 'scroll');
c(3, 'green', 4, 2, { red: 5, black: 3 }, null);
c(3, 'green', 3, 3, { black: 4, white: 3, pearl: 1 }, 'scroll');
c(1, 'red', 0, 0, { black: 1, white: 1, blue: 1 }, null);
c(1, 'red', 0, 0, { black: 2, white: 1 }, 'token');
c(1, 'red', 0, 0, { white: 2, blue: 2 }, null);
c(1, 'red', 1, 0, { black: 2, pearl: 1 }, null);
c(1, 'red', 1, 0, { blue: 3, black: 1 }, null);
c(1, 'red', 0, 0, { white: 1, blue: 2, green: 1 }, 'scroll');
c(2, 'red', 2, 0, { black: 3, white: 2 }, 'token');
c(2, 'red', 2, 1, { white: 2, blue: 2, pearl: 1 }, null);
c(2, 'red', 3, 0, { black: 4, blue: 2 }, null);
c(2, 'red', 1, 1, { white: 3, green: 2 }, 'replay');
c(3, 'red', 4, 2, { black: 5, white: 3 }, null);
c(3, 'red', 3, 3, { white: 4, blue: 3, pearl: 1 }, 'replay');
c(1, 'black', 0, 0, { white: 1, blue: 1, green: 1 }, null);
c(1, 'black', 0, 0, { white: 2, blue: 1 }, 'token');
c(1, 'black', 0, 0, { blue: 2, green: 2 }, null);
c(1, 'black', 1, 0, { white: 2, pearl: 1 }, null);
c(1, 'black', 1, 0, { green: 3, white: 1 }, null);
c(1, 'black', 0, 0, { blue: 1, green: 2, red: 1 }, 'replay');
c(2, 'black', 2, 0, { white: 3, blue: 2 }, 'token');
c(2, 'black', 2, 1, { blue: 2, green: 2, pearl: 1 }, null);
c(2, 'black', 3, 0, { white: 4, green: 2 }, null);
c(2, 'black', 1, 1, { blue: 3, red: 2 }, 'scroll');
c(3, 'black', 4, 2, { white: 5, blue: 3 }, null);
c(3, 'black', 3, 3, { blue: 4, green: 3, pearl: 1 }, 'scroll');
c(2, 'wild', 2, 1, { white: 3, red: 3 }, null);
c(2, 'wild', 2, 1, { blue: 3, black: 3 }, null);
c(2, 'wild', 2, 1, { green: 3, white: 2, pearl: 1 }, null);
c(2, 'wild', 2, 1, { red: 3, blue: 2, pearl: 1 }, null);
c(3, 'wild', 3, 2, { white: 4, blue: 4 }, null);
c(3, 'wild', 3, 2, { green: 4, red: 4 }, null);
c(3, 'wild', 3, 2, { black: 4, green: 3, pearl: 2 }, null);

// 왕실 카드 (왕관이 3개, 6개가 되면 한 장씩 고른다)
const DUEL_ROYALS = [
  { id: 'R1', pts: 2, power: 'scroll' },
  { id: 'R2', pts: 3, power: null },
  { id: 'R3', pts: 2, power: 'replay' },
  { id: 'R4', pts: 2, power: 'steal' },
];

// 이 세트가 임시인지 알리는 표시. 실제 카드로 바꾸면 false로 둔다.
const DUEL_CARDS_PLACEHOLDER = true;
