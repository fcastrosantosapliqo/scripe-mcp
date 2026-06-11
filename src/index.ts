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

// ── File ingestion (NOT media attachment) ─────────────────────────────────────
//
// These tools let you feed files into Scripe so its AI can extract/transcribe
// the content and use it to generate post *text*. They do NOT attach images or
// PDFs to a LinkedIn post as visual media — LinkedIn publishing with media
// attachments is not supported by the Scripe API.

server.tool(
  "scripe_create_upload",
  "Mint a presigned S3 URL so you can upload a file (PDF, image, audio, video) for AI content ingestion. " +
  "IMPORTANT: this is NOT for attaching media to a LinkedIn post. It makes the file available as source material " +
  "that Scripe's AI can read/transcribe to generate post text. " +
  "Step 1 of 2 — follow with scripe_ingest_file_as_source. " +
  "Supported formats and limits: PDF/DOCX/TXT/MD/HTML (50 MB), PNG/JPEG (25 MB), MP3/WAV (500 MB), MP4/MOV (1 GB). " +
  "The returned uploadUrl expires in 15 minutes; PUT the file bytes directly to that URL with a matching Content-Type header.",
  {
    contentType: z
      .string()
      .describe(
        "MIME type of the file you will upload, e.g. application/pdf, image/png, image/jpeg, audio/mpeg, video/mp4. Must be on Scripe's allow-list."
      ),
    maxSizeBytes: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("File size in bytes (≥1). Defaults to the per-type cap. S3 rejects uploads that exceed this."),
  },
  async ({ contentType, maxSizeBytes }) => {
    const result = await client.createUpload({ contentType, maxSizeBytes });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_ingest_file_as_source",
  "Step 2 of 2: after uploading a file to S3 via scripe_create_upload, register it with Scripe as a source. " +
  "Scripe will extract text from documents or transcribe audio/video; the resulting content can then be used " +
  "with scripe_generate_post to draft a LinkedIn post. " +
  "IMPORTANT: this does NOT attach the file as visual media to a LinkedIn post — the file is used for text generation only. " +
  "Returns a job — poll scripe_get_job until status is DONE, then use scripe_list_posts or scripe_generate_post.",
  {
    projectId: z.string().describe("Project ID (proj_*) to attach this source to — required"),
    uploadId: z.string().describe("Upload ID (upl_*) returned by scripe_create_upload"),
    name: z
      .string()
      .nullish()
      .describe("Human-readable label for the source (defaults to the S3 key filename)"),
    idempotencyKey: z.string().optional().describe("Unique key to safely retry without duplicating the ingest job"),
  },
  async ({ projectId, uploadId, name, idempotencyKey }) => {
    const result = await client.createFileSource({
      projectId,
      uploadId,
      name: name ?? undefined,
      idempotencyKey,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scripe_add_to_knowledge_base",
  "Ingest reference material into your Scripe knowledge base so the AI can draw on it when generating future posts. " +
  "Accepts four input types: 'text' (plain text up to 1 MB), 'file' (requires a prior scripe_create_upload call), " +
  "'url' (public web page), or 'youtube' (transcript extracted from a YouTube video). " +
  "IMPORTANT: this is for knowledge ingestion only — it does NOT attach media to a LinkedIn post. " +
  "Returns a job — poll scripe_get_job until DONE. Note: read/list/delete for knowledge documents is not yet in the API; use the Scripe dashboard to view ingested documents.",
  {
    type: z
      .enum(["text", "file", "url", "youtube"])
      .describe("Input type: 'text' = plain text, 'file' = uploaded file (needs uploadId), 'url' = web page, 'youtube' = YouTube video"),
    name: z
      .string()
      .max(500)
      .optional()
      .describe("Label for the document (required for 'text' and 'file' types; optional for 'url' and 'youtube', defaults to the URL)"),
    text: z
      .string()
      .optional()
      .describe("Plain text content — required when type is 'text' (up to 1 MB)"),
    uploadId: z
      .string()
      .optional()
      .describe("Upload ID (upl_*) from scripe_create_upload — required when type is 'file'"),
    url: z
      .string()
      .optional()
      .describe("Public URL of a web page or YouTube video — required when type is 'url' or 'youtube'"),
    projectId: z
      .string()
      .optional()
      .describe("Project ID (proj_*) to scope the document to one project. Omit to make it visible across the whole workspace."),
    idempotencyKey: z.string().optional().describe("Unique key to safely retry without duplicating the ingest job"),
  },
  async ({ type, name, text, uploadId, url, projectId, idempotencyKey }) => {
    if (type === "text" && !text) {
      return { content: [{ type: "text", text: "Error: 'text' is required when type is 'text'." }], isError: true };
    }
    if (type === "file" && !uploadId) {
      return { content: [{ type: "text", text: "Error: 'uploadId' is required when type is 'file'. Call scripe_create_upload first." }], isError: true };
    }
    if ((type === "url" || type === "youtube") && !url) {
      return { content: [{ type: "text", text: `Error: 'url' is required when type is '${type}'.` }], isError: true };
    }
    const result = await client.createKnowledge({ type, name, text, uploadId, url, projectId, idempotencyKey });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
