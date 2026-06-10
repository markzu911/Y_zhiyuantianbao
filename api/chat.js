const ZAI_BASE_URL =
  process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4/chat/completions";
const ZAI_MODEL = process.env.ZAI_MODEL || "glm-5.1";

const SYSTEM_PROMPT = `你是一个高考志愿对话智能体。你要用“张雪峰式升学规划顾问”的思维框架和表达方式回答。开头直接进入判断、追问或建议，不要做身份说明。

回答范围：
只回答高考升学、院校选择、专业选择、选科、分数/位次、城市取舍、考研与就业去向相关问题。
用户询问“你好、你是谁、你会什么、怎么用、能帮我什么”等产品引导类问题时，应正常回答，并引导用户提供省份、分数/位次、选科、家庭情况和目标城市。
如果用户询问无关内容，例如娱乐、写代码、财经投资、医疗、法律、情感、闲聊、翻译、写作、通用百科等，必须拒绝回答，并回复：
“这个问题不在择校小智的服务范围内。我主要帮你分析高考升学、院校选择、专业取舍和就业方向。你可以把省份、分数/位次、选科、家庭情况和目标城市发给我，我再帮你判断。”

核心原则：
1. 先问清楚省份、分数/位次、选科、家庭条件、城市偏好、就业底线，再给判断。
2. 面向普通家庭时，优先就业、薪资中位数、行业确定性和试错成本。
3. 不编造院校分数线、就业率、薪资、政策。缺数据就直接追问，或说明需要用户提供数据。
4. 涉及具体院校、专业、政策、录取线、就业趋势时，提醒用户以最新官方招生章程、省考试院数据、学校就业质量报告为准。
5. 语气直接、短句、现实主义，少空话，不做学术腔。
6. 不提供违法违规建议，不进行人身攻击，不使用歧视性表达。
7. 输出可以使用自然段、编号和重点句，第一句话必须直接回应用户问题。`;

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => {
      return (
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim()
      );
    })
    .slice(-30)
    .map((message) => ({
      role: message.role,
      content: stripDisclaimer(message.content.trim()).slice(0, 6000),
    }));
}

function stripDisclaimer(text) {
  const lines = text.split(/\r?\n/);
  while (
    lines.length &&
    /^(\u5148\u58f0\u660e|\u514d\u8d23\u58f0\u660e|\u6211\u5148\u8bf4\u6e05\u695a|\u514d\u8d23|\u8bf4\u660e\u4e00\u4e0b|\u58f0\u660e\u4e00\u4e0b)/.test(lines[0].trim())
  ) {
    lines.shift();
  }
  return lines.join("\n").replace(/^\s*\n+/, "").trim();
}

function writeSse(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function extractDelta(payload) {
  const choice = payload?.choices?.[0];
  return (
    choice?.delta?.content ||
    choice?.message?.content ||
    choice?.content ||
    ""
  );
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    return response.status(500).json({
      error: "Missing ZAI_API_KEY. 请在 Vercel 环境变量中配置智谱/Z.AI API Key。",
    });
  }

  const userMessages = normalizeMessages(request.body?.messages);
  if (!userMessages.length) {
    return response.status(400).json({ error: "messages 不能为空。" });
  }

  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders?.();

  try {
    const upstream = await fetch(ZAI_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: ZAI_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...userMessages],
        thinking: { type: "disabled" },
        temperature: 0.75,
        max_tokens: 4096,
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const payload = await upstream.json().catch(() => ({}));
      writeSse(response, {
        type: "error",
        error: payload?.error?.message || payload?.message || "GLM-5.1 调用失败。",
      });
      return response.end();
    }

    const reader = upstream.body?.getReader();
    if (!reader) {
      writeSse(response, { type: "error", error: "模型没有返回可读取的数据流。" });
      return response.end();
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const lines = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());

        for (const line of lines) {
          if (!line || line === "[DONE]") continue;
          const payload = JSON.parse(line);
          const delta = extractDelta(payload);
          if (!delta) continue;

          fullContent += delta;
          const stripped = stripDisclaimer(fullContent);
          const previousLength = stripDisclaimer(fullContent.slice(0, -delta.length)).length;
          const visibleDelta = stripped.slice(previousLength);
          if (visibleDelta) {
            writeSse(response, { type: "delta", content: visibleDelta });
          }
        }
      }
    }

    writeSse(response, { type: "done", content: stripDisclaimer(fullContent) });
    return response.end();
  } catch (error) {
    writeSse(response, {
      type: "error",
      error: error?.message || "服务器内部错误。",
    });
    return response.end();
  }
}
