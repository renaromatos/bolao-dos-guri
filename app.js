const STORAGE_KEYS = {
  session: "bolao-dos-guri:session",
};

const APP_TIME_ZONE = "America/Sao_Paulo";
const LIVE_REFRESH_MS = 15_000;

const state = {
  apiError: "",
  authMode: "register",
  completedCount: 0,
  currentUser: null,
  currentUserPredictions: {},
  followToday: true,
  loading: true,
  matches: [],
  matchesSource: "",
  ranking: [],
  results: {},
  resultsSync: null,
  selectedDate: "",
  selectedMatchId: "",
  session: null,
  todayDate: "",
  totalPredictions: 0,
  users: [],
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  bindEvents();

  state.session = getStoredSession();
  state.todayDate = getTodayDate();
  state.selectedDate = state.todayDate;

  render();
  await refreshState();
  startLiveRefresh();
}

function bindElements() {
  [
    "currentDateLabel",
    "matchdayCount",
    "sessionStatus",
    "signedInCard",
    "userAvatar",
    "signedName",
    "signedStats",
    "logoutButton",
    "authBox",
    "registerTab",
    "loginTab",
    "authForm",
    "nameInput",
    "passwordInput",
    "authSubmit",
    "authMessage",
    "totalUsers",
    "totalPredictions",
    "matchesTitle",
    "todayButton",
    "dateSelect",
    "matchList",
    "completedCount",
    "rankingList",
    "toast",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.registerTab.addEventListener("click", () => setAuthMode("register"));
  els.loginTab.addEventListener("click", () => setAuthMode("login"));
  els.authForm.addEventListener("submit", handleAuthSubmit);
  els.logoutButton.addEventListener("click", handleLogout);
  els.todayButton.addEventListener("click", selectToday);
  els.dateSelect.addEventListener("change", handleDateChange);
  els.matchList.addEventListener("click", handleMatchListClick);
  els.matchList.addEventListener("input", handleMatchListInput);
  els.matchList.addEventListener("submit", handleMatchListSubmit);
}

async function refreshState({ silent = false } = {}) {
  const draft = silent ? readOpenPredictionDraft() : null;

  if (!silent) {
    state.loading = true;
    render();
  }

  try {
    const data = await apiFetch("/api/state");
    state.apiError = "";
    state.completedCount = data.completedCount || 0;
    state.currentUser = data.currentUser || null;
    state.currentUserPredictions = data.currentUserPredictions || {};
    state.matches = data.matches || [];
    state.matchesSource = data.matchesSource || "";
    state.ranking = data.ranking || [];
    state.results = data.results || {};
    state.resultsSync = data.resultsSync || null;
    state.todayDate = data.todayDate || getTodayDate();
    state.totalPredictions = data.totalPredictions || 0;
    state.users = data.users || [];

    if (!state.currentUser && state.session?.token) {
      clearStoredSession();
      state.session = null;
    }

    if (state.followToday || !state.selectedDate) {
      state.selectedDate = state.todayDate;
    }

    syncSelectedMatchToDate();
  } catch (error) {
    state.apiError = error.message;
  } finally {
    state.loading = false;
    render();
    restoreOpenPredictionDraft(draft);
  }
}

function startLiveRefresh() {
  window.setInterval(() => {
    refreshState({ silent: true });
  }, LIVE_REFRESH_MS);
}

function selectToday() {
  state.followToday = true;
  state.selectedDate = state.todayDate || getTodayDate();
  state.selectedMatchId = "";
  render();
}

function handleDateChange(event) {
  state.selectedDate = event.target.value;
  state.followToday = state.selectedDate === state.todayDate;
  state.selectedMatchId = "";
  render();
}

function handleMatchListClick(event) {
  const toggle = event.target.closest('[data-action="toggle-match"]');
  if (!toggle) return;

  const matchId = toggle.dataset.matchId;
  state.selectedMatchId = state.selectedMatchId === matchId ? "" : matchId;
  renderMatches();
}

function handleMatchListInput(event) {
  const form = event.target.closest(".inline-prediction-form");
  if (!form) return;
  updateInlinePenaltyVisibility(form);
}

function handleMatchListSubmit(event) {
  const form = event.target.closest(".inline-prediction-form");
  if (!form) return;

  event.preventDefault();
  handlePredictionSubmit(form);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  clearAuthMessage();

  const name = els.nameInput.value.trim();
  const password = els.passwordInput.value;
  const path = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";

  try {
    const data = await apiFetch(path, {
      body: { name, password },
      method: "POST",
      skipAuth: true,
    });

    setStoredSession(data);
    state.session = data;
    state.currentUser = data.user;
    els.authForm.reset();
    showToast(state.authMode === "register" ? `${data.user.name} entrou no bolão.` : `Boa, ${data.user.name}.`);
    await refreshState();
  } catch (error) {
    setMessage(els.authMessage, error.message);
  }
}

async function handleLogout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Mesmo se a sessão expirou no servidor, limpamos a sessão local.
  }

  clearStoredSession();
  state.session = null;
  state.currentUser = null;
  state.currentUserPredictions = {};
  state.selectedMatchId = "";
  showToast("Sessão encerrada.");
  await refreshState();
}

