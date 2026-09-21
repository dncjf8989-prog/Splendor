// 스플렌더 라이트 데모 - 카드/귀족 데이터
// 시중 스플렌더 카드표를 그대로 옮긴 데이터입니다. 40/30/20장(총 90장).
// 색깔마다 카드가 달라 패턴을 색만 돌려 찍지 않고 한 장씩 적습니다.
// 자기 색을 비용으로 요구하는 카드가 있는데, 원본이 그렇습니다.
// 색깔별 총 수요는 티어1 33 / 티어2 41 / 티어3 43으로 각각 균등합니다.

const GEMS = ['white', 'blue', 'green', 'red', 'black'];
const GEM_LABEL = {
  white: '다이아몬드',
  blue: '사파이어',
  green: '에메랄드',
  red: '루비',
  black: '오닉스',
  gold: '골드(조커)',
};

// 티어1 40장 (색깔당 8장: 0점 7장 + 1점 1장)
const TIER1_CARDS = [
  { gem: 'white', points: 0, cost: { red: 2, black: 1 } },
  { gem: 'white', points: 0, cost: { blue: 3 } },
  { gem: 'white', points: 0, cost: { blue: 1, green: 1, red: 1, black: 1 } },
  { gem: 'white', points: 0, cost: { blue: 2, black: 2 } },
  { gem: 'white', points: 0, cost: { blue: 1, green: 2, red: 1, black: 1 } },
  { gem: 'white', points: 0, cost: { blue: 2, green: 2, black: 1 } },
  { gem: 'white', points: 0, cost: { white: 3, blue: 1, black: 1 } },
  { gem: 'white', points: 1, cost: { green: 4 } },
  { gem: 'blue', points: 0, cost: { white: 1, black: 2 } },
  { gem: 'blue', points: 0, cost: { black: 3 } },
  { gem: 'blue', points: 0, cost: { white: 1, green: 1, red: 1, black: 1 } },
  { gem: 'blue', points: 0, cost: { green: 2, black: 2 } },
  { gem: 'blue', points: 0, cost: { white: 1, green: 1, red: 2, black: 1 } },
  { gem: 'blue', points: 0, cost: { white: 1, green: 2, red: 2 } },
  { gem: 'blue', points: 0, cost: { blue: 1, green: 3, red: 1 } },
  { gem: 'blue', points: 1, cost: { red: 4 } },
  { gem: 'green', points: 0, cost: { white: 2, blue: 1 } },
  { gem: 'green', points: 0, cost: { red: 3 } },
  { gem: 'green', points: 0, cost: { white: 1, blue: 1, red: 1, black: 1 } },
  { gem: 'green', points: 0, cost: { blue: 2, red: 2 } },
  { gem: 'green', points: 0, cost: { white: 1, blue: 1, red: 1, black: 2 } },
  { gem: 'green', points: 0, cost: { blue: 1, red: 2, black: 2 } },
  { gem: 'green', points: 0, cost: { white: 1, blue: 3, green: 1 } },
  { gem: 'green', points: 1, cost: { black: 4 } },
  { gem: 'red', points: 0, cost: { blue: 2, green: 1 } },
  { gem: 'red', points: 0, cost: { white: 3 } },
  { gem: 'red', points: 0, cost: { white: 1, blue: 1, green: 1, black: 1 } },
  { gem: 'red', points: 0, cost: { white: 2, red: 2 } },
  { gem: 'red', points: 0, cost: { white: 2, blue: 1, green: 1, black: 1 } },
  { gem: 'red', points: 0, cost: { white: 2, green: 1, black: 2 } },
  { gem: 'red', points: 0, cost: { white: 1, red: 1, black: 3 } },
  { gem: 'red', points: 1, cost: { white: 4 } },
  { gem: 'black', points: 0, cost: { green: 2, red: 1 } },
  { gem: 'black', points: 0, cost: { green: 3 } },
  { gem: 'black', points: 0, cost: { white: 1, blue: 1, green: 1, red: 1 } },
  { gem: 'black', points: 0, cost: { white: 2, green: 2 } },
  { gem: 'black', points: 0, cost: { white: 1, blue: 2, green: 1, red: 1 } },
  { gem: 'black', points: 0, cost: { white: 2, blue: 2, red: 1 } },
  { gem: 'black', points: 0, cost: { green: 1, red: 3, black: 1 } },
  { gem: 'black', points: 1, cost: { blue: 4 } },
];

// ============ 티어2 / 티어3 ============
// 시중 스플렌더 카드표를 그대로 옮긴 데이터입니다. 색깔마다 카드가 달라서
// (티어2의 일부 카드는 색 회전 대칭이 아닙니다) 패턴을 색만 돌려 찍지 않고
// 한 장씩 적습니다. 비용은 실제 보석 색으로 적습니다.
// 자기 색을 비용으로 요구하는 카드가 있습니다. 원본이 그렇습니다.

