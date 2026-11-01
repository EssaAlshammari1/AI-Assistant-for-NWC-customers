const configuredApiUrl = new URLSearchParams(window.location.search).get("api");
const localApiUrl = "http://127.0.0.1:8000";
const isLocalWebsite = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  && window.location.port === "5500";
const API_URL = (configuredApiUrl || (isLocalWebsite ? localApiUrl : window.location.origin)).replace(/\/$/, "");

const form = document.querySelector("#questionForm");
const input = document.querySelector("#questionInput");
const askButton = document.querySelector("#askButton");
const messages = document.querySelector("#messages");
const quickSuggestions = document.querySelector("#quickSuggestions");
const errorPanel = document.querySelector("#errorPanel");
const apiStatus = document.querySelector("#apiStatus");
const connectionText = document.querySelector("#connectionText");
const themeToggle = document.querySelector("#themeToggle");
const clearChatButton = document.querySelector("#clearChat");
const voiceButton = document.querySelector("#voiceButton");
const voiceButtonLabel = document.querySelector("#voiceButtonLabel");
const voiceLanguage = document.querySelector("#voiceLanguage");
const voiceStatus = document.querySelector("#voiceStatus");
const companyLogoPath = "../assets/nwc logo.png";
const API_HEADERS = { "ngrok-skip-browser-warning": "true" };

let isSending = false;
let isTranscribing = false;
let mediaRecorder = null;
let microphoneStream = null;
let recordedChunks = [];
const MAX_ANIMATED_CHARACTERS = 700;

/* ---------- Connection status ---------- */
function setConnection(online) {
  apiStatus.classList.toggle("online", online);
  apiStatus.classList.toggle("offline", !online);
  connectionText.textContent = online ? "المساعد متصل" : "الخدمة غير متاحة";
}

async function checkHealth() {
  try {
    const response = await fetch(`${API_URL}/health`, { headers: API_HEADERS });
    setConnection(response.ok);
  } catch {
    setConnection(false);
  }
}

/* ---------- Helpers ---------- */
function showError(message) {
  errorPanel.textContent = message;
  errorPanel.hidden = false;
}

function clearError() {
  errorPanel.hidden = true;
  errorPanel.textContent = "";
}

function nowTime() {
  return new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function createBotAvatar() {
  const avatar = document.createElement("div");
  avatar.className = "message-avatar bot-avatar";
  avatar.setAttribute("aria-hidden", "true");

  const logo = document.createElement("img");
  logo.src = companyLogoPath;
  logo.alt = "";
  logo.addEventListener("error", () => {
    logo.remove();
    avatar.textContent = "NWC";
  });
  avatar.appendChild(logo);
  return avatar;
}

function createSourceToggle(count) {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "source-toggle";
  toggle.textContent = `عرض المصادر (${count})`;

  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("width", "14");
  chevron.setAttribute("height", "14");
  chevron.setAttribute("fill", "none");
  chevron.setAttribute("stroke", "currentColor");
  chevron.setAttribute("stroke-width", "2");
  chevron.setAttribute("stroke-linecap", "round");
  chevron.setAttribute("stroke-linejoin", "round");
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "6 9 12 15 18 9");
  chevron.appendChild(polyline);

  toggle.appendChild(chevron);

  const box = document.createElement("div");
  box.className = "sources-box";

  toggle.addEventListener("click", () => {
    const open = box.classList.toggle("open");
    toggle.classList.toggle("open", open);
    const label = toggle.childNodes[0];
    label.textContent = open ? "إخفاء المصادر" : `عرض المصادر (${count})`;
  });

  return { toggle, box };
}

function addBotSources(container, sources) {
  if (!sources || sources.length === 0) return;

  const { toggle, box } = createSourceToggle(sources.length);
  container.appendChild(toggle);

  sources.forEach((source, index) => {
    const item = document.createElement("div");
    item.className = "source-item";

    const head = document.createElement("div");
    head.className = "source-head";
    const score = Number(source.score || 0).toFixed(3);
    head.textContent = `مصدر ${index + 1} · الصلة ${score}`;

    const text = document.createElement("div");
    text.textContent = source.text || "";

    item.appendChild(head);
    item.appendChild(text);
    box.appendChild(item);
  });

  container.appendChild(box);
}

function appendInlineText(container, text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      container.appendChild(strong);
    } else if (part) {
      container.appendChild(document.createTextNode(part));
    }
  });
}

function renderAnswer(container, text) {
  container.replaceChildren();
  const lines = String(text).replace(/\r/g, "").split("\n");
  let list = null;
  let listType = null;

  const closeList = () => {
    list = null;
    listType = null;
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      return;
    }

    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);

    if (heading) {
      closeList();
      const title = document.createElement("h4");
      appendInlineText(title, heading[1]);
      container.appendChild(title);
      return;
    }

    if (bullet || numbered) {
      const nextType = bullet ? "ul" : "ol";
      if (!list || listType !== nextType) {
        closeList();
        listType = nextType;
        list = document.createElement(nextType);
        container.appendChild(list);
      }
      const item = document.createElement("li");
      appendInlineText(item, (bullet || numbered)[1]);
      list.appendChild(item);
      return;
    }

    closeList();
    const paragraph = document.createElement("p");
    appendInlineText(paragraph, trimmed);
    container.appendChild(paragraph);
  });
}

