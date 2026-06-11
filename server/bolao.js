const fallbackMatches = require("../data/matches.json");

const APP_TIME_ZONE = "America/Sao_Paulo";
const MATCHES_API_URL =
  process.env.MATCHES_API_URL || "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const MATCHES_CACHE_MS = Number(process.env.MATCHES_CACHE_MS || 60 * 60 * 1000);
const POINTS = {
  winner: 1,
  exactScore: 3,
};

const TEAM_NAMES = {
  "Bosnia & Herzegovina": "Bósnia e Herzegovina",
  "Cape Verde": "Cabo Verde",
  "Curaçao": "Curaçao",
  "Czech Republic": "Tchéquia",
  "DR Congo": "RD Congo",
  "Ivory Coast": "Costa do Marfim",
  Mexico: "México",
  Netherlands: "Países Baixos",
  "New Zealand": "Nova Zelândia",
  Qatar: "Catar",
  "Saudi Arabia": "Arábia Saudita",
  Scotland: "Escócia",
  "South Africa": "África do Sul",
  "South Korea": "Coreia do Sul",
  Spain: "Espanha",
  Sweden: "Suécia",
  Switzerland: "Suíça",
  Turkey: "Turquia",
  USA: "Estados Unidos",
  Uzbekistan: "Uzbequistão",
};

const ROUND_NAMES = {
  Final: "Final",
  "Match for third place": "Disputa do 3º lugar",
  "Quarter-final": "Quartas de final",
  "Round of 16": "Oitavas de final",
  "Round of 32": "Fase de 32",
  "Semi-final": "Semifinal",
};

let matchesCache = null;
let matchesCacheExpiresAt = 0;
let matchesSource = "fallback";
let pendingMatchesFetch = null;

async function getMatches({ force = false } = {}) {
  const now = Date.now();
  if (!force && matchesCache && now < matchesCacheExpiresAt) {
    return matchesCache;
  }

  if (!pendingMatchesFetch) {
    pendingMatchesFetch = fetchOpenFootballMatches()
      .then((matches) => {
        matchesCache = matches;
        matchesSource = "openfootball";
        matchesCacheExpiresAt = Date.now() + MATCHES_CACHE_MS;
        return matchesCache;
      })
      .catch(() => {
        matchesCache = normalizeFallbackMatches();
        matchesSource = "fallback";
        matchesCacheExpiresAt = Date.now() + Math.min(MATCHES_CACHE_MS, 5 * 60 * 1000);
        return matchesCache;
      })
      .finally(() => {
        pendingMatchesFetch = null;
      });
  }

  return pendingMatchesFetch;
}

function getMatchesSource() {
  return matchesSource;
}

async function getMatchById(matchId) {
  const matches = await getMatches();
  return findMatchById(matches, matchId);
}

function findMatchById(matches, matchId) {
  return matches.find((match) => match.id === matchId) || null;
}

