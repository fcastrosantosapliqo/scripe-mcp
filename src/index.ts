#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ScripeClient } from "./client.js";

const apiKey = process.env.SCRIPE_API_KEY;
if (!apiKey) {
  console.error("Error: SCRIPE_API_KEY environment variable is required");
  process.exit(1);
}

const client = new ScripeClient(apiKey);
const server = new McpServer({
  name: "scripe",
  version: "1.0.0",
});

// ── Shared enums ───────────────────────────────────────────────────────────────

const POST_STATUSES = [
  "waitingProcessing",
  "draft",
  "waitingApproval",
  "approved",
  "rejected",
  "scheduled",
  "published",
  "suggested",
] as const;

const CONTENT_TYPES = [
  "PERSONAL",
  "BUSINESS_INTERNAL",
  "BUSINESS_EXTERNAL",
  "EDUCATIONAL",
  "UNKNOWN",
] as const;

// ── Health ─────────────────────────────────────────────────────────────────────

server.tool(
  "scripe_health",
  "Unauthenticated liveness probe — confirms the Scripe API is reachable",
  {},
  async () => {
    const result = await client.health();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Workspace ──────────────────────────────────────────────────────────────────

server.tool(
  "scripe_get_workspace",
  "Get the current authenticated workspace and principal info",
  {},
  async () => {
    const workspace = await client.getWorkspace();
    return { content: [{ type: "text", text: JSON.stringify(workspace, null, 2) }] };
  }
);

// ── Projects ───────────────────────────────────────────────────────────────────

server.tool(
  "scripe_list_projects",
  "List all Scripe projects in the workspace (paginated). Each project has an id (proj_*) needed by other tools.",
  {
    cursor: z.string().optional().describe("Opaque pagination token from a previous response"),
    limit: z.number().int().min(1).max(200).optional().describe("Results per page (1–200, default 50)"),
  },
  async ({ cursor, limit }) => {
    const result = await client.listProjects({ cursor, limit });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_get_project",
  "Get a single Scripe project by ID",
  {
    projectId: z.string().describe("Project ID in proj_* format"),
  },
  async ({ projectId }) => {
    const result = await client.getProject(projectId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Posts ──────────────────────────────────────────────────────────────────────

server.tool(
  "scripe_list_posts",
  "List posts for a project. Filter by one or more statuses, or by date range.",
  {
    projectId: z.string().describe("Project ID (proj_*) — required"),
    status: z
      .array(z.enum(POST_STATUSES))
      .optional()
      .describe(
        "Filter by post status. Accepted values: waitingProcessing, draft, waitingApproval, approved, rejected, scheduled, published, suggested. Pass multiple to include several statuses."
      ),
    dateFrom: z.string().optional().describe("Start date filter (YYYY-MM-DD) on createdAt"),
    dateTo: z.string().optional().describe("End date filter (YYYY-MM-DD), inclusive end-of-day UTC"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
    limit: z.number().int().min(1).max(200).optional().describe("Results per page (1–200, default 50)"),
  },
  async ({ projectId, status, dateFrom, dateTo, cursor, limit }) => {
    const result = await client.listPosts({
      projectId,
      status: status?.join(","),
      dateFrom,
      dateTo,
      cursor,
      limit,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_get_post",
  "Get a single post by ID",
  {
    postId: z.string().describe("Post ID in post_* format"),
  },
  async ({ postId }) => {
    const result = await client.getPost(postId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_create_post",
  "Create a draft or scheduled post in Scripe. To schedule, provide scheduledFor as a future ISO 8601 timestamp.",
  {
    projectId: z.string().describe("Project ID (proj_*) — required"),
    content: z
      .string()
      .optional()
      .describe("Post body text (TipTap-compatible, up to 100,000 chars)"),
    title: z.string().optional().describe("Post title (up to 500 chars)"),
    contentType: z
      .enum(CONTENT_TYPES)
      .optional()
      .describe("Content category (default: PERSONAL)"),
    scheduledFor: z
      .string()
      .optional()
      .describe("Future ISO 8601 timestamp to publish. When provided, post status becomes 'scheduled'."),
    idempotencyKey: z
      .string()
      .optional()
      .describe("Unique key to safely retry without creating duplicate posts (replayed for 24 h)"),
  },
  async ({ projectId, content, title, contentType, scheduledFor, idempotencyKey }) => {
    const result = await client.createPost({
      projectId,
      content,
      title,
      contentType,
      scheduledFor,
      idempotencyKey,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_generate_post",
  "Asynchronously AI-generate a LinkedIn post from raw text or an existing note. Returns a job — poll scripe_get_job until status is DONE, then retrieve the generated post.",
  {
    text: z
      .string()
      .optional()
      .describe("Raw text or transcript to generate a post from. Use this OR noteId, not both."),
    noteId: z
      .string()
      .optional()
      .describe("ID of an existing Scripe note to generate a post from. Use this OR text, not both."),
    projectId: z.string().optional().describe("Project to attach the generated post to"),
    idempotencyKey: z
      .string()
      .optional()
      .describe("Unique key to avoid spawning duplicate generation jobs"),
  },
  async ({ text, noteId, projectId, idempotencyKey }) => {
    if (!text && !noteId) {
      return {
        content: [{ type: "text", text: "Error: provide either 'text' or 'noteId' to generate a post." }],
        isError: true,
      };
    }
    const result = await client.generatePost({ text, noteId, projectId, idempotencyKey });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Notes ──────────────────────────────────────────────────────────────────────

server.tool(
  "scripe_list_notes",
  "List notes for a project. Supports folder filtering and date range.",
  {
    projectId: z.string().describe("Project ID (proj_*) — required"),
    folderId: z.string().optional().describe("Filter by folder ID"),
    dateFrom: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
    limit: z.number().int().min(1).max(200).optional().describe("Results per page (1–200, default 50)"),
  },
  async ({ projectId, folderId, dateFrom, dateTo, cursor, limit }) => {
    const result = await client.listNotes({ projectId, folderId, dateFrom, dateTo, cursor, limit });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_get_note",
  "Get a single note by ID",
  {
    noteId: z.string().describe("Note ID in note_* format"),
  },
  async ({ noteId }) => {
    const result = await client.getNote(noteId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_create_note",
  "Create a new note in Scripe. Also queues a content slot for the note's date.",
  {
    projectId: z.string().describe("Project ID (proj_*) — required"),
    content: z.string().optional().describe("Note text (up to 100,000 chars)"),
    folderId: z.string().nullish().describe("Folder to place the note in (null = root)"),
    date: z.string().optional().describe("ISO 8601 date for the note slot (defaults to now)"),
    contentType: z
      .enum(CONTENT_TYPES)
      .optional()
      .describe("Content category for the slot (default: PERSONAL)"),
    idempotencyKey: z.string().optional().describe("Unique key to safely retry without duplicating the note"),
  },
  async ({ projectId, content, folderId, date, contentType, idempotencyKey }) => {
    const result = await client.createNote({
      projectId,
      content,
      folderId: folderId ?? undefined,
      date,
      contentType,
      idempotencyKey,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Sources ────────────────────────────────────────────────────────────────────

server.tool(
  "scripe_get_source",
  "Get a source/transcription by ID. Note: transcript is truncated to 2,000 characters (response includes textPreviewTruncated flag).",
  {
    sourceId: z.string().describe("Source ID in src_* format"),
  },
  async ({ sourceId }) => {
    const result = await client.getSource(sourceId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_create_source",
  "Create a text source (synchronous). Use this to push a transcript or raw text into Scripe as a source that can then be used to generate posts.",
  {
    content: z.string().describe("The full text or transcript content"),
    projectId: z.string().optional().describe("Project to attach this source to"),
    idempotencyKey: z.string().optional().describe("Unique key to safely retry without duplicating the source"),
  },
  async ({ content, projectId, idempotencyKey }) => {
    const result = await client.createSource({ content, projectId, idempotencyKey });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Jobs ───────────────────────────────────────────────────────────────────────

server.tool(
  "scripe_list_jobs",
  "List async jobs (paginated). Useful to monitor post generation or knowledge ingestion progress. Job statuses: QUEUED → RUNNING → DONE / FAILED / CANCELLED.",
  {
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
    limit: z.number().int().min(1).max(200).optional().describe("Results per page (1–200, default 50)"),
  },
  async ({ cursor, limit }) => {
    const result = await client.listJobs({ cursor, limit });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_get_job",
  "Get a single async job by ID including its current progress and result. Poll this after scripe_generate_post — for post generation, poll ~every second; back off to every 5s after 30s.",
  {
    jobId: z.string().describe("Job ID"),
  },
  async ({ jobId }) => {
    const result = await client.getJob(jobId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_cancel_job",
  "Cancel a queued async job. Only jobs in QUEUED state can be cancelled.",
  {
    jobId: z.string().describe("Job ID to cancel"),
  },
  async ({ jobId }) => {
    await client.cancelJob(jobId);
    return { content: [{ type: "text", text: `Job ${jobId} cancelled successfully.` }] };
  }
);

// ── Start server ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Scripe MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
