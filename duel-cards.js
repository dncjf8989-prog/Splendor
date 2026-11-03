'use strict';

// ============ 스플렌더 듀얼 카드 데이터 ============
//
// 카드 목록: 사용자가 올려 준 엑셀 "스플렌더 듀얼 카드 71장" (기본판, 확장판 제외).
// 엑셀의 출처 표기는 splendortactics.com/cards 와 BoardGameGeek 카드 목록이다.
// 개발 카드 67장(티어1 30, 티어2 24, 티어3 13)과 왕실 카드 4장을 그대로 옮겼다.
// 이 세션에서는 그 사이트에 접속할 수 없어서 원본과 직접 대조하지는 못했다. 엑셀 안에서는
// 단계별 장수, 점수, 왕관 합계와 비용 합계가 요약 시트와 모두 맞는 것을 확인했다.
//
// c(티어, 보너스 색, 점수, 왕관, 비용, 능력, 엑셀의 카드 ID)
//   보너스 색 : white blue green red black
//               'wild' = 색상 선택 카드 (산 뒤 이미 가진 카드의 색 중 하나를 고른다)
//               'none' = 황금 카드 (보너스 색이 없다. 점수만 있다)
//   비용      : { white:n, blue:n, green:n, red:n, black:n, pearl:n }
//               여기 적힌 것은 "기본 비용"이다. 판마다 티어별로 다섯 보석 색이 무작위로 서로 바뀌므로
//               (state.costMap), 게임 안에서 실제로 내는 비용은 duelCardCost(state, id) 로 얻는다.
//               진주 비용과 보너스 색, 점수, 왕관, 능력은 바뀌지 않는다.
//   능력      : null | 'replay'(추가 턴) | 'token'(판에서 같은 색 보석 1개)
//               | 'scroll'(특권 획득) | 'steal'(상대 보석/진주 1개 빼앗기)
//   id는 아래 나열 순서대로 매겨지므로 모든 기기에서 같은 파일을 써야 한다.

const DUEL_CARDS = [];
function c(lv, bonus, pts, crowns, cost, power, ref) {
  DUEL_CARDS.push({ id: DUEL_CARDS.length, lv, bonus, pts, crowns, cost, power: power || null, ref: ref || null });
}

// ---- 티어 1 ----
c(1, 'white', 0, 0, { blue: 1, green: 1, red: 1, black: 1 }, null, 'l1-01');
c(1, 'white', 0, 1, { blue: 3 }, null, 'l1-02');
c(1, 'white', 0, 0, { blue: 2, green: 2, pearl: 1 }, 'replay', 'l1-03');
c(1, 'white', 0, 0, { red: 2, black: 2 }, 'token', 'l1-04');
c(1, 'white', 1, 0, { green: 2, red: 3 }, null, 'l1-05');
c(1, 'blue', 0, 0, { white: 1, green: 1, red: 1, black: 1 }, null, 'l1-06');
c(1, 'blue', 0, 1, { green: 3 }, null, 'l1-07');
c(1, 'blue', 0, 0, { green: 2, red: 2, pearl: 1 }, 'replay', 'l1-08');
c(1, 'blue', 0, 0, { white: 2, black: 2 }, 'token', 'l1-09');
c(1, 'blue', 1, 0, { red: 2, black: 3 }, null, 'l1-10');
c(1, 'green', 0, 0, { white: 1, blue: 1, red: 1, black: 1 }, null, 'l1-11');
c(1, 'green', 0, 1, { red: 3 }, null, 'l1-12');
c(1, 'green', 0, 0, { red: 2, black: 2, pearl: 1 }, 'replay', 'l1-13');
c(1, 'green', 0, 0, { white: 2, blue: 2 }, 'token', 'l1-14');
c(1, 'green', 1, 0, { white: 3, black: 2 }, null, 'l1-15');
c(1, 'black', 0, 0, { white: 1, blue: 1, green: 1, red: 1 }, null, 'l1-16');
c(1, 'black', 0, 1, { white: 3 }, null, 'l1-17');
c(1, 'black', 0, 0, { white: 2, blue: 2, pearl: 1 }, 'replay', 'l1-18');
c(1, 'black', 0, 0, { green: 2, red: 2 }, 'token', 'l1-19');
c(1, 'black', 1, 0, { blue: 2, green: 3 }, null, 'l1-20');
c(1, 'red', 0, 0, { white: 1, blue: 1, green: 1, black: 1 }, null, 'l1-21');
c(1, 'red', 0, 1, { black: 3 }, null, 'l1-22');
c(1, 'red', 0, 0, { white: 2, black: 2, pearl: 1 }, 'replay', 'l1-23');
c(1, 'red', 0, 0, { blue: 2, green: 2 }, 'token', 'l1-24');
c(1, 'red', 1, 0, { white: 2, blue: 3 }, null, 'l1-25');
c(1, 'wild', 1, 0, { black: 4, pearl: 1 }, null, 'l1-26');
c(1, 'wild', 0, 1, { white: 4, pearl: 1 }, null, 'l1-27');
c(1, 'none', 3, 0, { red: 4, pearl: 1 }, null, 'l1-28');
c(1, 'wild', 1, 0, { blue: 2, red: 2, black: 1, pearl: 1 }, null, 'l1-29');
c(1, 'wild', 1, 0, { white: 2, green: 2, black: 1, pearl: 1 }, null, 'l1-30');