async function handlePredictionSubmit(form) {
  const message = form.querySelector("[data-prediction-message]");
  setMessage(message, "");

  if (!state.currentUser) {
    setMessage(message, "Entre com seu nome para salvar.");
    return;
  }

  const match = getMatchById(form.dataset.matchId);
  if (!match) {
    setMessage(message, "Jogo não encontrado.");
    return;
  }

  if (hasMatchStarted(match)) {
    setMessage(message, "Esse jogo já começou. Palpites encerrados.");
    return;
  }

  const homeInput = form.querySelector('[name="homeScore"]');
  const awayInput = form.querySelector('[name="awayScore"]');
  const score = readScore(homeInput, awayInput);
  if (!score) {
    setMessage(message, "Informe um placar válido.");
    return;
  }

  const penaltyWinner = form.querySelector("[data-penalty-winner]:checked")?.value || "";
  if (match.knockout && score.homeScore === score.awayScore && !penaltyWinner) {
    setMessage(message, "Escolha o vencedor nos penais.");
    return;
  }

  const saveButton = form.querySelector('button[type="submit"]');
  saveButton.disabled = true;

  try {
    await apiFetch("/api/predictions", {
      body: {
        awayScore: score.awayScore,
        homeScore: score.homeScore,
        matchId: match.id,
        penaltyWinner: match.knockout && score.homeScore === score.awayScore ? penaltyWinner : "",
      },
      method: "POST",
    });

    showToast("Palpite salvo.");
    await refreshState();
  } catch (error) {
    handleSessionError(error);
    setMessage(message, error.message);
    saveButton.disabled = false;
  }
}

function render() {
  renderAuth();
  renderStats();
  renderDateOptions();
  renderMatches();
  renderRanking();
}

function renderAuth() {
  const user = state.currentUser;
  const userPredictions = Object.keys(state.currentUserPredictions || {}).length;

  els.sessionStatus.classList.toggle("is-online", Boolean(user));
  els.signedInCard.hidden = !user;
  els.authBox.hidden = Boolean(user);

  if (user) {
    els.userAvatar.textContent = initials(user.name);
    els.signedName.textContent = user.name;
    els.signedStats.textContent = `${userPredictions} ${plural(userPredictions, "palpite feito", "palpites feitos")}`;
  }

  els.registerTab.classList.toggle("is-active", state.authMode === "register");
  els.loginTab.classList.toggle("is-active", state.authMode === "login");
  els.registerTab.setAttribute("aria-selected", state.authMode === "register");
  els.loginTab.setAttribute("aria-selected", state.authMode === "login");
  els.authSubmit.innerHTML = state.authMode === "register"
    ? '<span aria-hidden="true">+</span>Cadastrar'
    : '<span aria-hidden="true">→</span>Entrar';
  els.passwordInput.autocomplete = state.authMode === "register" ? "new-password" : "current-password";
}

