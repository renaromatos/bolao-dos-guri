function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  const message = error.publicMessage || (statusCode >= 500 ? "Erro interno do servidor." : error.message);
  sendJson(res, statusCode, { error: message });
}

function requireMethod(req, res, methods) {
  if (methods.includes(req.method)) return true;

  res.setHeader("Allow", methods.join(", "));
  sendJson(res, 405, { error: "Método não permitido." });
  return false;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");
  return type === "Bearer" && token ? token : "";
}

async function readJsonBody(req) {
  try {
    if (req.body && typeof req.body === "object") return req.body;
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw Object.assign(new Error("JSON inválido."), { statusCode: 400 });
  }
}

module.exports = {
  getBearerToken,
  readJsonBody,
  requireMethod,
  sendError,
  sendJson,
};