// ---- 티어 2 ----
c(2, 'white', 2, 1, { green: 2, red: 2, black: 2, pearl: 1 }, null, 'l2-01');
c(2, 'white', 1, 0, { blue: 4, red: 3 }, 'steal', 'l2-02');
c(2, 'white', 2, 0, { white: 4, black: 2, pearl: 1 }, 'scroll', 'l2-03');
c(2, 'white', 1, 0, { blue: 5, green: 2 }, null, 'l2-04');
c(2, 'blue', 2, 1, { white: 2, red: 2, black: 2, pearl: 1 }, null, 'l2-05');
c(2, 'blue', 1, 0, { green: 4, black: 3 }, 'steal', 'l2-06');
c(2, 'blue', 2, 0, { white: 2, blue: 4, pearl: 1 }, 'scroll', 'l2-07');
c(2, 'blue', 1, 0, { green: 5, red: 2 }, null, 'l2-08');
c(2, 'green', 2, 1, { white: 2, blue: 2, black: 2, pearl: 1 }, null, 'l2-09');
c(2, 'green', 1, 0, { white: 3, red: 4 }, 'steal', 'l2-10');
c(2, 'green', 2, 0, { blue: 2, green: 4, pearl: 1 }, 'scroll', 'l2-11');
c(2, 'green', 1, 0, { red: 5, black: 2 }, null, 'l2-12');
c(2, 'black', 2, 1, { blue: 2, green: 2, red: 2, pearl: 1 }, null, 'l2-13');
c(2, 'black', 1, 0, { white: 4, green: 3 }, 'steal', 'l2-14');
c(2, 'black', 2, 0, { red: 2, black: 4, pearl: 1 }, 'scroll', 'l2-15');
c(2, 'black', 1, 0, { white: 5, blue: 2 }, null, 'l2-16');
c(2, 'red', 2, 1, { white: 2, blue: 2, green: 2, pearl: 1 }, null, 'l2-17');
c(2, 'red', 1, 0, { blue: 3, black: 4 }, 'steal', 'l2-18');
c(2, 'red', 2, 0, { green: 2, red: 4, pearl: 1 }, 'scroll', 'l2-19');
c(2, 'red', 1, 0, { white: 2, black: 5 }, null, 'l2-20');
c(2, 'wild', 2, 0, { green: 6, pearl: 1 }, null, 'l2-21');
c(2, 'wild', 0, 2, { green: 6, pearl: 1 }, null, 'l2-22');
c(2, 'wild', 0, 2, { blue: 6, pearl: 1 }, null, 'l2-23');
c(2, 'none', 5, 0, { blue: 6, pearl: 1 }, null, 'l2-24');

// ---- 티어 3 ----
c(3, 'white', 3, 2, { blue: 3, red: 5, black: 3, pearl: 1 }, null, 'l3-01');
c(3, 'white', 4, 0, { white: 6, blue: 2, black: 2 }, null, 'l3-02');
c(3, 'blue', 3, 2, { white: 3, green: 3, black: 5, pearl: 1 }, null, 'l3-03');
c(3, 'blue', 4, 0, { white: 2, blue: 6, green: 2 }, null, 'l3-04');
c(3, 'green', 3, 2, { white: 5, blue: 3, red: 3, pearl: 1 }, null, 'l3-05');
c(3, 'green', 4, 0, { blue: 2, green: 6, red: 2 }, null, 'l3-06');
c(3, 'black', 3, 2, { white: 3, green: 5, red: 3, pearl: 1 }, null, 'l3-07');
c(3, 'black', 4, 0, { white: 2, red: 2, black: 6 }, null, 'l3-08');
c(3, 'red', 3, 2, { blue: 5, green: 3, black: 3, pearl: 1 }, null, 'l3-09');
c(3, 'red', 4, 0, { green: 2, red: 6, black: 2 }, null, 'l3-10');
c(3, 'wild', 3, 0, { red: 8 }, 'replay', 'l3-11');
c(3, 'wild', 0, 3, { black: 8 }, null, 'l3-12');
c(3, 'none', 6, 0, { white: 8 }, null, 'l3-13');

// 왕실 카드 (왕관이 처음 3개, 6개가 되면 한 장씩 고른다)
const DUEL_ROYALS = [
  { id: 'R1', pts: 2, power: 'steal', ref: 'royal-01' },
  { id: 'R2', pts: 2, power: 'replay', ref: 'royal-02' },
  { id: 'R3', pts: 2, power: 'scroll', ref: 'royal-03' },
  { id: 'R4', pts: 3, power: null, ref: 'royal-04' },
];

// 이 세트가 임시인지 알리는 표시. 실제 카드 목록이므로 false.
const DUEL_CARDS_PLACEHOLDER = false;