function setAuthMode(mode) {
  state.authMode = mode;
  clearAuthMessage();
  renderAuth();
}

function renderStats() {
  els.totalUsers.textContent = state.users.length;
  els.totalPredictions.textContent = state.totalPredictions;
}

function renderDateOptions() {
  const dates = getAvailableDates();
  els.dateSelect.innerHTML = dates
    .map((date) => `<option value="${date}">${formatDate(date)}</option>`)
    .join("");
  els.dateSelect.value = state.selectedDate;

  const matches = getMatchesByDate(state.selectedDate);
  const title = state.selectedDate === state.todayDate ? "Jogos do dia" : `Jogos de ${formatDate(state.selectedDate)}`;
  els.matchesTitle.textContent = title;
  els.currentDateLabel.textContent = formatDate(state.selectedDate || state.todayDate || getTodayDate());
  els.matchdayCount.textContent = `${matches.length} ${plural(matches.length, "jogo", "jogos")}`;
}

function renderMatches() {
  if (state.apiError) {
    els.matchList.innerHTML = `<div class="empty-state">${escapeHTML(state.apiError)}</div>`;
    return;
  }

  if (state.loading && !state.matches.length) {
    els.matchList.innerHTML = '<div class="empty-state">Carregando dados do bolão...</div>';
    return;
  }

  const matches = getMatchesByDate(state.selectedDate);

  if (!matches.length) {
    els.matchList.innerHTML = `<div class="empty-state">Sem jogos cadastrados para ${escapeHTML(formatDate(state.selectedDate))}.</div>`;
    return;
  }

  els.matchList.innerHTML = matches.map(renderMatchCard).join("");
}

function renderMatchCard(match) {
  const prediction = state.currentUserPredictions[match.id];
  const result = state.results[match.id];
  const locked = hasMatchStarted(match);
  const active = match.id === state.selectedMatchId;
  const predictionText = prediction ? formatPrediction(match, prediction) : "Sem palpite";
  const resultText = result
    ? `Final: ${result.homeScore} x ${result.awayScore}${formatPenaltySuffix(match, result)}`
    : "Aguardando resultado";

  return `
    <article class="match-card${active ? " is-active" : ""}${locked ? " is-locked" : ""}">
      <button
        class="match-card-toggle"
        type="button"
        data-action="toggle-match"
        data-match-id="${escapeHTML(match.id)}"
        aria-expanded="${active}"
      >
        <div class="match-meta">
          <span>${escapeHTML(match.time)} BRT</span>
          <span>${escapeHTML(match.group)}</span>
          <span>${match.knockout ? "Mata-mata" : "Grupo"}</span>
        </div>
        <div class="team-row">
          ${renderTeamLine(match.home, result?.homeScore, "home")}
          ${renderTeamLine(match.away, result?.awayScore, "away")}
        </div>
        <div class="prediction-status">
          <span>${escapeHTML(predictionText)}</span>
          <span class="${locked ? "locked-chip" : ""}">${escapeHTML(getBettingStatusText(match))}</span>
        </div>
        <div class="result-status">
          <span>${escapeHTML(resultText)}</span>
        </div>
        <span class="card-disclosure" aria-hidden="true">${active ? "−" : "+"}</span>
      </button>
      ${active ? renderInlinePredictionForm(match, prediction, locked) : ""}
    </article>
  `;
}

