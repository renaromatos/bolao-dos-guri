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
  selectedDate: "",
  selectedMatchId: "",
  selectedResultMatchId: "",
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
    "selectedStage",
    "selectedMatchSummary",
    "predictionForm",
    "homeScoreLabel",
    "awayScoreLabel",
    "homeScoreInput",
    "awayScoreInput",
    "penaltyBox",
    "penaltyHomeLabel",
    "penaltyAwayLabel",
    "savePredictionButton",
    "predictionMessage",
    "completedCount",
    "rankingList",
    "resultForm",
    "adminPinInput",
    "resultMatchSelect",
    "resultHomeLabel",
    "resultAwayLabel",
    "resultHomeInput",
    "resultAwayInput",
    "resultPenaltyBox",
    "resultPenaltyHomeLabel",
    "resultPenaltyAwayLabel",
    "clearResultButton",
    "resultMessage",
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
  els.matchList.addEventListener("click", handleMatchClick);
  els.predictionForm.addEventListener("submit", handlePredictionSubmit);
  els.homeScoreInput.addEventListener("input", updatePenaltyVisibility);
  els.awayScoreInput.addEventListener("input", updatePenaltyVisibility);
  els.resultMatchSelect.addEventListener("change", handleResultMatchChange);
  els.resultForm.addEventListener("submit", handleResultSubmit);
  els.resultHomeInput.addEventListener("input", updateResultPenaltyVisibility);
  els.resultAwayInput.addEventListener("input", updateResultPenaltyVisibility);
  els.clearResultButton.addEventListener("click", clearSelectedResult);
}

async function refreshState({ silent = false } = {}) {
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
    syncSelectedResultMatch();
  } catch (error) {
    state.apiError = error.message;
  } finally {
    state.loading = false;
    render();
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
  syncSelectedMatchToDate();
  render();
}

function handleDateChange(event) {
  state.selectedDate = event.target.value;
  state.followToday = state.selectedDate === state.todayDate;
  syncSelectedMatchToDate();
  render();
}

function handleMatchClick(event) {
  const card = event.target.closest("[data-match-id]");
  if (!card) return;

  state.selectedMatchId = card.dataset.matchId;
  render();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  clearMessages();

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
    // Mesmo se a sessão já expirou no servidor, limpamos a sessão local.
  }

  clearStoredSession();
  state.session = null;
  state.currentUser = null;
  state.currentUserPredictions = {};
  showToast("Sessão encerrada.");
  await refreshState();
}

async function handlePredictionSubmit(event) {
  event.preventDefault();
  clearMessages();

  if (!state.currentUser) {
    setMessage(els.predictionMessage, "Entre com seu nome para salvar.");
    return;
  }

  const match = getSelectedMatch();
  if (!match) {
    setMessage(els.predictionMessage, "Selecione um jogo para palpitar.");
    return;
  }

  if (hasMatchStarted(match)) {
    setMessage(els.predictionMessage, "Esse jogo já começou. Palpites encerrados.");
    return;
  }

  const score = readScore(els.homeScoreInput, els.awayScoreInput);
  if (!score) {
    setMessage(els.predictionMessage, "Informe um placar válido.");
    return;
  }

  const penaltyWinner = getSelectedRadioValue("penaltyWinner");
  if (match.knockout && score.homeScore === score.awayScore && !penaltyWinner) {
    setMessage(els.predictionMessage, "Escolha o vencedor nos penais.");
    return;
  }

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
    setMessage(els.predictionMessage, error.message);
  }
}

function handleResultMatchChange(event) {
  state.selectedResultMatchId = event.target.value;
  renderResultForm();
}