function typingDelay(character) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  if (/[.!؟،:]/.test(character)) return 55;
  if (/\s/.test(character)) return 10;
  return 18;
}

async function typeAnswer(container, text) {
  const answer = String(text);
  const animatedLength = Math.min(answer.length, MAX_ANIMATED_CHARACTERS);
  for (let index = 1; index <= animatedLength; index += 1) {
    renderAnswer(container, answer.slice(0, index));
    scrollToBottom();
    await new Promise((resolve) => setTimeout(resolve, typingDelay(answer[index - 1])));
  }
  if (animatedLength < answer.length) {
    renderAnswer(container, answer);
  }
}

async function addMessage(role, text, sources, { animate = false } = {}) {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  const avatar = role === "bot" ? createBotAvatar() : document.createElement("div");
  if (role !== "bot") {
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "أنت";
  }

  const content = document.createElement("div");
  content.className = "message-content";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (role !== "bot") {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    bubble.appendChild(paragraph);
  }

  content.appendChild(bubble);

  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = nowTime();
  content.appendChild(time);

  row.appendChild(avatar);
  row.appendChild(content);
  messages.appendChild(row);

  if (role === "bot") {
    if (animate) {
      await typeAnswer(bubble, text);
    } else {
      renderAnswer(bubble, text);
    }
  }

  if (role === "bot" && sources) {
    addBotSources(content, sources);
    content.appendChild(time);
  }
  scrollToBottom();
}

function addTypingIndicator() {
  const row = document.createElement("div");
  row.className = "typing-row";
  row.id = "typingIndicator";

  const avatar = createBotAvatar();

  const dots = document.createElement("div");
  dots.className = "typing-dots";
  dots.setAttribute("role", "status");
  dots.setAttribute("aria-label", "المساعد يكتب الآن");

  for (let i = 0; i < 3; i += 1) {
    dots.appendChild(document.createElement("i"));
  }

  row.appendChild(avatar);
  row.appendChild(dots);
  messages.appendChild(row);
  scrollToBottom();
}

function removeTypingIndicator() {
  const indicator = document.querySelector("#typingIndicator");
  if (indicator) indicator.remove();
}

/* ---------- Auto-grow textarea ---------- */
function autoGrow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
}

