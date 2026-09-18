// 스플렌더 라이트 데모 - 카드/귀족 데이터
// 2~4인을 모두 지원하기 위해 원작 스플렌더와 같은 40/30/20장(총 90장)으로
// 구성했습니다.
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
  { points: 0, cost: { 1: 1, 3: 2, 4: 1 } },
  { points: 0, cost: { 2: 1, 3: 1, 4: 2 } },
  { points: 1, cost: { 3: 4 } },
];

// 티어2도 같은 이유로 한 색 최대 4개까지만 받는다. (예전의 5~6개짜리
// 단색 카드는 보드에 깔려도 3~4판에 한 번꼴로만 팔렸다)
const TIER2_PATTERNS = [
  { points: 1, cost: { 1: 3, 2: 2, 3: 2 } },
  { points: 1, cost: { 1: 2, 2: 2, 4: 3 } },
  { points: 1, cost: { 1: 3, 3: 3 } },
  { points: 2, cost: { 2: 4, 3: 2 } },
  { points: 2, cost: { 1: 4, 2: 2, 3: 2 } },
  { points: 3, cost: { 1: 2, 2: 4, 3: 2 } },
];

// 티어3는 한 색에 비용이 몰리면(6~7개) 실전에서 살 수가 없다. 은행에 같은 색
// 토큰이 4~7개뿐이라 카드 보너스를 그 색으로만 4~5장 쌓아야 하기 때문이다.
// 그래서 한 색 최대 4개로 묶고 3~4색에 고르게 퍼뜨린다. 총액은 10~12.
const TIER3_PATTERNS = [
  { points: 3, cost: { 1: 2, 2: 3, 3: 3, 4: 2 } },
  { points: 4, cost: { 1: 4, 2: 4, 3: 2 } },
  { points: 4, cost: { 1: 2, 2: 4, 3: 4 } },
  { points: 5, cost: { 1: 2, 2: 4, 3: 4, 4: 2 } },
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

const TIER1_CARDS = buildDeck(TIER1_PATTERNS, 40, byGroup);
const TIER2_CARDS = buildDeck(TIER2_PATTERNS, 30, byGroup);
const TIER3_CARDS = buildDeck(TIER3_PATTERNS, 20, byGroup);

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
