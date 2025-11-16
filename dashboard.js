// =========================
// OpenRouter / AI setup
// =========================
const OPENROUTER_KEY = "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";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "meta-llama/llama-3.2-3b-instruct";

async function askAIModel(prompt) {
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_KEY}`
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await res.json();
    console.log("OpenRouter response:", data);
    if (data.error) return `Error: ${data.error.message || data.error}`;
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text;
    return content || "No reply 😕";
  } catch (err) {
    console.error("askAIModel error:", err);
    return "Error: " + (err.message || err);
  }
}

// =========================
// Auth & UI init
// =========================
(function init() {
  const user = sessionStorage.getItem('ai_study_user') || 'Student';
  if (!user) {
    if (location.pathname.endsWith("dashboard.html")) {
      window.location.href = "index.html";
    }
    return;
  }
  const h = document.getElementById('welcomeHeading');
  if (h) h.textContent = 'Welcome!!';
})();

function logout() {
  sessionStorage.removeItem('ai_study_user');
  window.location.href = "index.html";
}

// =========================
// Basic UI helpers
// =========================
function showSection(id) {
  document.querySelectorAll('.feature').forEach(f => f.style.display = 'none');
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}
showSection('saveNotes'); // default

// =========================
// File storage (session)
// =========================
const savedFiles = {}; // name -> File

function saveNotes() {
  const files = document.getElementById("noteFile").files;
  if (!files || files.length === 0) return alert("Select at least one file to save.");
  for (let f of files) {
    savedFiles[f.name] = f;
  }
  renderSavedList();
  updateSelectors();
}

function renderSavedList() {
  const list = document.getElementById("savedList");
  list.innerHTML = "";
  for (let name in savedFiles) {
    const li = document.createElement("li");
    li.style.marginBottom = "8px";
    li.innerHTML = `<span style="font-weight:600">${name}</span>
      <div style="margin-top:6px;">
        <button onclick="viewNote('${escapeJs(name)}')">View</button>
        <button onclick="deleteNote('${escapeJs(name)}')">Delete</button>
      </div>`;
    list.appendChild(li);
  }
}

async function viewNote(name) {
  const file = savedFiles[name];
  if (!file) return alert("File not found");
  let text = await file.text();
  if (text.trim().startsWith("{\\rtf")) text = rtfToPlain(text);
  const viewer = document.getElementById("noteViewer");
  viewer.textContent = text;
  showSection('saveNotes');
}

function deleteNote(name) {
  delete savedFiles[name];
  renderSavedList();
  updateSelectors();
}

function escapeJs(s) { return s.replace(/'/g, "\\'").replace(/"/g, '\\"'); }

function updateSelectors() {
  ["sumSource", "tutorSource", "quizSource", "flashSource"].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">Select saved note (optional)</option>';
    for (let name in savedFiles) {
      const opt = document.createElement("option");
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    }
  });
}

async function readFileText(file) {
  let t = await file.text();
  if (t.trim().startsWith("{\\rtf")) t = rtfToPlain(t);
  return t;
}

// Best-effort RTF -> plain
function rtfToPlain(rtf) {
  try {
    let s = rtf.replace(/\\'[0-9a-fA-F]{2}/g, match => {
      const hex = match.substr(2);
      try { return String.fromCharCode(parseInt(hex, 16)); } catch { return ''; }
    });
    s = s.replace(/\\[a-zA-Z]+\d* ?/g, '');
    s = s.replace(/{\\\*\\[^}]+}/g, '');
    s = s.replace(/[{}]/g, '');
    s = s.replace(/\\u(-?\d+)\?/g, (_, n) => String.fromCharCode(Number(n)));
    s = s.replace(/\\par[d]?/g, '\n');
    s = s.replace(/\r\n|\r/g, '\n');
    s = s.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return s;
  } catch (e) {
    return rtf.replace(/[{}]/g, '');
  }
}

// =========================
// Summariser
// =========================
async function summarize() {
  const sel = document.getElementById("sumSource").value;
  const file = sel ? savedFiles[sel] : document.getElementById("sumFile").files[0];
  if (!file) return alert("Select or upload a file to summarise.");
  const text = await readFileText(file);
  document.getElementById("summaryOutput").textContent = "Summarising...";
  const prompt = `Summarise the text into neat sections:
- Short heading
- 2-6 bullet points per heading
Keep bullets short and simple.

