#!/usr/bin/env node
/**
 * higgsfield-mcp-server
 *
 * Remote (Streamable HTTP) MCP server that exposes the Higgsfield AI
 * generative media API (https://docs.higgsfield.ai) as a set of Claude tools:
 * image generation, video generation, job status polling and cancellation.
 *
 * Auth model (two layers):
 *  1. This server -> Higgsfield API: HF_API_KEY_ID + HF_API_KEY_SECRET
 *     (set as environment variables on the host, never sent by the client).
 *  2. Claude -> this server: a bearer token (MCP_ACCESS_TOKEN) that you choose
 *     yourself and configure both here and in Claude's custom connector setup,
 *     so random people who find your URL can't burn your Higgsfield credits.
 */

import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const HF_BASE_URL = "https://platform.higgsfield.ai";
const HF_API_KEY_ID = process.env.HF_API_KEY_ID;
const HF_API_KEY_SECRET = process.env.HF_API_KEY_SECRET;
const MCP_ACCESS_TOKEN = process.env.MCP_ACCESS_TOKEN;
const PORT = parseInt(process.env.PORT || "3000", 10);

if (!HF_API_KEY_ID || !HF_API_KEY_SECRET) {
  console.error(
    "FATAL: HF_API_KEY_ID and HF_API_KEY_SECRET environment variables are required."
  );
  process.exit(1);
}
if (!MCP_ACCESS_TOKEN) {
  console.error(
    "FATAL: MCP_ACCESS_TOKEN environment variable is required (choose any long random string)."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Higgsfield API client
// ---------------------------------------------------------------------------

/** Catalog of Higgsfield endpoints not covered by a dedicated tool below,
 *  reachable through higgsfield_raw_request. Kept as data so it can be
 *  surfaced to the agent via higgsfield_list_models too. */
const EXTRA_ENDPOINTS = [
  {
    path: "/higgsfield-ai/soul/character",
    description:
      "Generate a photo of a previously created Soul character. Requires custom_reference_id (UUID) and custom_reference_strength (0-1). Body: prompt, custom_reference_id, custom_reference_strength, style_id?, batch_size?(1|4), resolution?(720p|1080p), aspect_ratio?, enhance_prompt?, style_strength?, image_reference_url?, seed?",
  },
  {
    path: "/higgsfield-ai/soul/reference",
    description:
      "Generate an image guided by a reference image's style. Body: prompt, image_reference_url (required URI), style_id?, batch_size?(1|4), resolution?(720p|1080p), aspect_ratio?, enhance_prompt?, style_strength?, seed?",
  },
  {
    path: "/flux-pro/kontext/max/text-to-image",
    description:
      "FLUX.1 Kontext [max] text-to-image. Body: prompt, seed?, aspect_ratio? (default 16:9), safety_tolerance?(0-6, default 6)",
  },
  {
    path: "/minimax/hailuo-02/pro/text-to-video",
    description:
      "MiniMax Hailuo-02 Pro text-to-video. Body: prompt, prompt_optimizer?(bool, default true)",
  },
  {
    path: "/minimax/hailuo-02/pro/image-to-video",
    description:
      "MiniMax Hailuo-02 Pro image-to-video. Body: prompt, image_url (required), end_image_url?, prompt_optimizer?(bool, default true)",
  },
  {
    path: "/higgsfield-ai/dop/turbo",
    description:
      "Dynamic Object Processing (turbo) - animate an image with motion presets. Body: prompt, image_url (required), seed?, motions?(array, 0-2 items), end_image_url?, enhance_prompt?(default true)",
  },
  {
    path: "/higgsfield-ai/dop/lite",
    description: "Same as /higgsfield-ai/dop/turbo but the 'lite' (cheaper/faster) variant.",
  },
  {
    path: "/higgsfield-ai/dop/standard",
    description: "Same as /higgsfield-ai/dop/turbo but the 'standard' quality variant.",
  },
];

class HiggsfieldApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "HiggsfieldApiError";
    this.status = status;
    this.body = body;
  }
}

/** POST a generation request to a Higgsfield endpoint path (e.g. "/higgsfield-ai/soul/standard"). */
async function hfCreateRequest(path, body) {
  return hfRequest("POST", path, body);
}

