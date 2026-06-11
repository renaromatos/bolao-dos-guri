const { destroySession } = require("../../server/auth");
const { getBearerToken, requireMethod, sendError, sendJson } = require("../../server/http");

module.exports = async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    await destroySession(getBearerToken(req));
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
};