Text:
${text}`;
  const reply = await askAIModel(prompt);
  // render with simple line -> bullets split
  document.getElementById("summaryOutput").innerHTML = reply.replace(/\n/g, '<br>');
}

// =========================
// AI Tutor
// =========================
async function askAITutor() {
  const sel = document.getElementById("tutorSource").value;
  const file = sel ? savedFiles[sel] : document.getElementById("tutorFile").files[0];
  const q = document.getElementById("question").value.trim();
  if (!file && !q) return alert("Upload a file or type a question.");
  const text = file ? await readFileText(file) : '';
  const prompt = q ? `Answer concisely in bullet points:\n${q}` : `Teach the following in short bullet points:\n${text}`;
  document.getElementById("answer").textContent = "Thinking...";
  const reply = await askAIModel(prompt);
  const bullets = reply.split('\n').filter(Boolean);
  document.getElementById("answer").innerHTML = '<ul>' + bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('') + '</ul>';
}

// =========================
// PERFECT QUIZ SYSTEM (AI puts correct answer as first option; code shuffles & tracks index)
// =========================

let currentQuiz = null;

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function generateQuiz() {
  const sel = document.getElementById("quizSource").value;
  const file = sel ? savedFiles[sel] :
    document.getElementById("quizFile")?.files?.[0];
  if (!file) return alert("Select or upload a file.");
  const text = await readFileText(file);
  const count = Number(document.getElementById("quizCount").value) || 5;
  const container = document.getElementById("quizContainer");
  container.innerHTML = "Creating quiz…";

  // Instruct model: correct answer must be first option
  const prompt = `Create ${count} multiple choice questions (MCQs) from the text.
