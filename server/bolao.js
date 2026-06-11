const matches = require("../data/matches.json");

const APP_TIME_ZONE = "America/Sao_Paulo";
const MATCH_TIME_OFFSET = "-03:00";
const POINTS = {
  winner: 1,
  exactScore: 3,
};

function getMatchById(matchId) {
  return matches.find((match) => match.id === matchId) || null;
}

function getTodayDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getKickoffDate(match) {
  return new Date(`${match.date}T${match.time}:00${MATCH_TIME_OFFSET}`);
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

function validatePredictionPayload(body) {
  const match = getMatchById(body.matchId);
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

function validateResultPayload(body) {
  const match = getMatchById(body.matchId);
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

function calculateRanking(users, predictions, results) {
  return users
    .map((user) => {
      const userPredictions = predictions.filter((prediction) => prediction.user_id === user.id);

      return results.reduce(
        (entry, result) => {
          const prediction = userPredictions.find((item) => item.match_id === result.match_id);
          const match = getMatchById(result.match_id);
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
  getTodayDate,
  hasMatchStarted,
  matches,
  predictionRowsToMap,
  resultRowsToMap,
  validatePredictionPayload,
  validateResultPayload,
};
