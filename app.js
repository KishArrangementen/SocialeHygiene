(() => {
  const BANK = window.QUESTION_BANK;
  const TOPICS = window.TOPICS;
  const app = document.querySelector("#app");
  const storageKey = "rustigLerenSocialeHygieneV1";
  const SUMMARY_AUDIO = [
    ["01-basis-en-beleid", "Basis & beleid"],
    ["02-omgaan-met-gasten", "Omgaan met gasten"],
    ["03-regels-en-handhaving", "Regels & handhaving"],
    ["04-risicogedrag", "Risicogedrag"],
    ["05-gespreksmodellen", "Gespreksmodellen"],
    ["06-alcohol", "Alcohol"],
    ["07-drugs", "Drugs"],
    ["08-tabak-en-gokken", "Tabak & gokken"],
    ["09-veiligheid-en-brand", "Veiligheid & brand"],
    ["10-examenmix", "Examenmix"]
  ];
  const defaultProgress = { correct: [], wrong: [], attempts: {}, settings: { calm: true, scale: 1 } };
  let progress = loadProgress();
  let session = null;
  let examTimer = null;
  let activeAudio = null;
  let activeAudioPath = "";
  let activeAudioButton = null;
  let offlineState = "Offlinepakket wordt klaargezet…";

  function restoreAudioButton() {
    if (activeAudioButton?.isConnected) {
      activeAudioButton.innerHTML = activeAudioButton.dataset.audioHtml || "🔊 Luister";
      activeAudioButton.setAttribute("aria-pressed", "false");
    }
    activeAudioButton = null;
  }

  function stopPlayback() {
    window.speechSynthesis?.cancel?.();
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    }
    activeAudio = null;
    activeAudioPath = "";
    restoreAudioButton();
  }

  function playAudioFile(path, button, fallbackText = "", after = null) {
    if (activeAudio && activeAudioPath === path) {
      if (activeAudio.paused) {
        activeAudio.play();
        button.textContent = "⏸ Pauze";
      } else {
        activeAudio.pause();
        button.textContent = "▶ Verder";
      }
      return;
    }
    stopPlayback();
    button.dataset.audioHtml ||= button.innerHTML;
    button.textContent = "⏸ Pauze";
    button.setAttribute("aria-pressed", "true");
    activeAudioButton = button;
    activeAudioPath = path;
    activeAudio = new Audio(path);
    activeAudio.preload = "auto";
    activeAudio.addEventListener("ended", () => {
      activeAudio = null;
      activeAudioPath = "";
      restoreAudioButton();
      after?.();
    });
    activeAudio.addEventListener("error", () => {
      activeAudio = null;
      activeAudioPath = "";
      restoreAudioButton();
      if (fallbackText) speak(fallbackText);
    });
    activeAudio.play().catch(() => {
      restoreAudioButton();
      if (fallbackText) speak(fallbackText);
    });
  }

  function questionAudioPath(id, kind) {
    return `audio/${String(id).padStart(3, "0")}-${kind}.mp3`;
  }

  function loadProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      return {
        ...defaultProgress,
        ...saved,
        settings: { ...defaultProgress.settings, ...(saved?.settings || {}) }
      };
    } catch {
      return structuredClone(defaultProgress);
    }
  }

  function saveProgress() {
    localStorage.setItem(storageKey, JSON.stringify(progress));
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function examizeQuestion(question) {
    const choices = question.options.map((text, index) => ({ text, correct: index === question.answer }));
    const selected = shuffle([
      choices.find((choice) => choice.correct),
      ...shuffle(choices.filter((choice) => !choice.correct)).slice(0, 2)
    ]);
    return {
      ...question,
      options: selected.map((choice) => choice.text),
      answer: selected.findIndex((choice) => choice.correct)
    };
  }

  function clearExamTimer() {
    if (examTimer) window.clearInterval(examTimer);
    examTimer = null;
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateTimerDisplay() {
    const timer = document.querySelector("#exam-timer");
    if (!timer || !session) return;
    timer.textContent = formatTime(session.secondsLeft);
    timer.classList.toggle("is-low", session.secondsLeft <= 300);
  }

  function startExamTimer() {
    clearExamTimer();
    updateTimerDisplay();
    examTimer = window.setInterval(() => {
      if (!session || session.mode !== "exam") return clearExamTimer();
      session.secondsLeft -= 1;
      updateTimerDisplay();
      if (session.secondsLeft <= 0) finishTimedExam();
    }, 1000);
  }

  function finishTimedExam() {
    if (!session || session.mode !== "exam") return;
    clearExamTimer();
    session.timedOut = true;
    const answeredIds = new Set(session.results.map((result) => result.id));
    session.questions.forEach((question) => {
      if (!answeredIds.has(question.id)) {
        session.results.push({ id: question.id, choice: null, correct: false });
        recordAttempt(question.id, false);
      }
    });
    showResults();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function topicCount(key) {
    return BANK.filter((q) => q.topic === key).length;
  }

  function getQuestion(id) {
    return BANK.find((q) => q.id === id);
  }

  function smartRound() {
    const wrong = shuffle(BANK.filter((q) => progress.wrong.includes(q.id)));
    const unseen = shuffle(BANK.filter((q) => !progress.correct.includes(q.id) && !progress.wrong.includes(q.id)));
    const known = shuffle(BANK.filter((q) => progress.correct.includes(q.id)));
    return [...wrong, ...unseen, ...known].slice(0, 15);
  }

  function startSession(mode = "learn", topic = null) {
    let questions;
    if (mode === "mistakes") {
      questions = shuffle(progress.wrong.map(getQuestion).filter(Boolean));
      if (!questions.length) return showHome();
    } else if (mode === "exam") {
      questions = shuffle(BANK).slice(0, 40).map(examizeQuestion);
    } else if (topic) {
      questions = shuffle(BANK.filter((q) => q.topic === topic));
    } else {
      questions = smartRound();
    }

    session = {
      mode,
      topic,
      questions,
      index: 0,
      score: 0,
      answered: false,
      results: [],
      secondsLeft: mode === "exam" ? 40 * 60 : null,
      timedOut: false
    };
    renderQuestion();
    if (mode === "exam") startExamTimer();
  }

  function showHome() {
    clearExamTimer();
    session = null;
    stopPlayback();
    const learned = progress.correct.length;
    const percentage = Math.round((learned / BANK.length) * 100);
    const wrongCount = progress.wrong.length;
    const topicCards = Object.entries(TOPICS).map(([key, topic]) => {
      const ids = BANK.filter((q) => q.topic === key).map((q) => q.id);
      const done = ids.filter((id) => progress.correct.includes(id)).length;
      const percent = Math.round((done / ids.length) * 100);
      return `
        <button class="topic-card" data-topic="${key}" style="--topic:${topic.color}">
          <span class="topic-icon" aria-hidden="true">${topic.icon}</span>
          <span class="topic-copy"><strong>${topic.name}</strong><small>${done} van ${ids.length} goed</small></span>
          <span class="mini-progress" aria-label="${percent}% beheerst"><i style="width:${percent}%"></i></span>
          <span class="topic-arrow" aria-hidden="true">→</span>
        </button>`;
    }).join("");

    app.innerHTML = `
      <section class="home-shell">
        <div class="welcome-panel">
          <div class="eyebrow">Jouw persoonlijke oefenplek</div>
          <h1>Rustig leren.<br><span>Stap voor stap.</span></h1>
          <p class="intro">Korte vragen, duidelijke uitleg en geen tijdsdruk. Fouten zijn hier gewoon vragen die nog een ronde nodig hebben.</p>
          <div class="quick-actions">
            <button class="primary-button" id="start-smart"><span>Start oefenronde</span><small>15 slimme vragen</small></button>
            <button class="secondary-button" id="start-exam"><span>Examenmodus</span><small>40 vragen · 40 minuten · A/B/C</small></button>
            <button class="secondary-button" id="start-mistakes" ${wrongCount ? "" : "disabled"}><span>Herhaal lastige vragen</span><small>${wrongCount ? `${wrongCount} om opnieuw te doen` : "Nog geen fouten opgeslagen"}</small></button>
          </div>
        </div>
        <aside class="progress-panel" aria-label="Jouw voortgang">
          <div class="progress-ring" style="--value:${percentage * 3.6}deg">
            <div><strong>${percentage}%</strong><span>beheerst</span></div>
          </div>
          <dl class="stats">
            <div><dt>${learned}</dt><dd>goed beantwoord</dd></div>
            <div><dt>${wrongCount}</dt><dd>nog herhalen</dd></div>
            <div><dt>${BANK.length}</dt><dd>vragen totaal</dd></div>
          </dl>
        </aside>
      </section>
      <section class="exam-facts speakable" aria-label="Zo ziet het examen eruit">
        <div><span class="eyebrow">Echt examen</span><h2>Zo ziet het eruit</h2></div>
        <dl>
          <div><dt>40</dt><dd>vragen</dd></div>
          <div><dt>40</dt><dd>minuten</dd></div>
          <div><dt>29</dt><dd>goed om te slagen</dd></div>
          <div><dt>A · B · C</dt><dd>3 keuzes</dd></div>
        </dl>
      </section>
      <section class="audio-library" aria-label="Offline luistersamenvattingen">
        <div class="audio-library-copy">
          <span class="eyebrow">Luisteren zonder internet</span>
          <h2>10 korte hoofdstukken</h2>
          <p>Deze Nederlandse MP3’s staan al in de download. Opnieuw luisteren gebruikt geen credits of data.</p>
          <span class="offline-status" id="offline-status">✈️ ${offlineState}</span>
        </div>
        <div class="audio-grid">
          ${SUMMARY_AUDIO.map(([file, label], index) => `<button class="audio-button" type="button" data-summary="${file}" aria-pressed="false"><span>${String(index + 1).padStart(2, "0")}</span>${label}</button>`).join("")}
        </div>
      </section>
      <section class="topics-section">
        <div class="section-heading">
          <div><span class="eyebrow">Kies zelf</span><h2>Oefen per onderwerp</h2></div>
          <p>Elk onderwerp gebruikt de theorie uit jouw foto’s.</p>
        </div>
        <div class="topics-grid">${topicCards}</div>
      </section>
      <section class="learning-note speakable">
        <span aria-hidden="true">💡</span>
        <div><strong>Leren werkt beter in kleine stukken.</strong><p>Doe één ronde, neem even pauze en herhaal daarna alleen de lastige vragen.</p></div>
      </section>`;

    document.querySelector("#start-smart").addEventListener("click", () => startSession("learn"));
    document.querySelector("#start-exam").addEventListener("click", () => startSession("exam"));
    document.querySelector("#start-mistakes").addEventListener("click", () => startSession("mistakes"));
    document.querySelectorAll("[data-topic]").forEach((button) => {
      button.addEventListener("click", () => startSession("learn", button.dataset.topic));
    });
    document.querySelectorAll("[data-summary]").forEach((button) => {
      button.addEventListener("click", () => playAudioFile(`audio/samenvattingen/${button.dataset.summary}.mp3`, button));
    });
    document.title = "Rustig Leren — Sociale Hygiëne";
    app.focus();
  }

  function renderQuestion() {
    stopPlayback();
    const q = session.questions[session.index];
    const topic = TOPICS[q.topic];
    const current = session.index + 1;
    const total = session.questions.length;
    const pct = Math.round((session.index / total) * 100);
    const modeLabel = session.mode === "exam" ? `Examen · <strong id="exam-timer" class="exam-timer">${formatTime(session.secondsLeft)}</strong>` : session.mode === "mistakes" ? "Herhaalronde" : "Oefenmodus";
    const options = q.options.map((option, index) => `
      <button class="answer-option" type="button" data-answer="${index}">
        <span class="answer-letter">${String.fromCharCode(65 + index)}</span>
        <span>${escapeHtml(option)}</span>
      </button>`).join("");

    app.innerHTML = `
      <section class="quiz-shell">
        <div class="quiz-topline">
          <button class="text-button" id="quit-quiz" type="button">← Stoppen</button>
          <span class="mode-label">${modeLabel}</span>
          <span class="question-counter">Vraag ${current} van ${total}</span>
        </div>
        <div class="session-progress" aria-label="Voortgang ${pct}%"><i style="width:${pct}%"></i></div>
        <article class="question-card speakable" style="--topic:${topic.color}">
          <div class="question-meta"><span>${topic.icon} ${topic.name}</span><button id="read-question" class="inline-read" type="button" aria-pressed="false">🔊 Luister vraag</button></div>
          <h1>${escapeHtml(q.q)}</h1>
          <div class="answers" role="group" aria-label="Antwoorden">${options}</div>
          ${session.mode === "exam" ? "" : '<button id="dont-know" class="dont-know" type="button">Ik weet het nog niet</button>'}
          <div id="feedback" aria-live="polite"></div>
        </article>
        <p class="keyboard-hint">Tip: gebruik toetsen 1–${session.mode === "exam" ? "3" : "4"} om een antwoord te kiezen.</p>
      </section>`;

    document.querySelector("#quit-quiz").addEventListener("click", showHome);
    document.querySelector("#read-question").addEventListener("click", (event) => {
      const optionsText = q.options.map((option, index) => `Antwoord ${String.fromCharCode(65 + index)}: ${option}`).join(". ");
      playAudioFile(questionAudioPath(q.id, "q"), event.currentTarget, q.q, () => speak(optionsText));
    });
    document.querySelectorAll("[data-answer]").forEach((button) => {
      button.addEventListener("click", () => answerQuestion(Number(button.dataset.answer)));
    });
    document.querySelector("#dont-know")?.addEventListener("click", () => answerQuestion(null));
    document.title = `Vraag ${current} — Rustig Leren`;
    app.focus();
  }

  function answerQuestion(choice) {
    if (session.answered) return;
    const q = session.questions[session.index];
    const correct = choice === q.answer;
    session.answered = true;
    session.results.push({ id: q.id, choice, correct });
    if (correct) session.score += 1;
    recordAttempt(q.id, correct);

    if (session.mode === "exam") {
      goNext();
      return;
    }

    const buttons = [...document.querySelectorAll("[data-answer]")];
    buttons.forEach((button, index) => {
      button.disabled = true;
      if (index === q.answer) button.classList.add("correct");
      if (choice === index && !correct) button.classList.add("incorrect");
    });
    document.querySelector("#dont-know")?.remove();
    const feedback = document.querySelector("#feedback");
    feedback.innerHTML = `
      <section class="feedback ${correct ? "is-correct" : "is-wrong"}">
        <div class="feedback-title"><span aria-hidden="true">${correct ? "✓" : "↻"}</span><strong>${correct ? "Goed gezien!" : choice === null ? "Geeft niets — dit leer je nu." : "Bijna — bekijk waarom."}</strong></div>
        <div class="explanation"><h2>Waarom?</h2><p>${escapeHtml(q.why)}</p></div>
        <div class="memory-tip"><strong>Onthoud:</strong> ${escapeHtml(q.tip)}</div>
        <div class="feedback-actions">
          <button id="read-explanation" class="secondary-button small" type="button" aria-pressed="false">🔊 Antwoord + uitleg</button>
          <button id="next-question" class="primary-button small" type="button">${session.index === session.questions.length - 1 ? "Bekijk resultaat" : "Volgende vraag →"}</button>
        </div>
      </section>`;
    document.querySelector("#read-explanation").addEventListener("click", (event) => {
      const answerText = `Het juiste antwoord is: ${q.options[q.answer]}.`;
      playAudioFile(questionAudioPath(q.id, "a"), event.currentTarget, answerText, () => speak(`Waarom? ${q.why}. Onthoud: ${q.tip}`));
    });
    document.querySelector("#next-question").addEventListener("click", goNext);
    document.querySelector("#next-question").focus();
  }

  function recordAttempt(id, correct) {
    progress.attempts[id] = (progress.attempts[id] || 0) + 1;
    if (correct) {
      if (!progress.correct.includes(id)) progress.correct.push(id);
      progress.wrong = progress.wrong.filter((item) => item !== id);
    } else {
      if (!progress.wrong.includes(id)) progress.wrong.push(id);
      progress.correct = progress.correct.filter((item) => item !== id);
    }
    saveProgress();
  }

  function goNext() {
    stopPlayback();
    if (session.index < session.questions.length - 1) {
      session.index += 1;
      session.answered = false;
      renderQuestion();
    } else {
      showResults();
    }
  }

  function showResults() {
    clearExamTimer();
    stopPlayback();
    const total = session.questions.length;
    const percentage = Math.round((session.score / total) * 100);
    const missed = session.results.filter((result) => !result.correct);
    const passedExam = session.mode === "exam" && session.score >= 29;
    const message = session.mode === "exam"
      ? passedExam ? "Geslaagd op deze oefentoets!" : "Nog niet op examenniveau."
      : percentage >= 80 ? "Sterke ronde!" : percentage >= 60 ? "Goed op weg." : "Dit was een nuttige leerronde.";
    const review = missed.map((result) => {
      const q = getQuestion(result.id);
      return `<details><summary>${TOPICS[q.topic].icon} ${escapeHtml(q.q)}</summary><div><p><strong>Goed antwoord:</strong> ${escapeHtml(q.options[q.answer])}</p><p>${escapeHtml(q.why)}</p><p class="memory-tip"><strong>Onthoud:</strong> ${escapeHtml(q.tip)}</p></div></details>`;
    }).join("");

    app.innerHTML = `
      <section class="result-shell speakable">
        <div class="result-score" style="--value:${percentage * 3.6}deg"><div><strong>${session.score}/${total}</strong><span>${percentage}% goed</span></div></div>
        <div class="result-copy">
          <span class="eyebrow">Ronde afgerond</span>
          <h1>${message}</h1>
          <p>${session.mode === "exam"
            ? `${session.timedOut ? "De 40 minuten waren voorbij. " : ""}Voor slagen heb je minimaal 29 van de 40 vragen goed nodig. Je had er ${session.score} goed.`
            : missed.length ? `${missed.length} ${missed.length === 1 ? "vraag krijgt" : "vragen krijgen"} later nog een kans. Dat is precies hoe leren werkt.` : "Je had alles goed. Heel netjes!"}</p>
          <div class="result-actions">
            <button id="again" class="primary-button small" type="button">Nog een ronde</button>
            <button id="home" class="secondary-button small" type="button">Naar overzicht</button>
          </div>
        </div>
      </section>
      ${missed.length ? `<section class="review-section"><h2>Bekijk de lastige vragen</h2><p>Open een vraag om het juiste antwoord en de uitleg terug te lezen.</p><div class="review-list">${review}</div></section>` : ""}`;
    document.querySelector("#again").addEventListener("click", () => startSession(session.mode === "exam" ? "exam" : "learn", session.topic));
    document.querySelector("#home").addEventListener("click", showHome);
    document.title = "Resultaat — Rustig Leren";
    app.focus();
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) {
      alert("Voorlezen wordt niet ondersteund door deze browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "nl-NL";
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  function updateOfflineStatus(message) {
    offlineState = message;
    const status = document.querySelector("#offline-status");
    if (status) status.textContent = `✈️ ${message}`;
  }

  function registerOfflinePack() {
    if (location.protocol === "file:") {
      updateOfflineStatus("Offline download actief");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      updateOfflineStatus("Gebruik de ZIP-download voor volledig offline leren");
      return;
    }
    navigator.serviceWorker.register("./sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => updateOfflineStatus("Klaar voor vliegtuigstand"))
      .catch(() => updateOfflineStatus("Gebruik de ZIP-download voor volledig offline leren"));
  }

  function applySettings() {
    document.documentElement.classList.toggle("calm-reading", progress.settings.calm);
    document.documentElement.style.setProperty("--font-scale", progress.settings.scale);
    const toggle = document.querySelector("#toggle-reading");
    toggle?.setAttribute("aria-pressed", String(progress.settings.calm));
    toggle?.classList.toggle("active", progress.settings.calm);
  }

  document.querySelector(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    showHome();
  });
  document.querySelector("#read-page").addEventListener("click", () => {
    const text = [...document.querySelectorAll(".speakable")].map((el) => el.innerText).join(". ");
    speak(text || app.innerText);
  });
  document.querySelector("#toggle-reading").addEventListener("click", () => {
    progress.settings.calm = !progress.settings.calm;
    saveProgress();
    applySettings();
  });
  document.querySelector("#font-down").addEventListener("click", () => {
    progress.settings.scale = Math.max(0.9, Number((progress.settings.scale - 0.1).toFixed(1)));
    saveProgress();
    applySettings();
  });
  document.querySelector("#font-up").addEventListener("click", () => {
    progress.settings.scale = Math.min(1.4, Number((progress.settings.scale + 0.1).toFixed(1)));
    saveProgress();
    applySettings();
  });

  document.addEventListener("keydown", (event) => {
    if (!session) return;
    if (["1", "2", "3", "4"].includes(event.key) && !session.answered) {
      document.querySelector(`[data-answer="${Number(event.key) - 1}"]`)?.click();
    } else if (event.key === "Enter" && session.answered) {
      document.querySelector("#next-question")?.click();
    }
  });

  function registerWebMcp() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const safeTopic = (topic) => topic == null || Object.hasOwn(TOPICS, topic);
    Promise.resolve(context.registerTool({
      name: "start_practice",
      title: "Start oefenronde",
      description: "Start een zichtbare oefenronde, eventueel voor één onderwerp.",
      inputSchema: { type: "object", properties: { topic: { type: ["string", "null"], enum: [...Object.keys(TOPICS), null] } }, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!safeTopic(input?.topic)) throw new Error("Onbekend onderwerp");
        startSession("learn", input?.topic || null);
        return { status: "started", topic: input?.topic || "mixed", questionCount: session.questions.length };
      }
    })).catch(() => {});
    Promise.resolve(context.registerTool({
      name: "start_mistake_review",
      title: "Herhaal lastige vragen",
      description: "Start een zichtbare ronde met eerder fout beantwoorde vragen.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        if (!progress.wrong.length) return { status: "empty", questionCount: 0 };
        startSession("mistakes");
        return { status: "started", questionCount: session.questions.length };
      }
    })).catch(() => {});
  }

  applySettings();
  showHome();
  registerWebMcp();
  registerOfflinePack();
})();
