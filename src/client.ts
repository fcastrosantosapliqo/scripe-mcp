/**
 * Thin HTTP client for the Scripe API v1.
 * All methods throw on non-2xx responses with a descriptive message.
 */

const BASE_URL = "https://api.scripe.io/v1";
const API_VERSION = "2026-08-01";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface Pagination {
  next_cursor: string | null;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

// ── Resource types ────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  [key: string]: unknown;
}

export type ProjectType = "PERSONAL_BRAND" | "COMPANY_PAGE";
export type ProjectStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "ERROR";

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  url: string | null;
  createdAt: string;
}

export type PostStatus =
  | "waitingProcessing"
  | "draft"
  | "waitingApproval"
  | "approved"
  | "rejected"
  | "scheduled"
  | "published"
  | "suggested";

export type ContentType =
  | "PERSONAL"
  | "BUSINESS_INTERNAL"
  | "BUSINESS_EXTERNAL"
  | "EDUCATIONAL"
  | "UNKNOWN";

export interface Post {
  id: string;
  projectId: string | null;
  status: PostStatus;
  platform: string;
  contentType: ContentType;
  title: string;
  content: string;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface Slot {
  id: string;
  date: string;
  contentType: ContentType | null;
}

export interface Note {
  id: string;
  projectId: string;
  folderId: string | null;
  content: string;
  createdAt: string;
  updatedAt: string | null;
  slot: Slot | null;
}

export interface Source {
  id: string;
  type?: string;
  status?: string;
  textPreviewTruncated?: boolean;
  [key: string]: unknown;
}

export type JobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  progress?: number | null;
  result?: unknown;
  [key: string]: unknown;
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface ListPostsInput {
  projectId: string;
  status?: string; // comma-separated PostStatus values
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
}

export interface CreatePostInput {
  projectId: string;
  content?: string;
  title?: string;
  contentType?: ContentType;
  scheduledFor?: string; // ISO 8601 future timestamp → sets status to "scheduled"
  idempotencyKey?: string;
}

export interface GeneratePostInput {
  text?: string;
  noteId?: string;
  projectId?: string;
  idempotencyKey?: string;
}

export interface ListNotesInput {
  projectId: string;
  folderId?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
}

export interface CreateNoteInput {
  projectId: string;
  content?: string;
  folderId?: string | null;
  date?: string; // ISO 8601, defaults to now
  contentType?: ContentType;
  idempotencyKey?: string;
}

export interface CreateSourceInput {
  content: string; // plain text / transcript
  projectId?: string;
  idempotencyKey?: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class ScripeClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "Scripe-Api-Version": API_VERSION,
    };

    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Scripe API ${response.status}: ${text}`);
    }

    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const s = qs.toString();
    return s ? `?${s}` : "";
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  async health(): Promise<unknown> {
    return this.request("GET", "/health");
  }

  async healthAuth(): Promise<unknown> {
    return this.request("GET", "/health/auth");
  }

  // ── Workspace ───────────────────────────────────────────────────────────────

  async getWorkspace(): Promise<Workspace> {
    return this.request<Workspace>("GET", "/workspaces/me");
  }

  // ── Projects ─────────────────────────────────────────────────────────────────

  async listProjects(params?: { cursor?: string; limit?: number }): Promise<PaginatedResponse<Project>> {
    const q = this.buildQuery({ cursor: params?.cursor, limit: params?.limit });
    return this.request<PaginatedResponse<Project>>("GET", `/projects${q}`);
  }

  async getProject(projectId: string): Promise<{ data: Project }> {
    return this.request<{ data: Project }>("GET", `/projects/${projectId}`);
  }

  // ── Posts ────────────────────────────────────────────────────────────────────

  async listPosts(input: ListPostsInput): Promise<PaginatedResponse<Post>> {
    const q = this.buildQuery({
      projectId: input.projectId,
      status: input.status,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      cursor: input.cursor,
      limit: input.limit,
    });
    return this.request<PaginatedResponse<Post>>("GET", `/posts${q}`);
  }

  async getPost(postId: string): Promise<{ data: Post }> {
    return this.request<{ data: Post }>("GET", `/posts/${postId}`);
  }

  async createPost(input: CreatePostInput): Promise<{ data: Post }> {
    const { idempotencyKey, ...body } = input;
    return this.request<{ data: Post }>("POST", "/posts", body, idempotencyKey);
  }

  async generatePost(input: GeneratePostInput): Promise<{ data: Job }> {
    const { idempotencyKey, ...body } = input;
    return this.request<{ data: Job }>("POST", "/posts/generations", body, idempotencyKey);
  }

  // ── Notes ────────────────────────────────────────────────────────────────────

  async listNotes(input: ListNotesInput): Promise<PaginatedResponse<Note>> {
    const q = this.buildQuery({
      projectId: input.projectId,
      folderId: input.folderId,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      cursor: input.cursor,
      limit: input.limit,
    });
    return this.request<PaginatedResponse<Note>>("GET", `/notes${q}`);
  }

  async getNote(noteId: string): Promise<{ data: Note }> {
    return this.request<{ data: Note }>("GET", `/notes/${noteId}`);
  }

  async createNote(input: CreateNoteInput): Promise<{ data: Note }> {
    const { idempotencyKey, ...body } = input;
    return this.request<{ data: Note }>("POST", "/notes", body, idempotencyKey);
  }

  // ── Sources ──────────────────────────────────────────────────────────────────

  async getSource(sourceId: string): Promise<{ data: Source }> {
    return this.request<{ data: Source }>("GET", `/sources/${sourceId}`);
  }

  async createSource(input: CreateSourceInput): Promise<{ data: Source }> {
    const { idempotencyKey, ...body } = input;
    return this.request<{ data: Source }>("POST", "/sources", body, idempotencyKey);
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────────

  async listJobs(params?: { cursor?: string; limit?: number }): Promise<PaginatedResponse<Job>> {
    const q = this.buildQuery({ cursor: params?.cursor, limit: params?.limit });
    return this.request<PaginatedResponse<Job>>("GET", `/jobs${q}`);
  }

  async getJob(jobId: string): Promise<{ data: Job }> {
    return this.request<{ data: Job }>("GET", `/jobs/${jobId}`);
  }

  async cancelJob(jobId: string): Promise<void> {
    return this.request<void>("POST", `/jobs/${jobId}/cancel`);
  }
}
