const { query } = require("./db");
const { getMatches, getTodayDate } = require("./bolao");

const API_BASE_URL = "https://v3.football.api-sports.io";
const SYNC_KEY = "api-football-results";
const SYNC_INTERVAL_MS = Number(process.env.RESULTS_SYNC_INTERVAL_MS || 60 * 60 * 1000);
const COMPLETED_STATUSES = new Set(["AET", "FT", "PEN"]);

async function syncResultsIfStale({ force = false } = {}) {
  if (!process.env.API_FOOTBALL_KEY) {
    return {
      status: "disabled",
      message: "API_FOOTBALL_KEY não configurada.",
    };
  }

  const acquired = await acquireSyncLock(force);
  if (!acquired) {
    return getSyncStatus("fresh");
  }

  try {
    const matches = await getMatches();
    const dates = getSyncDates();
    const fixturesByDate = await Promise.all(dates.map(fetchFixturesForDate));
    const fixtures = fixturesByDate.flat();
    let updated = 0;

    for (const fixture of fixtures) {
      if (!COMPLETED_STATUSES.has(fixture.fixture?.status?.short)) continue;

      const match = findInternalMatch(matches, fixture);
      if (!match) continue;

      const result = normalizeFixtureResult(fixture);
      if (!result) continue;

      await query(
        `INSERT INTO results (match_id, home_score, away_score, penalty_winner, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (match_id)
         DO UPDATE SET
           home_score = EXCLUDED.home_score,
           away_score = EXCLUDED.away_score,
           penalty_winner = EXCLUDED.penalty_winner,
           updated_at = now()`,
        [match.id, result.homeScore, result.awayScore, result.penaltyWinner],
      );
      updated += 1;
    }

    await query(
      `UPDATE sync_state
          SET last_completed_at = now(),
              last_error = NULL
        WHERE sync_key = $1`,
      [SYNC_KEY],
    );

    return {
      status: "updated",
      checked: fixtures.length,
      updated,
    };
  } catch (error) {
    await query(
      `UPDATE sync_state
          SET last_error = $2
        WHERE sync_key = $1`,
      [SYNC_KEY, String(error.message || error).slice(0, 500)],
    );
    throw error;
  }
}

async function acquireSyncLock(force) {
  const { rows } = await query(
    `INSERT INTO sync_state (sync_key, last_started_at)
     VALUES ($1, now())
     ON CONFLICT (sync_key)
     DO UPDATE SET last_started_at = now()
       WHERE $2::boolean
          OR sync_state.last_started_at IS NULL
          OR sync_state.last_started_at < now() - ($3::bigint * interval '1 millisecond')
     RETURNING sync_key`,
    [SYNC_KEY, force, SYNC_INTERVAL_MS],
  );

  return rows.length > 0;
}

async function getSyncStatus(status = "fresh") {
  const { rows } = await query(
    `SELECT last_started_at, last_completed_at, last_error
       FROM sync_state
      WHERE sync_key = $1`,
    [SYNC_KEY],
  );

  const row = rows[0] || {};
  return {
    status,
    lastStartedAt: row.last_started_at || null,
    lastCompletedAt: row.last_completed_at || null,
    lastError: row.last_error || null,
  };
}

function getSyncDates() {
  const today = getTodayDate();
  const todayDate = new Date(`${today}T12:00:00-03:00`);
  const yesterdayDate = new Date(todayDate.getTime() - 24 * 60 * 60 * 1000);

  return [formatDateInSaoPaulo(yesterdayDate), today];
}

function formatDateInSaoPaulo(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function fetchFixturesForDate(date) {
  const url = new URL(`${API_BASE_URL}/fixtures`);
  url.searchParams.set("date", date);
  url.searchParams.set("league", "1");
  url.searchParams.set("season", "2026");
  url.searchParams.set("timezone", "America/Sao_Paulo");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-apisports-key": process.env.API_FOOTBALL_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`API-Football respondeu ${response.status}.`);
  }

  const payload = await response.json();
  const apiErrors = payload.errors && Object.keys(payload.errors).length ? JSON.stringify(payload.errors) : "";
  if (apiErrors) {
    throw new Error(`API-Football: ${apiErrors}`);
  }

  return Array.isArray(payload.response) ? payload.response : [];
}

function findInternalMatch(matches, fixture) {
  const kickoff = new Date(fixture.fixture?.date);
  const home = canonicalTeamName(fixture.teams?.home?.name);
  const away = canonicalTeamName(fixture.teams?.away?.name);
  const exactTimeCandidates = matches.filter(
    (match) => Math.abs(new Date(match.kickoffAt).getTime() - kickoff.getTime()) <= 15 * 60 * 1000,
  );

  const teamMatch = matches.find((match) => {
    const kickoffDifference = Math.abs(new Date(match.kickoffAt).getTime() - kickoff.getTime());
    return (
      kickoffDifference <= 3 * 60 * 60 * 1000 &&
      canonicalTeamName(match.home) === home &&
      canonicalTeamName(match.away) === away
    );
  });

  if (teamMatch) return teamMatch;
  return exactTimeCandidates.length === 1 ? exactTimeCandidates[0] : null;
}

function canonicalTeamName(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const aliases = {
    "africa do sul": "south africa",
    "arabia saudita": "saudi arabia",
    "bosnia e herzegovina": "bosnia and herzegovina",
    "bosnia herzegovina": "bosnia and herzegovina",
    "cabo verde": "cape verde",
    "catar": "qatar",
    "coreia do sul": "south korea",
    "costa do marfim": "ivory coast",
    "cote d ivoire": "ivory coast",
    "czech republic": "czechia",
    "escocia": "scotland",
    "espanha": "spain",
    "estados unidos": "usa",
    "korea republic": "south korea",
    "nova zelandia": "new zealand",
    "paises baixos": "netherlands",
    "rd congo": "dr congo",
    "republica democratica do congo": "dr congo",
    "south korea": "south korea",
    "suecia": "sweden",
    "suica": "switzerland",
    "tchequia": "czechia",
    "turquia": "turkey",
    "united states": "usa",
    "uzbequistao": "uzbekistan",
  };

  return aliases[normalized] || normalized;
}

function normalizeFixtureResult(fixture) {
  const homeScore = Number(fixture.goals?.home);
  const awayScore = Number(fixture.goals?.away);

  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) {
    return null;
  }

  const penaltyHome = Number(fixture.score?.penalty?.home);
  const penaltyAway = Number(fixture.score?.penalty?.away);
  let penaltyWinner = null;

  if (Number.isInteger(penaltyHome) && Number.isInteger(penaltyAway) && penaltyHome !== penaltyAway) {
    penaltyWinner = penaltyHome > penaltyAway ? "home" : "away";
  }

  return {
    awayScore,
    homeScore,
    penaltyWinner,
  };
}

module.exports = {
  canonicalTeamName,
  findInternalMatch,
  normalizeFixtureResult,
  syncResultsIfStale,
};
