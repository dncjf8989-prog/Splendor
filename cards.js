// 스플렌더 라이트 데모 - 카드/귀족 데이터
// 실제 보드게임 카드 구성을 그대로 복제하지 않고, 라이트 데모용으로
// 색상/코스트/점수 밸런스만 간단히 재구성한 자체 데이터입니다.

const GEMS = ['white', 'blue', 'green', 'red', 'black'];
const GEM_LABEL = {
  white: '다이아몬드',
  blue: '사파이어',
  green: '에메랄드',
  red: '루비',
  black: '오닉스',
  gold: '골드(조커)',
};

const TIER1_CARDS = [
  { gem: 'black', cost: { white: 1, blue: 1, green: 1, red: 1 }, points: 0 },
  { gem: 'white', cost: { blue: 2, green: 1, black: 1 }, points: 0 },
  { gem: 'blue', cost: { white: 1, green: 2, red: 1 }, points: 0 },
  { gem: 'green', cost: { white: 1, blue: 1, red: 2 }, points: 0 },
  { gem: 'red', cost: { white: 2, black: 2 }, points: 0 },
  { gem: 'black', cost: { blue: 1, green: 1, red: 1 }, points: 0 },
  { gem: 'white', cost: { green: 1, red: 1, black: 1 }, points: 0 },
  { gem: 'blue', cost: { white: 3, black: 1 }, points: 0 },
  { gem: 'green', cost: { blue: 3, white: 1 }, points: 0 },
  { gem: 'red', cost: { black: 3, green: 1 }, points: 0 },
  { gem: 'black', cost: { white: 1, green: 3 }, points: 1 },
  { gem: 'white', cost: { red: 4 }, points: 1 },
];

const TIER2_CARDS = [
  { gem: 'black', cost: { white: 3, blue: 2, green: 2 }, points: 1 },
  { gem: 'white', cost: { blue: 3, green: 2, red: 2 }, points: 1 },
  { gem: 'blue', cost: { green: 3, red: 2, black: 2 }, points: 1 },
  { gem: 'green', cost: { red: 3, black: 2, white: 2 }, points: 1 },
  { gem: 'red', cost: { black: 3, white: 2, blue: 2 }, points: 1 },
  { gem: 'black', cost: { white: 5 }, points: 2 },
  { gem: 'white', cost: { green: 5 }, points: 2 },
  { gem: 'blue', cost: { black: 5 }, points: 2 },
];

const TIER3_CARDS = [
  { gem: 'black', cost: { white: 3, blue: 3, green: 3, red: 3 }, points: 3 },
  { gem: 'white', cost: { blue: 3, green: 3, red: 3, black: 3 }, points: 3 },
  { gem: 'blue', cost: { white: 6, black: 3 }, points: 4 },
  { gem: 'green', cost: { red: 6, white: 3 }, points: 4 },
  { gem: 'red', cost: { black: 6, green: 3 }, points: 4 },
  { gem: 'black', cost: { white: 7 }, points: 5 },
];

const NOBLES = [
  { id: 'N1', requires: { white: 3, blue: 3 }, points: 3 },
  { id: 'N2', requires: { green: 3, red: 3 }, points: 3 },
  { id: 'N3', requires: { black: 3, white: 3 }, points: 3 },
  { id: 'N4', requires: { red: 3, black: 3 }, points: 3 },
];