async function fetchOpenFootballMatches() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(MATCHES_API_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Fonte de jogos respondeu ${response.status}.`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload.matches)) {
      throw new Error("Fonte de jogos sem lista de partidas.");
    }

    return payload.matches.map(normalizeOpenFootballMatch).sort(sortMatches);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeFallbackMatches() {
  return fallbackMatches.map((match) => ({
    ...match,
    kickoffAt: match.kickoffAt || new Date(`${match.date}T${match.time}:00-03:00`).toISOString(),
    source: "fallback",
  }));
}

function normalizeOpenFootballMatch(match) {
  const kickoff = parseOpenFootballKickoff(match.date, match.time);
  const brt = getDateTimeParts(kickoff, APP_TIME_ZONE);
  const knockout = !match.group;
  const num = match.num ? Number(match.num) : null;

  return {
    date: brt.date,
    group: match.group ? translateGroup(match.group) : num ? `Jogo ${num}` : translateRound(match.round),
    home: formatTeamName(match.team1),
    id: createMatchId(match),
    kickoffAt: kickoff.toISOString(),
    knockout,
    originalDate: match.date,
    originalTime: match.time,
    round: match.round,
    source: "openfootball",
    stage: knockout ? translateRound(match.round) : "Fase de grupos",
    time: brt.time,
    venue: match.ground || "A definir",
    away: formatTeamName(match.team2),
  };
}

function parseOpenFootballKickoff(date, time) {
  const match = String(time || "").match(/^(\d{1,2}):(\d{2})(?:\s+UTC([+-]\d{1,2}))?$/);
  if (!match) {
    return new Date(`${date}T00:00:00-03:00`);
  }

  const [, hour, minute, offset = "-3"] = match;
  const offsetNumber = Number(offset);
  const sign = offsetNumber >= 0 ? "+" : "-";
  const offsetHours = String(Math.abs(offsetNumber)).padStart(2, "0");
  return new Date(`${date}T${hour.padStart(2, "0")}:${minute}:00${sign}${offsetHours}:00`);
}

function createMatchId(match) {
  if (match.num) return `wc2026-${match.num}`;
  return `wc2026-${slugify([match.date, match.time, match.team1, match.team2].join("-"))}`;
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatTeamName(value) {
  const team = String(value || "");
  if (TEAM_NAMES[team]) return TEAM_NAMES[team];

  const winner = team.match(/^W(\d+)$/);
  if (winner) return `Vencedor Jogo ${winner[1]}`;

  const loser = team.match(/^L(\d+)$/);
  if (loser) return `Perdedor Jogo ${loser[1]}`;

  const groupPosition = team.match(/^(\d)([A-L](?:\/[A-L])*)$/);
  if (groupPosition) return `${groupPosition[1]}º Grupo ${groupPosition[2]}`;

  return team;
}

function translateGroup(value) {
  const match = String(value || "").match(/^Group ([A-L])$/);
  return match ? `Grupo ${match[1]}` : value;
}

function translateRound(value) {
  const matchday = String(value || "").match(/^Matchday (\d+)$/);
  if (matchday) return `Rodada ${matchday[1]}`;
  return ROUND_NAMES[value] || value || "Eliminatória";
}

function sortMatches(a, b) {
  return new Date(a.kickoffAt) - new Date(b.kickoffAt) || a.home.localeCompare(b.home, "pt-BR");
}

function getDateTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function getTodayDate(date = new Date()) {
  const parts = getDateTimeParts(date, APP_TIME_ZONE);
  return parts.date;
}

function getKickoffDate(match) {
  return match.kickoffAt ? new Date(match.kickoffAt) : new Date(`${match.date}T${match.time}:00-03:00`);
}

function hasMatchStarted(match, now = new Date()) {
  return now >= getKickoffDate(match);
}

function validateScore(homeScore, awayScore) {
  const home = Number(homeScore);
  const away = Number(awayScore);
  const valid =
    Number.isInteger(home) &&
    Number.isInteger(away) &&
    home >= 0 &&
    home <= 30 &&
    away >= 0 &&
    away <= 30;

  if (!valid) {
    throw Object.assign(new Error("Informe um placar válido."), { statusCode: 400 });
  }

  return {
    homeScore: home,
    awayScore: away,
  };
}

function validatePenaltyWinner(match, score, penaltyWinner) {
  const normalized = penaltyWinner || null;

  if (!match.knockout) return null;
  if (score.homeScore !== score.awayScore) return null;

  if (normalized !== "home" && normalized !== "away") {
    throw Object.assign(new Error("Escolha o vencedor nos penais."), { statusCode: 400 });
  }

  return normalized;
}

async function validatePredictionPayload(body) {
  const match = await getMatchById(body.matchId);
  if (!match) {
    throw Object.assign(new Error("Jogo não encontrado."), { statusCode: 404 });
  }

  if (hasMatchStarted(match)) {
    throw Object.assign(new Error("Esse jogo já começou. Palpites encerrados."), { statusCode: 409 });
  }

  const score = validateScore(body.homeScore, body.awayScore);
  const penaltyWinner = validatePenaltyWinner(match, score, body.penaltyWinner);

  return {
    match,
    penaltyWinner,
    score,
  };
}

async function validateResultPayload(body) {
  const match = await getMatchById(body.matchId);
  if (!match) {
    throw Object.assign(new Error("Jogo não encontrado."), { statusCode: 404 });
  }

  const score = validateScore(body.homeScore, body.awayScore);
  const penaltyWinner = validatePenaltyWinner(match, score, body.penaltyWinner);

  return {
    match,
    penaltyWinner,
    score,
  };
}

function getOutcome(match, score) {
  if (Number(score.home_score ?? score.homeScore) > Number(score.away_score ?? score.awayScore)) return "home";
  if (Number(score.away_score ?? score.awayScore) > Number(score.home_score ?? score.homeScore)) return "away";
  if (match.knockout) return score.penalty_winner || score.penaltyWinner || "pending";
  return "draw";
}

function scorePrediction(match, prediction, result) {
  const exactHit =
    Number(prediction.home_score) === Number(result.home_score) &&
    Number(prediction.away_score) === Number(result.away_score);
  const winnerHit = getOutcome(match, prediction) === getOutcome(match, result);

  return {
    exactHit,
    points: exactHit ? POINTS.exactScore : winnerHit ? POINTS.winner : 0,
    winnerHit,
  };
}

function calculateRanking(users, predictions, results, matches) {
  return users
    .map((user) => {
      const userPredictions = predictions.filter((prediction) => prediction.user_id === user.id);

      return results.reduce(
        (entry, result) => {
          const prediction = userPredictions.find((item) => item.match_id === result.match_id);
          const match = findMatchById(matches, result.match_id);
          if (!prediction || !match) return entry;

          const score = scorePrediction(match, prediction, result);
          entry.points += score.points;
          entry.exactHits += score.exactHit ? 1 : 0;
          entry.winnerHits += score.winnerHit ? 1 : 0;
          return entry;
        },
        {
          exactHits: 0,
          points: 0,
          user: { id: user.id, name: user.name },
          winnerHits: 0,
        },
      );
    })
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.exactHits !== a.exactHits) return b.exactHits - a.exactHits;
      if (b.winnerHits !== a.winnerHits) return b.winnerHits - a.winnerHits;
      return a.user.name.localeCompare(b.user.name, "pt-BR");
    });
}

function predictionRowsToMap(rows) {
  return Object.fromEntries(
    rows.map((row) => [
      row.match_id,
      {
        awayScore: row.away_score,
        homeScore: row.home_score,
        penaltyWinner: row.penalty_winner || "",
      },
    ]),
  );
}

function resultRowsToMap(rows) {
  return Object.fromEntries(
    rows.map((row) => [
      row.match_id,
      {
        awayScore: row.away_score,
        homeScore: row.home_score,
        penaltyWinner: row.penalty_winner || "",
      },
    ]),
  );
}

module.exports = {
  calculateRanking,
  getMatchById,
  getMatches,
  getMatchesSource,
  getTodayDate,
  hasMatchStarted,
  predictionRowsToMap,
  resultRowsToMap,
  validatePredictionPayload,
  validateResultPayload,
};