async function handleResultSubmit(event) {
  event.preventDefault();
  clearMessages();

  const match = getMatchById(state.selectedResultMatchId);
  if (!match) {
    setMessage(els.resultMessage, "Selecione um jogo válido.");
    return;
  }

  const score = readScore(els.resultHomeInput, els.resultAwayInput);
  if (!score) {
    setMessage(els.resultMessage, "Informe um resultado válido.");
    return;
  }

  const penaltyWinner = getSelectedRadioValue("resultPenaltyWinner");
  if (match.knockout && score.homeScore === score.awayScore && !penaltyWinner) {
    setMessage(els.resultMessage, "Escolha o vencedor nos penais.");
    return;
  }

  try {
    await apiFetch("/api/results", {
      body: {
        awayScore: score.awayScore,
        homeScore: score.homeScore,
        matchId: match.id,
        penaltyWinner: match.knockout && score.homeScore === score.awayScore ? penaltyWinner : "",
      },
      headers: getAdminHeaders(),
      method: "POST",
      skipAuth: true,
    });

    showToast("Resultado atualizado.");
    await refreshState();
  } catch (error) {
    setMessage(els.resultMessage, error.message);
  }
}

async function clearSelectedResult() {
  clearMessages();

  const match = getMatchById(state.selectedResultMatchId);
  if (!match) return;

  try {
    await apiFetch("/api/results", {
      body: { matchId: match.id },
      headers: getAdminHeaders(),
      method: "DELETE",
      skipAuth: true,
    });

    showToast("Resultado removido.");
    await refreshState();
  } catch (error) {
    setMessage(els.resultMessage, error.message);
  }
}

