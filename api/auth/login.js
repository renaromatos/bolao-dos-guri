const { createSession, normalizeName, validateName, validatePassword, verifyPassword } = require("../../server/auth");
const { query } = require("../../server/db");
const { readJsonBody, requireMethod, sendError, sendJson } = require("../../server/http");

module.exports = async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const body = await readJsonBody(req);
    const name = validateName(body.name);
    const password = validatePassword(body.password);
    const { rows } = await query(
      `SELECT id, name, password_hash, password_salt
         FROM users
        WHERE normalized_name = $1
        LIMIT 1`,
      [normalizeName(name)],
    );
    const user = rows[0];

    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      throw Object.assign(new Error("Nome ou senha inválidos."), { statusCode: 401 });
    }

    const token = await createSession(user.id);
    sendJson(res, 200, {
      token,
      user: {
        id: user.id,
        name: user.name,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
};