/* ---------- Ask the API ---------- */
async function askQuestion(question) {
  clearError();
  addMessage("user", question);
  isSending = true;
  askButton.disabled = true;
  askButton.classList.add("busy");
  input.value = "";
  input.style.height = "auto";
  if (quickSuggestions) quickSuggestions.hidden = true;
  addTypingIndicator();
  const requestController = new AbortController();
  const requestTimeout = setTimeout(() => requestController.abort(), 120000);

  try {
    const response = await fetch(`${API_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...API_HEADERS },
      body: JSON.stringify({ question }),
      signal: requestController.signal,
    });

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("استجابة غير صالحة من الخادم");
    }

    if (!response.ok) {
      throw new Error(result.error || "تعذر الحصول على الإجابة");
    }

    await addMessage(
      "bot",
      result.answer || "لم يتم العثور على إجابة.",
      result.sources,
      { animate: Boolean(result.sources && result.sources.length) }
    );
    setConnection(true);
  } catch (error) {
    setConnection(false);
    const message = error.name === "AbortError"
      ? "انتهت مهلة الانتظار. تأكد من تشغيل API ثم حاول مرة أخرى."
      : `تعذر الاتصال بالمساعد. تأكد من تشغيل API على المنفذ 8000. التفاصيل: ${error.message}`;
    showError(message);
  } finally {
    clearTimeout(requestTimeout);
    removeTypingIndicator();
    isSending = false;
    askButton.disabled = false;
    askButton.classList.remove("busy");
  }
}

function setVoiceStatus(message) {
  voiceStatus.textContent = message;
  voiceStatus.hidden = !message;
}

function resetVoiceButton() {
  voiceButton.classList.remove("recording", "busy");
  voiceButton.disabled = false;
  voiceButton.setAttribute("aria-label", "اسأل بصوتك");
  voiceButton.title = "اسأل بصوتك";
  voiceButtonLabel.textContent = "اسأل بصوتك";
  if (microphoneStream) {
    microphoneStream.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
  }
  mediaRecorder = null;
}

async function transcribeRecording(blob, mimeType) {
  if (!blob.size) {
    showError("لم يُسجّل صوت. حاول مرة أخرى.");
    setVoiceStatus("");
    return;
  }
  if (blob.size > 25 * 1024 * 1024) {
    showError("التسجيل طويل جدًا. حاول تسجيل سؤال أقصر.");
    setVoiceStatus("");
    return;
  }

  const contentType = (mimeType || blob.type || "audio/webm").split(";")[0];
  isTranscribing = true;
  voiceButton.disabled = true;
  voiceButton.classList.add("busy");
  setVoiceStatus("جارٍ تحويل الصوت إلى نص...");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const language = encodeURIComponent(voiceLanguage.value);
    const response = await fetch(`${API_URL}/transcribe?language=${language}`, {
      method: "POST",
      headers: { "Content-Type": contentType, ...API_HEADERS },
      body: blob,
      signal: controller.signal,
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("استجابة غير صالحة من الخادم");
    }
    if (!response.ok) throw new Error(result.error || "تعذر تحويل الصوت إلى نص");
    if (!result.text?.trim()) throw new Error("لم يتم التعرّف على كلام في التسجيل.");

    input.value = result.text.trim();
    autoGrow();
    input.focus();
    setVoiceStatus("تم تحويل الصوت. راجع السؤال ثم اضغط إرسال.");
  } catch (error) {
    const message = error.name === "AbortError"
      ? "انتهت مهلة تحويل الصوت. حاول تسجيل سؤال أقصر."
      : error.message;
    showError(message);
    setVoiceStatus("");
  } finally {
    clearTimeout(timeout);
    isTranscribing = false;
    voiceButton.disabled = false;
    voiceButton.classList.remove("busy");
  }
}

async function toggleVoiceRecording() {
  if (isTranscribing) return;
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    showError("التسجيل الصوتي غير مدعوم في هذا المتصفح. افتح الموقع عبر localhost أو HTTPS.");
    return;
  }

  clearError();
  setVoiceStatus("");
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const mimeCandidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
    const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type));
    mediaRecorder = new MediaRecorder(microphoneStream, mimeType ? { mimeType } : undefined);
    recordedChunks = [];

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordedChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      const recording = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || mimeType });
      const recordingType = recording.type;
      recordedChunks = [];
      resetVoiceButton();
      transcribeRecording(recording, recordingType);
    }, { once: true });
    mediaRecorder.start();
    voiceButton.classList.add("recording");
    voiceButton.setAttribute("aria-label", "إيقاف التسجيل وإرسال السؤال للتحويل إلى نص");
    voiceButton.title = "إيقاف التسجيل";
    voiceButtonLabel.textContent = "إيقاف التسجيل";
    setVoiceStatus("جارٍ التسجيل... اضغط إيقاف عند الانتهاء من سؤالك.");
  } catch (error) {
    resetVoiceButton();
    showError(error.name === "NotAllowedError"
      ? "اسمح للمتصفح باستخدام الميكروفون ثم حاول مرة أخرى."
      : `تعذر بدء التسجيل. ${error.message}`);
  }
}

/* ---------- Events ---------- */
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (isSending) return;
  const question = input.value.trim();
  if (!question) {
    input.focus();
    showError("اكتب سؤالك أولاً.");
    return;
  }
  askQuestion(question);
});

voiceButton.addEventListener("click", toggleVoiceRecording);

input.addEventListener("input", autoGrow);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !isSending) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll("[data-question]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.question;
    input.focus();
    autoGrow();
  });
});

async function endConversation() {
  try {
    await fetch(`${API_URL}/clear`, { method: "POST", headers: API_HEADERS });
  } catch {
    // Ignore network errors while ending the chat.
  }
}

function endConversationOnLeave() {
  // keepalive lets the clear request finish while the page is closing.
  fetch(`${API_URL}/clear`, {
    method: "POST",
    headers: API_HEADERS,
    keepalive: true,
  }).catch(() => {});
}

if (clearChatButton) {
  clearChatButton.addEventListener("click", async () => {
    messages.replaceChildren();
    if (quickSuggestions) quickSuggestions.hidden = false;
    await endConversation();
    addMessage("bot", "تم مسح المحادثة. كيف يمكنني مساعدتك اليوم؟");
  });
}

// Clear saved history when the user leaves / ends the chat session.
window.addEventListener("pagehide", endConversationOnLeave);

/* ---------- Theme ---------- */
function applyTheme(dark) {
  document.body.classList.toggle("dark", dark);
}

themeToggle.addEventListener("click", () => {
  const dark = document.body.classList.toggle("dark");
  localStorage.setItem("nwc-theme", dark ? "dark" : "light");
});

if (localStorage.getItem("nwc-theme") === "dark") {
  applyTheme(true);
}

// Stamp the initial greeting with the current time.
const greetingTime = document.querySelector(".message-row.bot .message-time");
if (greetingTime && !greetingTime.textContent) {
  greetingTime.textContent = nowTime();
}

checkHealth();
