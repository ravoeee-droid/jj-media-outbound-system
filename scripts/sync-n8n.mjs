import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const baseUrl = (process.env.N8N_BASE_URL || "").replace(/\/$/, "");
const apiKey = process.env.N8N_API_KEY || "";
const autoActivate = process.env.N8N_AUTO_ACTIVATE === "true";

if (!baseUrl || !apiKey) {
  throw new Error("N8N_BASE_URL und N8N_API_KEY müssen gesetzt sein.");
}

const headers = {
  accept: "application/json",
  "content-type": "application/json",
  "X-N8N-API-KEY": apiKey,
};

async function n8n(path, options = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const body = await response.text();
  const payload = body ? JSON.parse(body) : {};
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} fehlgeschlagen (${response.status}): ${body.slice(0, 800)}`);
  }
  return payload;
}

const workflowDirectory = new URL("../n8n/workflows/", import.meta.url);
const files = (await readdir(workflowDirectory)).filter((file) => file.endsWith(".json")).sort();
const existing = await n8n("/workflows?limit=250");
const workflows = Array.isArray(existing.data) ? existing.data : [];

for (const file of files) {
  const definition = JSON.parse(await readFile(join(workflowDirectory.pathname, file), "utf8"));
  const payload = {
    name: definition.name,
    nodes: definition.nodes,
    connections: definition.connections,
    settings: definition.settings || {},
  };
  const current = workflows.find((workflow) => workflow.name === definition.name);
  let result;
  if (current?.id) {
    result = await n8n(`/workflows/${current.id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    process.stdout.write(`updated ${definition.name} (${current.id})\n`);
  } else {
    result = await n8n("/workflows", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    process.stdout.write(`created ${definition.name} (${result.id})\n`);
  }
  if (autoActivate && result.id && !result.active) {
    await n8n(`/workflows/${result.id}/activate`, { method: "POST" });
    process.stdout.write(`activated ${definition.name}\n`);
  }
}