function renderInlinePredictionForm(match, prediction, locked) {
  const disabled = !state.currentUser || locked || state.loading;
  const homeScore = prediction?.homeScore ?? "";
  const awayScore = prediction?.awayScore ?? "";
  const showPenalties =
    match.knockout &&
    homeScore !== "" &&
    awayScore !== "" &&
    Number(homeScore) === Number(awayScore);
  const buttonText = locked ? "Palpites encerrados" : !state.currentUser ? "Entre para salvar" : "Salvar palpite";

  return `
    <form class="inline-prediction-form" data-match-id="${escapeHTML(match.id)}">
      <div class="inline-score-row">
        <label>
          <span>${escapeHTML(match.home)}</span>
          <input
            name="homeScore"
            type="number"
            min="0"
            max="30"
            inputmode="numeric"
            value="${escapeHTML(homeScore)}"
            ${disabled ? "disabled" : ""}
            required
          />
        </label>
        <span class="score-separator">×</span>
        <label>
          <span>${escapeHTML(match.away)}</span>
          <input
            name="awayScore"
            type="number"
            min="0"
            max="30"
            inputmode="numeric"
            value="${escapeHTML(awayScore)}"
            ${disabled ? "disabled" : ""}
            required
          />
        </label>
      </div>

      <fieldset class="penalty-box" data-penalty-box ${showPenalties ? "" : "hidden"}>
        <legend>Vencedor nos penais</legend>
        <label>
          <input
            type="radio"
            name="penaltyWinner"
            value="home"
            data-penalty-winner
            ${prediction?.penaltyWinner === "home" ? "checked" : ""}
            ${disabled ? "disabled" : ""}
          />
          <span>${escapeHTML(match.home)}</span>
        </label>
        <label>
          <input
            type="radio"
            name="penaltyWinner"
            value="away"
            data-penalty-winner
            ${prediction?.penaltyWinner === "away" ? "checked" : ""}
            ${disabled ? "disabled" : ""}
          />
          <span>${escapeHTML(match.away)}</span>
        </label>
      </fieldset>

      <button class="primary-button" type="submit" ${disabled ? "disabled" : ""}>
        <span aria-hidden="true">${locked || !state.currentUser ? "!" : "✓"}</span>
        ${buttonText}
      </button>
      <p class="form-message" data-prediction-message role="alert"></p>
    </form>
  `;
}

function renderTeamLine(team, score, side) {
  const scoreText = score ?? "-";
  return `
    <div class="team-line">
      <span class="team-badge ${side === "away" ? "away" : ""}">${escapeHTML(initials(team))}</span>
      <strong>${escapeHTML(team)}</strong>
      <span class="team-score">${scoreText}</span>
    </div>
  `;
}

function renderRanking() {
  els.completedCount.textContent = `${state.completedCount} ${plural(state.completedCount, "final", "finais")}`;

  if (!state.ranking.length) {
    els.rankingList.innerHTML = `
      <li class="ranking-item">
        <span class="rank-position">-</span>
        <span>
          <strong class="ranking-name">Sem jogadores</strong>
          <span class="ranking-detail">Cadastre o primeiro nome</span>
        </span>
        <span class="ranking-points">0</span>
      </li>
    `;
    return;
  }

  els.rankingList.innerHTML = state.ranking
    .map((entry, index) => {
      const currentClass = state.currentUser?.id === entry.user.id ? " is-current" : "";
      return `
        <li class="ranking-item${currentClass}">
          <span class="rank-position">${index + 1}</span>
          <span>
            <strong class="ranking-name">${escapeHTML(entry.user.name)}</strong>
            <span class="ranking-detail">${entry.exactHits} placar, ${entry.winnerHits} resultado</span>
          </span>
          <span class="ranking-points">${entry.points}</span>
        </li>
      `;
    })
    .join("");
}

function updateInlinePenaltyVisibility(form) {
  const match = getMatchById(form.dataset.matchId);
  const penaltyBox = form.querySelector("[data-penalty-box]");
  if (!match || !penaltyBox) return;

  const homeValue = form.querySelector('[name="homeScore"]').value;
  const awayValue = form.querySelector('[name="awayScore"]').value;
  const show =
    match.knockout &&
    homeValue !== "" &&
    awayValue !== "" &&
    Number(homeValue) === Number(awayValue);

  penaltyBox.hidden = !show;

  if (!show) {
    form.querySelectorAll("[data-penalty-winner]").forEach((input) => {
      input.checked = false;
    });
  }
}

