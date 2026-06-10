import { proxyToolRequest } from "../tool-proxy.js";

export default function handler(request, response) {
  return proxyToolRequest(request, response, "/api/tool/consume");
}