// 티어2 30장 (색깔당 6장: 1,1,2,2,2,3점)
const TIER2_CARDS = [
  { gem: 'white', points: 1, cost: { green: 3, red: 2, black: 2 } },
  { gem: 'white', points: 1, cost: { white: 2, blue: 3, red: 3 } },
  { gem: 'white', points: 2, cost: { red: 5 } },
  { gem: 'white', points: 2, cost: { green: 1, red: 4, black: 2 } },
  { gem: 'white', points: 2, cost: { red: 5, black: 3 } },
  { gem: 'white', points: 3, cost: { white: 6 } },
  { gem: 'blue', points: 1, cost: { blue: 2, green: 2, red: 3 } },
  { gem: 'blue', points: 1, cost: { blue: 2, green: 3, black: 3 } },
  { gem: 'blue', points: 2, cost: { blue: 5 } },
  { gem: 'blue', points: 2, cost: { white: 2, red: 1, black: 4 } },
  { gem: 'blue', points: 2, cost: { white: 5, blue: 3 } },
  { gem: 'blue', points: 3, cost: { blue: 6 } },
  { gem: 'green', points: 1, cost: { white: 2, blue: 3, black: 2 } },
  { gem: 'green', points: 1, cost: { white: 3, green: 2, red: 3 } },
  { gem: 'green', points: 2, cost: { green: 5 } },
  { gem: 'green', points: 2, cost: { white: 4, blue: 2, black: 1 } },
  { gem: 'green', points: 2, cost: { blue: 5, green: 3 } },
  { gem: 'green', points: 3, cost: { green: 6 } },
  { gem: 'red', points: 1, cost: { white: 2, red: 2, black: 3 } },
  { gem: 'red', points: 1, cost: { blue: 3, red: 2, black: 3 } },
  { gem: 'red', points: 2, cost: { black: 5 } },
  { gem: 'red', points: 2, cost: { white: 1, blue: 4, green: 2 } },
  { gem: 'red', points: 2, cost: { white: 3, black: 5 } },
  { gem: 'red', points: 3, cost: { red: 6 } },
  { gem: 'black', points: 1, cost: { white: 3, blue: 2, green: 2 } },
  { gem: 'black', points: 1, cost: { white: 3, green: 3, black: 2 } },
  { gem: 'black', points: 2, cost: { white: 5 } },
  { gem: 'black', points: 2, cost: { blue: 1, green: 4, red: 2 } },
  { gem: 'black', points: 2, cost: { green: 5, red: 3 } },
  { gem: 'black', points: 3, cost: { black: 6 } },
];

// 티어3 20장 (색깔당 4장: 3,4,4,5점)
const TIER3_CARDS = [
  { gem: 'white', points: 3, cost: { blue: 3, green: 3, red: 5, black: 3 } },
  { gem: 'white', points: 4, cost: { black: 7 } },
  { gem: 'white', points: 4, cost: { white: 3, red: 3, black: 6 } },
  { gem: 'white', points: 5, cost: { white: 3, black: 7 } },
  { gem: 'blue', points: 3, cost: { white: 3, green: 3, red: 3, black: 5 } },
  { gem: 'blue', points: 4, cost: { white: 7 } },
  { gem: 'blue', points: 4, cost: { white: 6, blue: 3, black: 3 } },
  { gem: 'blue', points: 5, cost: { white: 7, blue: 3 } },
  { gem: 'green', points: 3, cost: { white: 5, blue: 3, red: 3, black: 3 } },
  { gem: 'green', points: 4, cost: { blue: 7 } },
  { gem: 'green', points: 4, cost: { white: 3, blue: 6, green: 3 } },
  { gem: 'green', points: 5, cost: { blue: 7, green: 3 } },
  { gem: 'red', points: 3, cost: { white: 3, blue: 5, green: 3, black: 3 } },
  { gem: 'red', points: 4, cost: { green: 7 } },
  { gem: 'red', points: 4, cost: { blue: 3, green: 6, red: 3 } },
  { gem: 'red', points: 5, cost: { green: 7, red: 3 } },
  { gem: 'black', points: 3, cost: { white: 3, blue: 3, green: 5, red: 3 } },
  { gem: 'black', points: 4, cost: { red: 7 } },
  { gem: 'black', points: 4, cost: { green: 3, red: 6, black: 3 } },
  { gem: 'black', points: 5, cost: { red: 7, black: 3 } },
];

// 귀족은 두 색 4장씩 또는 세 색 3장씩을 요구한다. 인원이 늘면 등장 수도
// 늘어나므로(2인 3장 ~ 4인 5장) 색깔별 수요가 고르게 퍼지도록 10종을 둔다.
const NOBLES = [
  { id: 'N1', requires: { white: 4, blue: 4 }, points: 3 },
  { id: 'N2', requires: { blue: 4, green: 4 }, points: 3 },
  { id: 'N3', requires: { green: 4, red: 4 }, points: 3 },
  { id: 'N4', requires: { red: 4, black: 4 }, points: 3 },
  { id: 'N5', requires: { black: 4, white: 4 }, points: 3 },
  { id: 'N6', requires: { white: 3, blue: 3, green: 3 }, points: 3 },
  { id: 'N7', requires: { blue: 3, green: 3, red: 3 }, points: 3 },
  { id: 'N8', requires: { green: 3, red: 3, black: 3 }, points: 3 },
  { id: 'N9', requires: { red: 3, black: 3, white: 3 }, points: 3 },
  { id: 'N10', requires: { black: 3, white: 3, blue: 3 }, points: 3 },
];