function readOpenPredictionDraft() {
  const form = els.matchList.querySelector(".inline-prediction-form");
  if (!form) return null;

  return {
    awayScore: form.querySelector('[name="awayScore"]')?.value ?? "",
    homeScore: form.querySelector('[name="homeScore"]')?.value ?? "",
    matchId: form.dataset.matchId,
    penaltyWinner: form.querySelector("[data-penalty-winner]:checked")?.value || "",
  };
}

function restoreOpenPredictionDraft(draft) {
  if (!draft || draft.matchId !== state.selectedMatchId) return;

  const form = els.matchList.querySelector(`.inline-prediction-form[data-match-id="${cssEscape(draft.matchId)}"]`);
  if (!form) return;

  const homeInput = form.querySelector('[name="homeScore"]');
  const awayInput = form.querySelector('[name="awayScore"]');
  if (!homeInput.disabled) homeInput.value = draft.homeScore;
  if (!awayInput.disabled) awayInput.value = draft.awayScore;

  form.querySelectorAll("[data-penalty-winner]").forEach((input) => {
    input.checked = input.value === draft.penaltyWinner;
  });
  updateInlinePenaltyVisibility(form);
}

async function apiFetch(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (!options.skipAuth && state.session?.token) {
    headers.Authorization = `Bearer ${state.session.token}`;
  }

  const response = await fetch(path, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method || "GET",
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error || "Não foi possível falar com o servidor.");
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

function handleSessionError(error) {
  if (error.statusCode !== 401) return;

  clearStoredSession();
  state.session = null;
  state.currentUser = null;
}

function getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.session)) || null;
  } catch {
    return null;
  }
}

function setStoredSession(session) {
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
}

function clearStoredSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

function syncSelectedMatchToDate() {
  const selectedMatchIsInDate = getMatchesByDate(state.selectedDate).some(
    (match) => match.id === state.selectedMatchId,
  );
  if (!selectedMatchIsInDate) state.selectedMatchId = "";
}

function getMatchById(id) {
  return state.matches.find((match) => match.id === id) || null;
}

function getMatchesByDate(date) {
  return state.matches.filter((match) => match.date === date);
}

function getAvailableDates() {
  return [...new Set([state.todayDate || getTodayDate(), ...state.matches.map((match) => match.date)])].sort();
}

function hasMatchStarted(match, now = new Date()) {
  return now >= getKickoffDate(match);
}

function getKickoffDate(match) {
  return match.kickoffAt ? new Date(match.kickoffAt) : new Date(`${match.date}T${match.time}:00-03:00`);
}

function getBettingStatusText(match) {
  return hasMatchStarted(match) ? "Palpites encerrados" : `Palpites até ${match.time} BRT`;
}

function formatPrediction(match, prediction) {
  return `Palpite: ${prediction.homeScore} x ${prediction.awayScore}${formatPenaltySuffix(match, prediction)}`;
}

function formatPenaltySuffix(match, score) {
  if (!match.knockout || score.homeScore !== score.awayScore || !score.penaltyWinner) {
    return "";
  }

  const winner = score.penaltyWinner === "home" ? match.home : match.away;
  return `, ${winner} nos penais`;
}

function readScore(homeInput, awayInput) {
  const homeScore = Number(homeInput.value);
  const awayScore = Number(awayInput.value);
  const valid =
    homeInput.value !== "" &&
    awayInput.value !== "" &&
    Number.isInteger(homeScore) &&
    Number.isInteger(awayScore) &&
    homeScore >= 0 &&
    awayScore >= 0 &&
    homeScore <= 30 &&
    awayScore <= 30;

  return valid ? { homeScore, awayScore } : null;
}

function setMessage(element, message) {
  if (element) element.textContent = message;
}

function clearAuthMessage() {
  els.authMessage.textContent = "";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 2400);
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

function formatDate(date) {
  if (!date) return "--/--/----";

  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function plural(count, singular, pluralText) {
  return count === 1 ? singular : pluralText;
}

function initials(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("pt-BR");
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