function render() {
  renderAuth();
  renderStats();
  renderDateOptions();
  renderMatches();
  renderPredictionForm();
  renderRanking();
  renderResultOptions();
  renderResultForm();
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
  clearMessages();
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

  els.matchList.innerHTML = matches
    .map((match) => {
      const prediction = state.currentUserPredictions[match.id];
      const result = state.results[match.id];
      const locked = hasMatchStarted(match);
      const active = match.id === state.selectedMatchId ? " is-active" : "";
      const lockedClass = locked ? " is-locked" : "";
      const predictionText = prediction ? formatPrediction(match, prediction) : "Sem palpite";
      const resultText = result ? `Final: ${result.homeScore} x ${result.awayScore}${formatPenaltySuffix(match, result)}` : "Aberto";

      return `
        <button class="match-card${active}${lockedClass}" type="button" data-match-id="${match.id}">
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
        </button>
      `;
    })
    .join("");
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

function renderPredictionForm() {
  const match = getSelectedMatch();
  const user = state.currentUser;

  if (!match || state.apiError) {
    els.selectedStage.textContent = state.apiError ? "API" : "Sem jogo";
    els.selectedMatchSummary.innerHTML = `
      <div class="selected-match-empty">
        ${escapeHTML(state.apiError || `Nenhum jogo cadastrado para ${formatDate(state.selectedDate)}.`)}
      </div>
    `;
    [els.homeScoreInput, els.awayScoreInput, els.savePredictionButton].forEach((field) => {
      field.disabled = true;
      if (field.tagName === "INPUT") field.value = "";
    });
    document.querySelectorAll('input[name="penaltyWinner"]').forEach((input) => {
      input.disabled = true;
    });
    els.penaltyBox.hidden = true;
    els.savePredictionButton.innerHTML = '<span aria-hidden="true">!</span>Indisponível';
    return;
  }

  const prediction = state.currentUserPredictions[match.id];
  const locked = hasMatchStarted(match);

  els.selectedStage.textContent = match.knockout ? "Eliminatória" : "Grupo";
  els.selectedMatchSummary.innerHTML = `
    <div class="match-meta">
      <span>${escapeHTML(match.stage)}</span>
      <span>${escapeHTML(match.time)} BRT</span>
      <span>${escapeHTML(match.venue)}</span>
      <span class="${locked ? "locked-chip" : ""}">${escapeHTML(getBettingStatusText(match))}</span>
    </div>
    <div class="selected-versus">
      <div class="selected-team"><strong>${escapeHTML(match.home)}</strong></div>
      <span>vs</span>
      <div class="selected-team"><strong>${escapeHTML(match.away)}</strong></div>
    </div>
  `;

  els.homeScoreLabel.textContent = match.home;
  els.awayScoreLabel.textContent = match.away;
  els.penaltyHomeLabel.textContent = match.home;
  els.penaltyAwayLabel.textContent = match.away;
  els.homeScoreInput.value = prediction?.homeScore ?? "";
  els.awayScoreInput.value = prediction?.awayScore ?? "";
  setRadioValue("penaltyWinner", prediction?.penaltyWinner || "");

  const disabled = !user || locked || state.loading;
  [els.homeScoreInput, els.awayScoreInput, els.savePredictionButton].forEach((field) => {
    field.disabled = disabled;
  });
  document.querySelectorAll('input[name="penaltyWinner"]').forEach((input) => {
    input.disabled = disabled;
  });

  els.savePredictionButton.innerHTML = locked
    ? '<span aria-hidden="true">!</span>Palpites encerrados'
    : !user
    ? '<span aria-hidden="true">!</span>Entrar para salvar'
    : '<span aria-hidden="true">✓</span>Salvar palpite';

  updatePenaltyVisibility();
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

function renderResultOptions() {
  const options = state.matches.map((match) => {
    const label = `${formatDate(match.date)} - ${match.home} x ${match.away}`;
    return `<option value="${match.id}">${escapeHTML(label)}</option>`;
  }).join("");

  els.resultMatchSelect.innerHTML = options;
  els.resultMatchSelect.value = state.selectedResultMatchId;
}

function renderResultForm() {
  const match = getMatchById(state.selectedResultMatchId);
  if (!match) return;

  const result = state.results[match.id];

  els.resultHomeLabel.textContent = match.home;
  els.resultAwayLabel.textContent = match.away;
  els.resultPenaltyHomeLabel.textContent = match.home;
  els.resultPenaltyAwayLabel.textContent = match.away;
  els.resultHomeInput.value = result?.homeScore ?? "";
  els.resultAwayInput.value = result?.awayScore ?? "";
  setRadioValue("resultPenaltyWinner", result?.penaltyWinner || "");
  updateResultPenaltyVisibility();
}

function updatePenaltyVisibility() {
  const match = getSelectedMatch();
  if (!match) {
    els.penaltyBox.hidden = true;
    setRadioValue("penaltyWinner", "");
    return;
  }

  const homeScore = Number(els.homeScoreInput.value);
  const awayScore = Number(els.awayScoreInput.value);
  const hasBothScores = els.homeScoreInput.value !== "" && els.awayScoreInput.value !== "";
  els.penaltyBox.hidden = !(match.knockout && hasBothScores && homeScore === awayScore);

  if (els.penaltyBox.hidden) {
    setRadioValue("penaltyWinner", "");
  }
}

function updateResultPenaltyVisibility() {
  const match = getMatchById(state.selectedResultMatchId);
  if (!match) {
    els.resultPenaltyBox.hidden = true;
    setRadioValue("resultPenaltyWinner", "");
    return;
  }

  const homeScore = Number(els.resultHomeInput.value);
  const awayScore = Number(els.resultAwayInput.value);
  const hasBothScores = els.resultHomeInput.value !== "" && els.resultAwayInput.value !== "";
  els.resultPenaltyBox.hidden = !(match.knockout && hasBothScores && homeScore === awayScore);

  if (els.resultPenaltyBox.hidden) {
    setRadioValue("resultPenaltyWinner", "");
  }
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

function getAdminHeaders() {
  return {
    "x-admin-pin": els.adminPinInput.value,
  };
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
  const matches = getMatchesByDate(state.selectedDate);
  const selectedMatchIsInDate = matches.some((match) => match.id === state.selectedMatchId);
  state.selectedMatchId = selectedMatchIsInDate ? state.selectedMatchId : matches[0]?.id || "";
}

function syncSelectedResultMatch() {
  const exists = state.matches.some((match) => match.id === state.selectedResultMatchId);
  state.selectedResultMatchId = exists ? state.selectedResultMatchId : state.matches[0]?.id || "";
}

function getSelectedMatch() {
  if (!state.selectedMatchId) return null;
  return getMatchById(state.selectedMatchId);
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

function setRadioValue(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === value;
  });
}

function getSelectedRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function setMessage(element, message) {
  element.textContent = message;
}

function clearMessages() {
  [els.authMessage, els.predictionMessage, els.resultMessage].forEach((element) => {
    element.textContent = "";
  });
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

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
