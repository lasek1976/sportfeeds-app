/**
 * Fact Codes Module
 * ScoreBoards[].IdResultType is the IDFactCode written by the snapshot producer
 * (IdResultType = scoreboardRow.IDFactCode). Labels come from config/fact-codes.csv via /api/fact-codes.
 * The score logic only relies on the code constants below, so it works even before the table is loaded.
 */

let factCodes = {}; // { [IDFactCode]: { description, defaultValue, flag1, flag2 } }

// Score pairs (Team 1 / Team 2), most specific first. An event only carries the facts of its sport;
// when several pairs are present, the first one with a non-zero value wins (see getScoreSummary).
const SCORE_PAIRS = [
  { team1: 933,  team2: 934,  unit: 'goals'  }, // Current Goal Team 1/2 (football, ice hockey, handball, …)
  { team1: 1073, team2: 1074, unit: 'points' }, // TotalPointsTeam1/2 (basketball, rugby, american football)
  { team1: 1126, team2: 1127, unit: 'runs'   }, // Total Runs Team 1/2 (cricket)
  { team1: 1039, team2: 1040, unit: 'sets'   }, // Sets won Team 1/2 (tennis, volleyball, table tennis, darts)
  { team1: 1105, team2: 1106, unit: 'legs'   }, // Legs Won Team 1/2 (darts)
  { team1: 1111, team2: 1112, unit: 'frames' }, // Frames Won Team 1/2 (snooker)
  { team1: 1134, team2: 1135, unit: 'maps'   }  // Maps Won Team 1/2 (esports)
];

const FACT = {
  LAST_CLOCK: 943,
  CURRENT_SET_NUMBER: 1026,
  CURRENT_POINT_TEAM1: 1027,
  CURRENT_POINT_TEAM2: 1028,
  CURRENT_INNING: 1079
};

// Score Set N Team 1/2: sets 1-5 are 1029..1038, sets 6-7 are 1120..1123
function setScoreCodes(setNumber) {
  if (setNumber >= 1 && setNumber <= 5) {
    const team1 = 1029 + (setNumber - 1) * 2;
    return [team1, team1 + 1];
  }
  if (setNumber === 6) return [1120, 1121];
  if (setNumber === 7) return [1122, 1123];
  return null;
}

/**
 * Load the decoding table from the server (once). Never throws: labels fall back to "Fact N".
 */
export async function loadFactCodes() {
  try {
    const response = await fetch('/api/fact-codes');
    const json = await response.json();
    if (!json.success) throw new Error(json.error || `HTTP ${response.status}`);
    factCodes = json.data || {};
    console.log(`Fact codes loaded: ${Object.keys(factCodes).length}`);
  } catch (error) {
    console.warn('Fact codes not available, scoreboards will show raw codes:', error.message);
  }
}

/** Human-readable label of a fact code */
export function factCodeLabel(code) {
  return factCodes[code]?.description || `Fact ${code}`;
}

/** Map IDFactCode → ResultValue of the event's (non-removed) scoreboards */
function scoreboardValues(event) {
  const values = new Map();
  (event.ScoreBoards || event.scoreBoards || []).forEach(board => {
    if ((board.DiffType ?? board.diffType ?? 0) === 2) return;
    const code = board.IdResultType ?? board.idResultType;
    values.set(code, (board.ResultValue ?? board.resultValue ?? '').toString().trim());
  });
  return values;
}

const isZero = value => value === '' || Number(value) === 0;

/**
 * Score summary of a live event, from its scoreboards.
 * @returns {{ score: string, detail: string, clock: string, facts: Array<{code, label, value}> }}
 *   score  - main score "T1-T2" ('' when the event has no known score pair)
 *   detail - secondary info (current set games, game points, inning)
 *   clock  - last clock from the feed, only when not the default 00:00:00
 *   facts  - every scoreboard fact, decoded and sorted by code (for tooltips)
 */
export function getScoreSummary(event) {
  const values = scoreboardValues(event);
  const has = code => values.has(code);
  const get = code => values.get(code) ?? '';

  const present = SCORE_PAIRS.filter(p => has(p.team1) || has(p.team2));
  const pair = present.find(p => !isZero(get(p.team1)) || !isZero(get(p.team2))) || present[0];
  const score = pair ? `${get(pair.team1) || '0'}-${get(pair.team2) || '0'}` : '';

  const detail = [];
  if (pair?.unit === 'sets') {
    const setNumber = Number(get(FACT.CURRENT_SET_NUMBER));
    const codes = setScoreCodes(setNumber);
    if (codes && (has(codes[0]) || has(codes[1]))) {
      detail.push(`(${get(codes[0]) || '0'}-${get(codes[1]) || '0'})`);
    }
    if (has(FACT.CURRENT_POINT_TEAM1) || has(FACT.CURRENT_POINT_TEAM2)) {
      detail.push(`${get(FACT.CURRENT_POINT_TEAM1) || '0'}-${get(FACT.CURRENT_POINT_TEAM2) || '0'}`);
    }
  }
  if (get(FACT.CURRENT_INNING)) {
    detail.push(get(FACT.CURRENT_INNING));
  }

  const lastClock = get(FACT.LAST_CLOCK);
  const clock = lastClock && lastClock !== '00:00:00' ? lastClock : '';

  const facts = [...values.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([code, value]) => ({ code, label: factCodeLabel(code), value }));

  return { score, detail: detail.join(' '), clock, facts };
}
