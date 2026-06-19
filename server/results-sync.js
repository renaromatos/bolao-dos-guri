const { query } = require("./db");
const { getMatches, getTodayDate } = require("./bolao");

const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const SYNC_KEY = "espn-results";
const SYNC_INTERVAL_MS = Number(process.env.RESULTS_SYNC_INTERVAL_MS || 60 * 60 * 1000);

async function syncResultsIfStale({ force = false } = {}) {
  const previousStatus = await getSyncStatus("pending");
  const acquired = await acquireSyncLock(force);
  if (!acquired) {
    return getSyncStatus("fresh");
  }

  try {
    const matches = await getMatches();
    const range = getSyncRange(!previousStatus.lastCompletedAt);
    const events = await fetchScoreboardForRange(range.from, range.to);
    const completedResults = [];

    for (const event of events) {
      const externalMatch = normalizeEspnEvent(event);
      if (!externalMatch?.completed) continue;

      const match = findInternalMatch(matches, externalMatch);
      if (!match) continue;

      completedResults.push({
        awayScore: externalMatch.awayScore,
        homeScore: externalMatch.homeScore,
        matchId: match.id,
        penaltyWinner: externalMatch.penaltyWinner,
      });
    }

    if (completedResults.length) {
      const params = [];
      const values = completedResults.map((result, index) => {
        const offset = index * 4;
        params.push(result.matchId, result.homeScore, result.awayScore, result.penaltyWinner);
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, now())`;
      });

      await query(
        `INSERT INTO results (match_id, home_score, away_score, penalty_winner, updated_at)
         VALUES ${values.join(", ")}
         ON CONFLICT (match_id)
         DO UPDATE SET
           home_score = EXCLUDED.home_score,
           away_score = EXCLUDED.away_score,
           penalty_winner = EXCLUDED.penalty_winner,
           updated_at = now()`,
        params,
      );
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
      provider: "espn",
      checked: events.length,
      updated: completedResults.length,
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
    provider: "espn",
    lastStartedAt: row.last_started_at || null,
    lastCompletedAt: row.last_completed_at || null,
    lastError: row.last_error || null,
  };
}

function getSyncRange(backfill) {
  const today = getTodayDate();
  const todayDate = new Date(`${today}T12:00:00-03:00`);
  const yesterdayDate = new Date(todayDate.getTime() - 24 * 60 * 60 * 1000);

  return {
    from: backfill ? "2026-06-11" : formatDateInSaoPaulo(yesterdayDate),
    to: today,
  };
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

async function fetchScoreboardForDate(date) {
  return fetchScoreboardForRange(date, date);
}

async function fetchScoreboardForRange(from, to) {
  const url = new URL(ESPN_SCOREBOARD_URL);
  const compactFrom = from.replaceAll("-", "");
  const compactTo = to.replaceAll("-", "");
  url.searchParams.set("dates", from === to ? compactFrom : `${compactFrom}-${compactTo}`);
  url.searchParams.set("limit", "200");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "bolao-dos-guri/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`ESPN respondeu ${response.status}.`);
  }

  const payload = await response.json();
  return Array.isArray(payload.events) ? payload.events : [];
}

function normalizeEspnEvent(event) {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find((competitor) => competitor.homeAway === "home");
  const away = competition?.competitors?.find((competitor) => competitor.homeAway === "away");
  const homeScore = Number(home?.score);
  const awayScore = Number(away?.score);

  if (!competition || !home || !away || !Number.isInteger(homeScore) || !Number.isInteger(awayScore)) {
    return null;
  }

  const penaltyHome = Number(home.shootoutScore);
  const penaltyAway = Number(away.shootoutScore);
  let penaltyWinner = null;

  if (Number.isInteger(penaltyHome) && Number.isInteger(penaltyAway) && penaltyHome !== penaltyAway) {
    penaltyWinner = penaltyHome > penaltyAway ? "home" : "away";
  }

  return {
    away: away.team?.displayName || away.team?.name || "",
    awayScore,
    completed: event.status?.type?.completed === true,
    home: home.team?.displayName || home.team?.name || "",
    homeScore,
    kickoffAt: event.date,
    penaltyWinner,
  };
}

function findInternalMatch(matches, externalMatch) {
  const kickoff = new Date(externalMatch.kickoffAt);
  const home = canonicalTeamName(externalMatch.home);
  const away = canonicalTeamName(externalMatch.away);
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
    "bosnia e herzegovina": "bosnia herzegovina",
    "bosnia and herzegovina": "bosnia herzegovina",
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
    "suecia": "sweden",
    "suica": "switzerland",
    "tchequia": "czechia",
    "turquia": "turkey",
    "united states": "usa",
    "uzbequistao": "uzbekistan",
  };

  return aliases[normalized] || normalized;
}

module.exports = {
  canonicalTeamName,
  fetchScoreboardForDate,
  fetchScoreboardForRange,
  findInternalMatch,
  normalizeEspnEvent,
  syncResultsIfStale,
};