IMPORTANT:
- For each question return options array with the CORRECT answer AS THE FIRST ENTRY.
- Return ONLY JSON array of objects: {"question":"...","options":["correct","wrong","wrong","wrong"]}
- Exactly 4 options each.
Text:
${text}`;

  const raw = await askAIModel(prompt);
  console.log("Quiz raw reply:", raw);

  let parsed = null;
  try { parsed = JSON.parse(raw); }
  catch {
    const s = raw.indexOf('['), e = raw.lastIndexOf(']');
    if (s !== -1 && e !== -1) {
      try { parsed = JSON.parse(raw.slice(s, e + 1)); } catch(e) { parsed = null; }
    }
  }

  if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
    container.innerHTML = '<div style="color:#b00">Quiz creation failed — AI returned unexpected format. See console.</div>';
    return;
  }

  // sanitize and build currentQuiz (shuffle options, track correct index)
  const sanitized = [];
  for (let i = 0; i < Math.min(parsed.length, count); i++) {
    const it = parsed[i];
    if (!it.question || !Array.isArray(it.options) || it.options.length < 4) {
      continue;
    }
    let opts = it.options.slice(0,4).map(String);
    const correctText = opts[0];
    opts = shuffleArray(opts);
    const answerIndex = opts.indexOf(correctText);
    sanitized.push({ question: String(it.question), options: opts, answer: answerIndex });
  }

  if (sanitized.length === 0) {
    container.innerHTML = '<div style="color:#b00">No valid questions were produced.</div>';
    return;
  }

  currentQuiz = sanitized;
  renderQuiz(currentQuiz);
}

function renderQuiz(questions) {
  const container = document.getElementById("quizContainer");
  container.innerHTML = '';
  const form = document.createElement('form');
  form.id = 'quizForm';

  questions.forEach((q, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'quiz-question';
    wrapper.innerHTML = `<strong>Q${idx + 1}.</strong> ${escapeHtml(q.question)}`;

    const opts = document.createElement('div');
    opts.className = 'quiz-options';

    // Emergency fallback: ensure 4 visible options
    let safeOptions = q.options;
    if (!safeOptions || safeOptions.length !== 4 || safeOptions.some(o => !String(o).trim())) {
      safeOptions = ['Option A','Option B','Option C','Option D'];
    }

    safeOptions.forEach((opt, oi) => {
      const id = `q${idx}_opt${oi}`;
      const label = document.createElement('label');
      label.innerHTML = `<input type="radio" name="q${idx}" value="${oi}" id="${id}" /> ${escapeHtml(opt)}`;
      opts.appendChild(label);
    });

    wrapper.appendChild(opts);
    form.appendChild(wrapper);
  });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Submit Quiz';
  btn.onclick = gradeQuiz;
  form.appendChild(btn);

  container.appendChild(form);
}

function gradeQuiz() {
  if (!currentQuiz) return;
  // remove previous result
  const container = document.getElementById('quizContainer');
  const prev = container.querySelector('.quiz-result');
  if (prev) prev.remove();

  let correct = 0;
  currentQuiz.forEach((q, i) => {
    const radios = Array.from(document.getElementsByName(`q${i}`));
    const selectedIndex = radios.findIndex(r => r.checked);

    if (radios[q.answer] && radios[q.answer].parentElement) {
      radios[q.answer].parentElement.style.background = '#e7ffe7';
    }

    if (selectedIndex !== -1) {
      if (selectedIndex === q.answer) {
        correct++;
        if (radios[selectedIndex] && radios[selectedIndex].parentElement) radios[selectedIndex].parentElement.style.background = '#d4ffd9';
      } else {
        if (radios[selectedIndex] && radios[selectedIndex].parentElement) radios[selectedIndex].parentElement.style.background = '#ffd6d6';
      }
    }

    radios.forEach(r => r.disabled = true);
  });

  const total = currentQuiz.length;
  const score = Math.round((correct / total) * 100);

  const result = document.createElement('div');
  result.className = 'quiz-result';
  result.textContent = `Score: ${correct}/${total} (${score}%)`;
  container.appendChild(result);
}

// =========================
// Flashcards
// =========================
async function generateFlashcards() {
  const sel = document.getElementById("flashSource").value;
  const file = sel ? savedFiles[sel] : document.getElementById("flashFile").files[0];
  if (!file) return alert("Select or upload a file.");
  const text = await readFileText(file);
  const grid = document.getElementById("flashGrid");
  grid.innerHTML = "Generating...";
  const prompt = `Generate 10 short flashcards (Q & A) from the text. Return JSON array: [{"q":"...","a":"..."}] Text:\n${text}`;
  const reply = await askAIModel(prompt);
  let parsed = null;
  try { parsed = JSON.parse(reply); } catch (e) {
    const s = reply.indexOf('['), eidx = reply.lastIndexOf(']');
    if (s !== -1 && eidx !== -1) {
      try { parsed = JSON.parse(reply.substring(s, eidx + 1)); } catch (err) { parsed = null; }
    }
  }
  if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
    grid.innerHTML = `<div style="color:#b00">Could not parse flashcards.</div>`;
    return;
  }
  grid.innerHTML = '';
  parsed.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'flash-card';
    card.innerHTML = `
      <div class="flash-inner">
        <div class="flash-front"><strong>Q${i+1}.</strong><br>${escapeHtml(p.q)}</div>
        <div class="flash-back"><strong>Answer:</strong><br>${escapeHtml(p.a)}</div>
      </div>
    `;
    card.onclick = () => card.classList.toggle('flipped');
    grid.appendChild(card);
  });
}

// =========================
// Timer + Stopwatch
// =========================
let timerInterval = null;
function startCustomTimer() {
  const minutes = Number(document.getElementById("customTime").value);
  if (!minutes || minutes <= 0) return alert("Enter minutes > 0");
  let seconds = Math.floor(minutes * 60);
  clearInterval(timerInterval);
  updateTimerDisplay(seconds);
  timerInterval = setInterval(() => {
    seconds--;
    updateTimerDisplay(seconds);
    if (seconds <= 0) {
      clearInterval(timerInterval);
      alert("Time's up!");
    }
  }, 1000);
}
function stopTimer() { clearInterval(timerInterval); }
function resetTimer() { clearInterval(timerInterval); updateTimerDisplay(0); document.getElementById("customTime").value = ""; }
function updateTimerDisplay(sec) { if (sec < 0) sec = 0; const m = Math.floor(sec/60), s = sec%60; document.getElementById("timerDisplay").textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

// Stopwatch
let swInterval = null, swTotal = 0;
function startStopwatch() { if (swInterval) return; swInterval = setInterval(() => { swTotal++; document.getElementById("stopwatchDisplay").textContent = formatHMS(swTotal); }, 1000); }
function stopStopwatch() { clearInterval(swInterval); swInterval = null; }
function resetStopwatch() { stopStopwatch(); swTotal = 0; document.getElementById("stopwatchDisplay").textContent = "00:00:00"; }
function formatHMS(total) { const h = Math.floor(total/3600), m = Math.floor((total%3600)/60), s = total%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

// =========================
// Progress
// =========================
function saveProgress() {
  const sub = document.getElementById("subjectName").value.trim();
  const ex = document.getElementById("examName").value.trim();
  const marks = document.getElementById("marks").value;
  if (!sub || !ex || marks === "") return alert("Fill all fields");
  const li = document.createElement('li');
  li.textContent = `${sub} - ${ex}: ${marks} marks`;
  document.getElementById("progressList").appendChild(li);
}

// =========================
// Helpers
// =========================
function escapeHtml(s) {
  return s ? String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) : "";
}