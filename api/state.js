const { getBearerToken, requireMethod, sendError, sendJson } = require("../server/http");
const { getUserByToken } = require("../server/auth");
const { query } = require("../server/db");
const {
  calculateRanking,
  getMatches,
  getMatchesSource,
  getTodayDate,
  predictionRowsToMap,
  resultRowsToMap,
} = require("../server/bolao");

module.exports = async function handler(req, res) {
  if (!requireMethod(req, res, ["GET"])) return;

  try {
    const token = getBearerToken(req);
    const currentUser = await getUserByToken(token);
    const matches = await getMatches();
    const [usersResult, predictionsResult, resultsResult, totalPredictionsResult] = await Promise.all([
      query("SELECT id, name, created_at FROM users ORDER BY name ASC"),
      query("SELECT user_id, match_id, home_score, away_score, penalty_winner FROM predictions"),
      query("SELECT match_id, home_score, away_score, penalty_winner FROM results"),
      query("SELECT COUNT(*)::int AS total FROM predictions"),
    ]);

    const currentUserPredictions = currentUser
      ? predictionRowsToMap(predictionsResult.rows.filter((prediction) => prediction.user_id === currentUser.id))
      : {};

    sendJson(res, 200, {
      completedCount: resultsResult.rows.length,
      currentUser,
      currentUserPredictions,
      matches,
      matchesSource: getMatchesSource(),
      ranking: calculateRanking(usersResult.rows, predictionsResult.rows, resultsResult.rows, matches),
      results: resultRowsToMap(resultsResult.rows),
      serverNow: new Date().toISOString(),
      todayDate: getTodayDate(),
      totalPredictions: totalPredictionsResult.rows[0]?.total || 0,
      users: usersResult.rows.map((user) => ({ id: user.id, name: user.name })),
    });
  } catch (error) {
    sendError(res, error);
  }
};
