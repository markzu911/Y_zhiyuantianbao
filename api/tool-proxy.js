const SAAS_BASE_URL = process.env.SAAS_BASE_URL || "http://aibigtree.com";

export async function proxyToolRequest(request, response, targetPath) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const upstream = await fetch(`${SAAS_BASE_URL}${targetPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body || {}),
    });

    const payload = await upstream.json().catch(() => ({}));
    return response.status(upstream.status).json(payload);
  } catch (error) {
    return response.status(500).json({
      success: false,
      message: error?.message || "工具积分接口代理失败",
    });
  }
}
