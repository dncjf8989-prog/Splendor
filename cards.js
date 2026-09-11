// 스플렌더 라이트 데모 - 카드/귀족 데이터
// 2인 전용판(스플렌더 듀얼)의 카드 장수인 30/24/13장을 기준으로 구성했습니다.
// 실제 제품의 카드 구성을 그대로 복제하지 않고, 색·비용·점수 밸런스만
// 데모용으로 재구성한 자체 데이터입니다.

const GEMS = ['white', 'blue', 'green', 'red', 'black'];
const GEM_LABEL = {
  white: '다이아몬드',
  blue: '사파이어',
  green: '에메랄드',
  red: '루비',
  black: '오닉스',
  gold: '골드(조커)',
};

// 비용은 "그 카드가 생산하는 보석"에서 몇 칸 떨어진 색인지(1~4)로 적는다.
// 같은 패턴을 색만 돌려가며 찍어내므로 색깔별 밸런스가 자동으로 맞는다.
const TIER1_PATTERNS = [
  { points: 0, cost: { 1: 1, 2: 1, 3: 1, 4: 1 } },
  { points: 0, cost: { 1: 2, 2: 2 } },
  { points: 0, cost: { 1: 1, 2: 1, 3: 1 } },
  { points: 0, cost: { 2: 3 } },
  { points: 0, cost: { 1: 2, 3: 1, 4: 1 } },
  { points: 1, cost: { 3: 4 } },
];

const TIER2_PATTERNS = [
  { points: 1, cost: { 1: 3, 2: 2, 3: 2 } },
  { points: 1, cost: { 1: 2, 2: 2, 4: 3 } },
  { points: 2, cost: { 2: 5 } },
  { points: 2, cost: { 1: 5, 3: 3 } },
  { points: 3, cost: { 3: 6 } },
];

const TIER3_PATTERNS = [
  { points: 3, cost: { 1: 3, 2: 3, 3: 5, 4: 3 } },
  { points: 4, cost: { 2: 7 } },
  { points: 4, cost: { 1: 6, 2: 3, 4: 3 } },
  { points: 5, cost: { 3: 7, 4: 3 } },
];

function buildDeck(patterns, count, pickPattern) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    const gemIdx = i % GEMS.length;
    const pattern = patterns[pickPattern(i, patterns.length)];
    const cost = {};
    for (const offset of Object.keys(pattern.cost)) {
      cost[GEMS[(gemIdx + Number(offset)) % GEMS.length]] = pattern.cost[offset];
    }
    cards.push({ gem: GEMS[gemIdx], cost, points: pattern.points });
  }
  return cards;
}

// 색을 한 바퀴 돌 때마다 다음 패턴으로 넘어간다. (장수가 색 수의 배수일 때)
const byGroup = (i, n) => Math.floor(i / GEMS.length) % n;
// 카드마다 패턴을 바꿔가며 배분한다. (장수가 패턴 수의 배수가 아닐 때)
const byRotation = (i, n) => i % n;

const TIER1_CARDS = buildDeck(TIER1_PATTERNS, 30, byGroup);
const TIER2_CARDS = buildDeck(TIER2_PATTERNS, 24, byGroup);
const TIER3_CARDS = buildDeck(TIER3_PATTERNS, 13, byRotation);

const NOBLES = [
  { id: 'N1', requires: { white: 3, blue: 3 }, points: 3 },
  { id: 'N2', requires: { green: 3, red: 3 }, points: 3 },
  { id: 'N3', requires: { black: 3, white: 3 }, points: 3 },
  { id: 'N4', requires: { red: 3, black: 3 }, points: 3 },
  { id: 'N5', requires: { blue: 3, green: 3 }, points: 3 },
];
