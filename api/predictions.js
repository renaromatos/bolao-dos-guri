const { getBearerToken, readJsonBody, requireMethod, sendError, sendJson } = require("../server/http");
const { requireUser } = require("../server/auth");
const { query } = require("../server/db");
const { validatePredictionPayload } = require("../server/bolao");

module.exports = async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireUser(getBearerToken(req));
    const body = await readJsonBody(req);
    const { match, penaltyWinner, score } = await validatePredictionPayload(body);

    await query(
      `INSERT INTO predictions (user_id, match_id, home_score, away_score, penalty_winner, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, match_id)
       DO UPDATE SET
         home_score = EXCLUDED.home_score,
         away_score = EXCLUDED.away_score,
         penalty_winner = EXCLUDED.penalty_winner,
         updated_at = now()`,
      [user.id, match.id, score.homeScore, score.awayScore, penaltyWinner],
    );

    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
};
