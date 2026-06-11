const { readJsonBody, requireMethod, sendError, sendJson } = require("../server/http");
const { query } = require("../server/db");
const { validateResultPayload } = require("../server/bolao");

function requireAdminPin(req) {
  const expected = process.env.ADMIN_PIN;
  if (!expected) {
    throw Object.assign(new Error("ADMIN_PIN não configurado no ambiente."), {
      publicMessage: "ADMIN_PIN não configurado no ambiente.",
      statusCode: 500,
    });
  }

  if (req.headers["x-admin-pin"] !== expected) {
    throw Object.assign(new Error("PIN de admin inválido."), { statusCode: 401 });
  }
}

module.exports = async function handler(req, res) {
  if (!requireMethod(req, res, ["POST", "DELETE"])) return;

  try {
    requireAdminPin(req);
    const body = await readJsonBody(req);

    if (req.method === "DELETE") {
      if (!body.matchId) {
        throw Object.assign(new Error("Selecione um jogo válido."), { statusCode: 400 });
      }

      await query("DELETE FROM results WHERE match_id = $1", [body.matchId]);
      sendJson(res, 200, { ok: true });
      return;
    }

    const { match, penaltyWinner, score } = await validateResultPayload(body);
    await query(
      `INSERT INTO results (match_id, home_score, away_score, penalty_winner, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (match_id)
       DO UPDATE SET
         home_score = EXCLUDED.home_score,
         away_score = EXCLUDED.away_score,
         penalty_winner = EXCLUDED.penalty_winner,
         updated_at = now()`,
      [match.id, score.homeScore, score.awayScore, penaltyWinner],
    );

    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
};
