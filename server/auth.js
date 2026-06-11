const crypto = require("crypto");
const { query } = require("./db");

const SESSION_DAYS = 30;

function normalizeName(name) {
  return String(name || "").trim().toLocaleLowerCase("pt-BR");
}

function validateName(name) {
  const trimmed = String(name || "").trim();
  if (trimmed.length < 2) {
    throw Object.assign(new Error("Use pelo menos 2 letras no nome."), { statusCode: 400 });
  }

  if (trimmed.length > 32) {
    throw Object.assign(new Error("Use no máximo 32 caracteres no nome."), { statusCode: 400 });
  }

  return trimmed;
}

function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 4) {
    throw Object.assign(new Error("A senha precisa ter pelo menos 4 caracteres."), { statusCode: 400 });
  }

  return value;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    passwordHash: hashPassword(password, salt),
    salt,
  };
}

function verifyPassword(password, salt, passwordHash) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(passwordHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [tokenHash, userId, SESSION_DAYS],
  );

  return token;
}

async function getUserByToken(token) {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const { rows } = await query(
    `SELECT users.id, users.name
       FROM sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1
        AND sessions.expires_at > now()
      LIMIT 1`,
    [tokenHash],
  );

  return rows[0] || null;
}

async function requireUser(token) {
  const user = await getUserByToken(token);
  if (!user) {
    throw Object.assign(new Error("Sessão inválida. Faça login novamente."), { statusCode: 401 });
  }

  return user;
}

async function destroySession(token) {
  if (!token) return;
  await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

module.exports = {
  createPasswordRecord,
  createSession,
  destroySession,
  getUserByToken,
  normalizeName,
  requireUser,
  validateName,
  validatePassword,
  verifyPassword,
};
