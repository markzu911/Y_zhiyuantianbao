const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const newChatButton = document.querySelector("#new-chat-button");

const STORAGE_KEY = "gaokao-chat-messages-v1";
const MAX_LOCAL_MESSAGES = 60;

const welcomeMessage = {
  role: "assistant",
  content:
    "你要问志愿，别上来就问“某某专业好不好”。先把省份、分数或位次、选科、家庭条件、想去的城市、能不能接受读研说清楚。你信息给得越实，判断越不忽悠。",
};

let messages = loadMessages();

function stripDisclaimer(text) {
  const lines = text.split(/\r?\n/);
  while (
    lines.length &&
    /^(\u5148\u58f0\u660e|\u514d\u8d23\u58f0\u660e|\u6211\u5148\u8bf4\u6e05\u695a|\u514d\u8d23|\u8bf4\u660e\u4e00\u4e0b|\u58f0\u660e\u4e00\u4e0b)/.test(
      lines[0].trim(),
    )
  ) {
    lines.shift();
  }
  const cleaned = lines.join("\n").replace(/^\s*\n+/, "").trim();
  return cleaned || welcomeMessage.content;
}

function loadMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const validMessages = saved
      .filter((message) => {
        return (
          message &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string" &&
          message.content.trim()
        );
      })
      .map((message) => ({
        role: message.role,
        content: stripDisclaimer(message.content),
      }));
    if (!validMessages.length) return [{ ...welcomeMessage }];
    if (validMessages[0]?.role === "assistant") {
      validMessages[0].content = welcomeMessage.content;
    }
    return validMessages;
  } catch {
    return [{ ...welcomeMessage }];
  }
}

function saveMessages() {
  const trimmed = messages
    .map((message) => ({
      role: message.role,
      content: stripDisclaimer(message.content),
    }))
    .filter((message) => message.content)
    .slice(-MAX_LOCAL_MESSAGES);
  messages = trimmed.length ? trimmed : [{ ...welcomeMessage }];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatInline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderMarkdown(text) {
  const lines = stripDisclaimer(text).split(/\r?\n/);
  const html = [];
  let listType = null;

  function closeList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<p><strong>${formatInline(heading[1])}</strong></p>`);
      continue;
    }

    const ordered = line.match(/^\d+[.、]\s*(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${formatInline(ordered[1])}</li>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${formatInline(unordered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${formatInline(line)}</p>`);
  }

  closeList();
  return html.join("");
}

function renderMessages() {
  messagesEl.innerHTML = "";

  for (const message of messages) {
    const row = document.createElement("article");
    row.className = `message-row ${message.role}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = message.role === "assistant" ? "志" : "我";

    const bubble = document.createElement("div");
    bubble.className = "message";
    if (message.loading) {
      bubble.classList.add("thinking");
      bubble.innerHTML =
        '<span>正在组织回答</span><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
      row.append(avatar, bubble);
      messagesEl.append(row);
      continue;
    }

    if (message.role === "assistant") {
      bubble.innerHTML = renderMarkdown(message.content);
    } else {
      bubble.textContent = message.content;
    }

    row.append(avatar, bubble);
    messagesEl.append(row);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  input.disabled = isLoading;
  sendButton.textContent = isLoading ? "…" : "➤";
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
}

function getRequestMessages(loadingMessage) {
  return messages
    .filter((message) => message !== loadingMessage)
    .slice(-30)
    .map(({ role, content }) => ({ role, content: stripDisclaimer(content) }));
}

function parseSseChunk(chunk, onEvent) {
  const events = chunk.split("\n\n");
  const rest = events.pop() || "";
  for (const event of events) {
    const lines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    for (const line of lines) {
      if (!line) continue;
      onEvent(JSON.parse(line));
    }
  }
  return rest;
}

async function sendMessage(content) {
  messages.push({ role: "user", content });
  saveMessages();

  const loadingMessage = {
    role: "assistant",
    content: "",
    loading: true,
  };
  messages.push(loadingMessage);
  renderMessages();
  setLoading(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: getRequestMessages(loadingMessage),
      }),
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || "请求失败");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, (event) => {
        if (event.type === "delta") {
          loadingMessage.loading = false;
          loadingMessage.content = stripDisclaimer(
            loadingMessage.content + event.content,
          );
          renderMessages();
        }
        if (event.type === "error") {
          throw new Error(event.error || "模型调用失败");
        }
      });
    }
  } catch (error) {
    loadingMessage.loading = false;
    loadingMessage.content = `这次没连上模型：${error.message}`;
  } finally {
    loadingMessage.loading = false;
    loadingMessage.content = stripDisclaimer(loadingMessage.content);
    setLoading(false);
    saveMessages();
    renderMessages();
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content) return;
  input.value = "";
  resizeInput();
  sendMessage(content);
});

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

newChatButton.addEventListener("click", () => {
  messages = [{ ...welcomeMessage }];
  localStorage.removeItem(STORAGE_KEY);
  input.value = "";
  resizeInput();
  renderMessages();
  input.focus();
});

renderMessages();
resizeInput();