async function hfRequest(method, path, body) {
  const url = `${HF_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Key ${HF_API_KEY_ID}:${HF_API_KEY_SECRET}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new HiggsfieldApiError(
      `Network error calling Higgsfield API: ${err instanceof Error ? err.message : String(err)}`,
      0,
      null
    );
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const hint =
      res.status === 401
        ? " Check that HF_API_KEY_ID / HF_API_KEY_SECRET are correct and active."
        : res.status === 404
          ? " Check the request_id or endpoint path is correct."
          : res.status === 429
            ? " Rate limit or concurrency limit hit - wait and retry."
            : "";
    throw new HiggsfieldApiError(
      `Higgsfield API returned ${res.status} for ${method} ${path}: ${JSON.stringify(json)}.${hint}`,
      res.status,
      json
    );
  }
  return json;
}

function toolError(error) {
  const message =
    error instanceof HiggsfieldApiError
      ? error.message
      : `Error: Unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`;
  return { content: [{ type: "text", text: message }], isError: true };
}

function toolJson(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

// ---------------------------------------------------------------------------
// MCP server + tools
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "higgsfield-mcp-server", version: "1.0.0" });

const aspectRatioAll = z
  .enum(["1:1", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9"])
  .describe("Output aspect ratio");

server.registerTool(
  "higgsfield_generate_photo",
  {
    title: "Generate Photo (Higgsfield Soul)",
    description: `Generate a high-quality, photorealistic image from a text prompt using Higgsfield's "Soul/Standard" model.

Best for: standalone photorealistic stills (product shots, portraits, real-estate/interior mockups, editorial-style images) where no reference image is needed.

This is an ASYNCHRONOUS request: it returns a request_id and a status immediately. The image is NOT ready yet - call higgsfield_check_status with the returned request_id (poll every few seconds) until status is "completed", then read the output URLs from the result.

Returns: { request_id, status, status_url, cancel_url }`,
    inputSchema: {
      prompt: z.string().min(1).max(4000).describe("Detailed text description of the desired image"),
      num_images: z.number().int().min(1).max(4).default(1).describe("Number of image variations to generate (1-4)"),
      resolution: z.enum(["2K", "4K"]).default("2K").describe("Output resolution"),
      aspect_ratio: aspectRatioAll.default("4:3"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ prompt, num_images, resolution, aspect_ratio }) => {
    try {
      const data = await hfCreateRequest("/higgsfield-ai/soul/standard", {
        prompt,
        num_images,
        resolution,
        aspect_ratio,
      });
      return toolJson(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

server.registerTool(
  "higgsfield_generate_image_with_references",
  {
    title: "Generate Image With Reference Photos (Higgsfield Popcorn)",
    description: `Generate an image from a text prompt, optionally guided by up to 8 reference images (e.g. put a product/object/person from reference photos into a new scene, or match a style). Uses Higgsfield's "Popcorn/Auto" model.

Best for: composing a scene around existing photos you already have (e.g. "put this sofa [image_urls] in a bright modern living room").

ASYNCHRONOUS: returns a request_id immediately. Poll higgsfield_check_status until status is "completed".

Returns: { request_id, status, status_url, cancel_url }`,
    inputSchema: {
      prompt: z.string().min(1).max(4000).describe("Detailed text description of the desired image"),
      image_urls: z
        .array(z.string().url())
        .max(8)
        .optional()
        .describe("0-8 publicly reachable reference image URLs to guide composition/style"),
      num_images: z.number().int().min(1).max(8).default(1).describe("Number of image variations to generate (1-8)"),
      resolution: z.enum(["720p", "1600p"]).default("720p"),
      aspect_ratio: z
        .enum(["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"])
        .default("4:3"),
      seed: z.number().int().min(1).max(1000000).optional().describe("Fixed seed for reproducible results"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ prompt, image_urls, num_images, resolution, aspect_ratio, seed }) => {
    try {
      const data = await hfCreateRequest("/higgsfield-ai/popcorn/auto", {
        prompt,
        image_urls,
        num_images,
        resolution,
        aspect_ratio,
        seed,
      });
      return toolJson(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

const veoModeSchema = z.enum(["text-to-video", "image-to-video", "first-last-frame-to-video", "reference-to-video"]);

server.registerTool(
  "higgsfield_generate_video",
  {
    title: "Generate Video (Higgsfield / Google Veo 3.1)",
    description: `Generate a video using Google Veo 3.1 via Higgsfield, with optional native audio. Supports four modes:
- "text-to-video": prompt only
- "image-to-video": animate a single image (requires image_url)
- "first-last-frame-to-video": interpolate between two frames (requires first_frame_url and last_frame_url)
- "reference-to-video": guide generation with 1-3 reference images (requires image_urls)

Set fast=true for the cheaper/faster "veo3.1/fast" variant (lower quality) instead of standard Veo 3.1.

ASYNCHRONOUS: returns a request_id immediately. Poll higgsfield_check_status until status is "completed".

Returns: { request_id, status, status_url, cancel_url }`,
    inputSchema: {
      mode: veoModeSchema.describe("Which Veo generation mode to use - determines which of image_url/first_frame_url/last_frame_url/image_urls is required"),
      prompt: z.string().min(1).max(4000),
      image_url: z.string().url().optional().describe("Required when mode = image-to-video"),
      first_frame_url: z.string().url().optional().describe("Required when mode = first-last-frame-to-video"),
      last_frame_url: z.string().url().optional().describe("Required when mode = first-last-frame-to-video"),
      image_urls: z.array(z.string().url()).min(1).max(3).optional().describe("Required when mode = reference-to-video (1-3 images)"),
      duration: z.enum(["4", "6", "8"]).default("6").describe("Duration in seconds"),
      resolution: z.enum(["720", "1080"]).default("720"),
      aspect_ratio: z.enum(["16:9", "9:16"]).default("16:9"),
      generate_audio: z.boolean().default(false).describe("Generate native synchronized audio"),
      fast: z.boolean().default(false).describe("Use the cheaper/faster veo3.1/fast variant"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ mode, prompt, image_url, first_frame_url, last_frame_url, image_urls, duration, resolution, aspect_ratio, generate_audio, fast }) => {
    try {
      const base = fast ? "/veo3.1/fast" : "/veo3.1";
      let path;
      let body;
      switch (mode) {
        case "text-to-video":
          path = base;
          body = { prompt, aspect_ratio, resolution, generate_audio, duration };
          break;
        case "image-to-video":
          if (!image_url) throw new Error("image_url is required when mode = image-to-video");
          path = `${base}/image-to-video`;
          body = { prompt, image_url, duration, resolution, aspect_ratio, generate_audio };
          break;
        case "first-last-frame-to-video":
          if (!first_frame_url || !last_frame_url)
            throw new Error("first_frame_url and last_frame_url are both required when mode = first-last-frame-to-video");
          path = `${base}/first-last-frame-to-video`;
          body = { prompt, first_frame_url, last_frame_url, duration, resolution, aspect_ratio, generate_audio };
          break;
        case "reference-to-video":
          if (!image_urls || image_urls.length === 0)
            throw new Error("image_urls (1-3 items) is required when mode = reference-to-video");
          path = `${base}/reference-to-video`;
          body = { prompt, image_urls, duration, resolution, aspect_ratio, generate_audio };
          break;
      }
      const data = await hfCreateRequest(path, body);
      return toolJson(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

server.registerTool(
  "higgsfield_generate_video_kling",
  {
    title: "Generate Video (Higgsfield / Kling)",
    description: `Generate a cinematic video using Kling AI via Higgsfield. Good for stylized/cinematic motion with fine control via cfg_scale and negative_prompt.

tier options: "v2.1-master" (best quality, supports text-to-video and image-to-video), "v2.1-pro" (image-to-video only), "v2.1-standard" (image-to-video only, cheapest v2.1), "v2.5-turbo-pro" (newer, faster, supports text-to-video and image-to-video), "v2.5-turbo-standard" (image-to-video only).

If image_url is provided, image-to-video is used; otherwise text-to-video (only supported on v2.1-master and v2.5-turbo-pro tiers).

ASYNCHRONOUS: returns a request_id immediately. Poll higgsfield_check_status until status is "completed".

Returns: { request_id, status, status_url, cancel_url }`,
    inputSchema: {
      tier: z
        .enum(["v2.1-master", "v2.1-pro", "v2.1-standard", "v2.5-turbo-pro", "v2.5-turbo-standard"])
        .default("v2.1-master"),
      prompt: z.string().min(1).max(2500),
      image_url: z.string().url().optional().describe("If set, generates image-to-video; otherwise text-to-video"),
      duration: z.union([z.literal(5), z.literal(10)]).default(5).describe("Duration in seconds (5 or 10)"),
      cfg_scale: z.number().min(0).max(1).default(0.5).describe("Prompt adherence strength, 0-1"),
      aspect_ratio: z.enum(["1:1", "16:9", "9:16"]).default("1:1").describe("Only used for text-to-video"),
      negative_prompt: z.string().default("").describe("What to avoid in the generation"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ tier, prompt, image_url, duration, cfg_scale, aspect_ratio, negative_prompt }) => {
    try {
      const isTextToVideo = !image_url;
      const tierPathMap = {
        "v2.1-master": "kling-video/v2.1/master",
        "v2.1-pro": "kling-video/v2.1/pro",
        "v2.1-standard": "kling-video/v2.1/standard",
        "v2.5-turbo-pro": "kling-video/v2.5-turbo/pro",
        "v2.5-turbo-standard": "kling-video/v2.5-turbo/standard",
      };
      const base = tierPathMap[tier];
      if (isTextToVideo && (tier === "v2.1-pro" || tier === "v2.1-standard" || tier === "v2.5-turbo-standard")) {
        throw new Error(`tier "${tier}" only supports image-to-video - provide image_url, or switch to "v2.1-master" / "v2.5-turbo-pro" for text-to-video`);
      }
      const path = isTextToVideo ? `/${base}/text-to-video` : `/${base}/image-to-video`;
      const body = isTextToVideo
        ? { prompt, duration, cfg_scale, aspect_ratio, negative_prompt }
        : { prompt, image_url, duration, cfg_scale, negative_prompt };
      const data = await hfCreateRequest(path, body);
      return toolJson(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

server.registerTool(
  "higgsfield_generate_video_seedance",
  {
    title: "Generate Video (Higgsfield / ByteDance Seedance)",
    description: `Generate a video using ByteDance Seedance v1 via Higgsfield - a fast, affordable video model. Good for quick drafts / high-volume generation.

tier: "lite" (cheapest) or "pro-fast" (higher quality, still fast).
If image_url is provided, image-to-video is used; otherwise text-to-video.

ASYNCHRONOUS: returns a request_id immediately. Poll higgsfield_check_status until status is "completed".

Returns: { request_id, status, status_url, cancel_url }`,
    inputSchema: {
      tier: z.enum(["lite", "pro-fast"]).default("lite"),
      prompt: z.string().min(1).max(4000),
      image_url: z.string().url().optional().describe("If set, generates image-to-video; otherwise text-to-video"),
      duration: z.number().int().min(2).max(12).default(5).describe("Duration in seconds (2-12)"),
      resolution: z.enum(["480", "720", "1080"]).default("720"),
      aspect_ratio: z.enum(["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"]).default("16:9"),
      camera_fixed: z.boolean().default(false).describe("Lock the camera in place (no camera motion)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ tier, prompt, image_url, duration, resolution, aspect_ratio, camera_fixed }) => {
    try {
      const base = tier === "lite" ? "bytedance/seedance/v1/lite" : "bytedance/seedance/v1/pro/fast";
      const path = image_url ? `/${base}/image-to-video` : `/${base}/text-to-video`;
      const body = image_url
        ? { prompt, image_url, duration, resolution, aspect_ratio, camera_fixed }
        : { prompt, duration, resolution, aspect_ratio, camera_fixed };
      const data = await hfCreateRequest(path, body);
      return toolJson(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

server.registerTool(
  "higgsfield_check_status",
  {
    title: "Check Generation Request Status",
    description: `Check the status of a previously submitted generation request (from any of the higgsfield_generate_* tools). Call this repeatedly (every few seconds) until status is "completed" or "failed".

Returns the full RequestStatus object, including output media URLs once completed.`,
    inputSchema: {
      request_id: z.string().min(1).describe("The request_id returned by a higgsfield_generate_* tool"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ request_id }) => {
    try {
      const data = await hfRequest("GET", `/requests/${request_id}/status`);
      return toolJson(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

server.registerTool(
  "higgsfield_cancel_request",
  {
    title: "Cancel Generation Request",
    description: `Cancel a queued generation request that has not started processing yet. Requests already being processed cannot be cancelled (the API returns 400).`,
    inputSchema: {
      request_id: z.string().min(1).describe("The request_id to cancel"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ request_id }) => {
    try {
      await hfRequest("POST", `/requests/${request_id}/cancel`);
      return toolJson({ request_id, cancelled: true });
    } catch (error) {
      return toolError(error);
    }
  }
);

server.registerTool(
  "higgsfield_list_models",
  {
    title: "List Available Higgsfield Models/Endpoints",
    description: `List every Higgsfield generation endpoint available, including the ones covered by dedicated tools (higgsfield_generate_photo, higgsfield_generate_image_with_references, higgsfield_generate_video, higgsfield_generate_video_kling, higgsfield_generate_video_seedance) and the extra ones only reachable via higgsfield_raw_request (Soul character/reference, FLUX Kontext, MiniMax Hailuo, DOP motion presets). Use this when unsure which tool/endpoint fits a request.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const catalog = {
      dedicated_tools: [
        { tool: "higgsfield_generate_photo", endpoint: "/higgsfield-ai/soul/standard", kind: "image" },
        { tool: "higgsfield_generate_image_with_references", endpoint: "/higgsfield-ai/popcorn/auto", kind: "image" },
        { tool: "higgsfield_generate_video", endpoint: "/veo3.1[/fast]/*", kind: "video" },
        { tool: "higgsfield_generate_video_kling", endpoint: "/kling-video/*", kind: "video" },
        { tool: "higgsfield_generate_video_seedance", endpoint: "/bytedance/seedance/*", kind: "video" },
      ],
      raw_request_only: EXTRA_ENDPOINTS,
    };
    return toolJson(catalog);
  }
);

