#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_KEY = process.env.MOONSHOT_API_KEY;
const BASE_URL = (process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1").replace(/\/$/, "");

if (!API_KEY) {
  console.error("[kimi-search-mcp] MOONSHOT_API_KEY environment variable is required.");
  process.exit(1);
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const datePattern = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
const sitePattern = /^[^\s()]+$/;

async function callKimi(path, body, timeoutSeconds = 60) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout((timeoutSeconds + 10) * 1000),
      });
    } catch (err) {
      lastError = new Error(`Network error calling Kimi: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      throw lastError;
    }

    const data = await res.json().catch(() => null);
    if (res.ok) return data;

    const apiMessage = data?.error?.message || data?.message || res.statusText;
    const trackId = res.headers.get("x-msh-track-id");
    lastError = new Error(
      `Kimi API error (HTTP ${res.status}): ${apiMessage}${trackId ? `; track ID: ${trackId}` : ""}`
    );
    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      continue;
    }
    throw lastError;
  }
  throw lastError;
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function errorResult(err) {
  return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
}

function formatResults(results, pro = false) {
  if (!results || results.length === 0) {
    return "No results found.";
  }
  return results
    .map((result, index) => {
      const metadata = [
        result.authority && `Authority: ${result.authority}`,
        result.date && `Date: ${result.date}`,
        result.site_name && `Site: ${result.site_name}`,
      ]
        .filter(Boolean)
        .join(" | ");
      const lines = [
        `## ${index + 1}. ${result.title || "Untitled"}`,
        `URL: ${result.url}`,
        metadata,
        `Summary: ${result.snippet || "(none)"}`,
      ].filter(Boolean);
      if (result.text) lines.push(`Content:\n${result.text}`);
      if (pro && result.chunks?.length) {
        lines.push(
          `Relevant excerpts:\n${result.chunks
            .map((chunk) => `- [score: ${chunk.score}] ${chunk.text}`)
            .join("\n")}`
        );
      }
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

const searchFields = {
  text_query: z.string().min(1).describe("Search query. Include specific entities, dates, and source constraints when relevant."),
  limit: z.number().int().min(1).max(20).default(5).describe("Maximum number of results, 1-20. Default 5."),
  timeout_seconds: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(30)
    .describe("Kimi API search timeout in seconds, 1-60. Default 30."),
};

const server = new McpServer({
  name: "kimi-search-mcp",
  version: "1.0.0",
});

server.registerTool(
  "kimi_search",
  {
    title: "Kimi Web Search Basic",
    description:
      "Search the web with Kimi Search Basic. Returns titles, URLs, snippets, dates, and source authority. Keep include_content=false for an overview, then use kimi_fetch on selected URLs, or set it to true when full page text is needed.",
    inputSchema: {
      ...searchFields,
      include_content: z
        .boolean()
        .default(false)
        .describe("Include full page text in each result. Prefer false for initial searches."),
    },
  },
  async ({ text_query, limit, timeout_seconds, include_content }) => {
    try {
      const data = await callKimi(
        "/tools/search",
        { text_query, limit, timeout_seconds, include_content },
        timeout_seconds
      );
      return textResult(formatResults(data.search_results));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "kimi_search_pro",
  {
    title: "Kimi Web Search Pro",
    description:
      "Search the web with Kimi Search Pro. Returns relevant page excerpts ranked by relevance, with source URLs and authority. Best for web QA, RAG, research, and reports. Supports site and publication-date filters.",
    inputSchema: {
      ...searchFields,
      sites: z
        .array(z.string().min(1).regex(sitePattern))
        .max(5)
        .optional()
        .describe("Restrict results to up to 5 sites, combined with OR. Example: [\"gov.cn\", \"miit.gov.cn\"]."),
      time_window: z
        .object({
          start: z.string().regex(datePattern).describe("Start date: YYYY, YYYY-MM, or YYYY-MM-DD."),
          end: z.string().regex(datePattern).describe("End date: YYYY, YYYY-MM, or YYYY-MM-DD."),
        })
        .optional()
        .describe("Publication date range. start must not be after end."),
    },
  },
  async ({ text_query, limit, timeout_seconds, sites, time_window }) => {
    try {
      const data = await callKimi(
        "/tools/search_pro",
        {
          text_query,
          limit,
          timeout_seconds,
          ...(sites !== undefined && { sites }),
          ...(time_window !== undefined && { time_window }),
        },
        timeout_seconds
      );
      return textResult(formatResults(data.search_results, true));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "kimi_fetch",
  {
    title: "Kimi Web Fetch",
    description:
      "Fetch a single HTTP/HTTPS web page with Kimi and return its title and Markdown content. Use after kimi_search to read a specific URL. Subject to site availability, access controls, and Kimi security policy.",
    inputSchema: {
      url: z
        .string()
        .url()
        .max(8192)
        .refine((value) => {
          const parsed = new URL(value);
          return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
        })
        .describe("HTTP/HTTPS URL to fetch. Must not contain a username or password."),
    },
  },
  async ({ url }) => {
    try {
      const data = await callKimi("/tools/fetch", { url });
      const title = data.title ? `# ${data.title}\n\n` : "";
      return textResult(`${title}${data.markdown || "(no extractable content)"}`);
    } catch (err) {
      return errorResult(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[kimi-search-mcp] Server running on stdio.");
