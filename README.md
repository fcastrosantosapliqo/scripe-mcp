# scripe-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for the [Scripe](https://scripe.io) API. Lets you manage posts, notes, projects, and async jobs directly from Claude Code or any MCP-compatible client.

## Requirements

- Node.js 18+
- A Scripe API key (Advanced or Business plan)

## Installation

```bash
git clone https://github.com/fcastrosantosapliqo/scripe-mcp.git
cd scripe-mcp
npm install
npm run build
```

## Configuration

### Claude Code

Add the following to your `~/.claude/claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "scripe": {
      "command": "node",
      "args": ["/absolute/path/to/scripe-mcp/dist/index.js"],
      "env": {
        "SCRIPE_API_KEY": "scripe_sk_live_..."
      }
    }
  }
}
```

### Other MCP clients

Run the server directly, passing your API key as an environment variable:

```bash
SCRIPE_API_KEY=scripe_sk_live_... node dist/index.js
```

The server communicates over **stdio**, which is the standard transport for MCP.

## Available tools

### Workspace & projects

| Tool | Description |
|---|---|
| `scripe_get_workspace` | Current workspace and principal info |
| `scripe_list_projects` | Paginated list of all projects |
| `scripe_get_project` | Single project by ID |

### Posts

| Tool | Description |
|---|---|
| `scripe_list_posts` | List posts for a project; filter by status and/or date range |
| `scripe_get_post` | Single post by ID |
| `scripe_create_post` | Create a draft or scheduled post |
| `scripe_generate_post` | AI-generate a post from raw text or a note (async — returns a job) |

**Post statuses:** `waitingProcessing` · `draft` · `waitingApproval` · `approved` · `rejected` · `scheduled` · `published` · `suggested`

### Notes

| Tool | Description |
|---|---|
| `scripe_list_notes` | List notes for a project; filter by folder and/or date range |
| `scripe_get_note` | Single note by ID |
| `scripe_create_note` | Create a note (also queues a content slot) |

### Sources

| Tool | Description |
|---|---|
| `scripe_get_source` | Read a source/transcription (truncated to 2,000 chars) |
| `scripe_create_source` | Push a text transcript into Scripe as a source |

### Async jobs

| Tool | Description |
|---|---|
| `scripe_list_jobs` | Paginated list of async jobs |
| `scripe_get_job` | Single job with current status and progress |
| `scripe_cancel_job` | Cancel a queued job |

### Health

| Tool | Description |
|---|---|
| `scripe_health` | Unauthenticated liveness probe |

## Typical workflows

**Draft a post from scratch**
```
1. scripe_list_projects          → pick a projectId
2. scripe_create_post            → projectId + content + title
```

**AI-generate a post from notes**
```
1. scripe_list_notes             → find the noteId
2. scripe_generate_post          → noteId + projectId → returns jobId
3. scripe_get_job (poll)         → wait for status DONE
4. scripe_list_posts             → retrieve the generated draft
```

**Push a transcript and generate a post**
```
1. scripe_create_source          → content (transcript text)
2. scripe_generate_post          → text (transcript) + projectId → jobId
3. scripe_get_job (poll)         → wait for status DONE
```

## Development

```bash
npm run dev    # run from source with tsx (no build step)
npm run build  # compile to dist/
npm start      # run compiled output
```

## API reference

Full Scripe API documentation: [apidocs.scripe.io](https://apidocs.scripe.io/api/v1)

## License

ISC