server.registerTool(
  "higgsfield_raw_request",
  {
    title: "Raw Higgsfield API Request (advanced / any endpoint)",
    description: `Make a raw POST request to any Higgsfield generation endpoint not covered by a dedicated tool. Call higgsfield_list_models first to see supported paths and their body fields, especially the "raw_request_only" list (e.g. /higgsfield-ai/soul/character, /higgsfield-ai/soul/reference, /flux-pro/kontext/max/text-to-image, /minimax/hailuo-02/pro/text-to-video, /minimax/hailuo-02/pro/image-to-video, /higgsfield-ai/dop/turbo|lite|standard).

ASYNCHRONOUS: returns a request_id immediately, poll with higgsfield_check_status.

Returns: { request_id, status, status_url, cancel_url }`,
    inputSchema: {
      path: z.string().min(1).describe('Endpoint path, e.g. "/higgsfield-ai/soul/character"'),
      body: z.record(z.any()).describe("JSON request body matching that endpoint's schema (see higgsfield_list_models)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ path, body }) => {
    try {
      const data = await hfCreateRequest(path, body);
      return toolJson(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, name: "higgsfield-mcp-server", mcp_endpoint: "/mcp" });
});
app.get("/health", (_req, res) => res.send("ok"));

function checkAuth(req, res) {
  // Supports two ways of presenting the token, so this works both with
  // clients that let you set a custom Authorization header AND with
  // Claude's "Add custom connector" dialog, which only takes a URL
  // (so the token is passed as ?token=... in the connector URL instead).
  const header = req.headers["authorization"] || "";
  const headerToken = header.startsWith("Bearer ") ? header.slice(7) : header;
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const token = headerToken || queryToken;
  if (token !== MCP_ACCESS_TOKEN) {
    res.status(401).json({ error: "Unauthorized: missing or invalid token (header or ?token= query param)" });
    return false;
  }
  return true;
}

app.post("/mcp", async (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.listen(PORT, () => {
  console.error(`higgsfield-mcp-server listening on port ${PORT} (MCP endpoint: /mcp)`);
});
