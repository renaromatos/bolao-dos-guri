const crypto = require("crypto");
const {
  createPasswordRecord,
  createSession,
  normalizeName,
  validateName,
  validatePassword,
} = require("../../server/auth");
const { query } = require("../../server/db");
const { readJsonBody, requireMethod, sendError, sendJson } = require("../../server/http");

module.exports = async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const body = await readJsonBody(req);
    const name = validateName(body.name);
    const password = validatePassword(body.password);
    const { passwordHash, salt } = createPasswordRecord(password);
    const userId = crypto.randomUUID();

    await query(
      `INSERT INTO users (id, name, normalized_name, password_hash, password_salt)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, name, normalizeName(name), passwordHash, salt],
    );

    const token = await createSession(userId);
    sendJson(res, 201, {
      token,
      user: {
        id: userId,
        name,
      },
    });
  } catch (error) {
    if (error.code === "23505") {
      sendError(res, Object.assign(new Error("Esse nome já está no bolão."), { statusCode: 409 }));
      return;
    }

    sendError(res, error);
  }
};
