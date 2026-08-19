# higgsfield-mcp-server

Remote MCP server that lets Claude generate images and videos through the
[Higgsfield AI](https://higgsfield.ai) API — photorealistic photos (Soul),
reference-guided images (Popcorn), and video (Google Veo 3.1, Kling, ByteDance
Seedance) — directly from chat.

## Tools exposed

| Tool | What it does |
|---|---|
| `higgsfield_generate_photo` | Text-to-image, photorealistic (Soul/Standard) |
| `higgsfield_generate_image_with_references` | Text-to-image with up to 8 reference photos (Popcorn/Auto) |
| `higgsfield_generate_video` | Text/image/frame/reference-to-video via Google Veo 3.1 |
| `higgsfield_generate_video_kling` | Cinematic video via Kling v2.1 / v2.5 |
| `higgsfield_generate_video_seedance` | Fast/cheap video via ByteDance Seedance |
| `higgsfield_check_status` | Poll a generation job until it's done |
| `higgsfield_cancel_request` | Cancel a queued job |
| `higgsfield_list_models` | List every available endpoint (incl. ones only reachable via raw_request) |
| `higgsfield_raw_request` | Call any other Higgsfield endpoint (Soul character/reference, FLUX Kontext, MiniMax Hailuo, DOP) |

All generation tools are asynchronous: they return a `request_id` immediately;
call `higgsfield_check_status` (Claude will do this automatically) until the
job is `completed`.

## 1. Get your Higgsfield API keys

1. Go to https://cloud.higgsfield.ai and sign in.
2. Create an API key (you did this already if you're reading this after
   asking Claude for help) — you get an **API Key ID** and an **API Key
   Secret**. Copy both, they're shown only once.

## 2. Deploy this server (free tier works)

You need somewhere that keeps a Node process running 24/7 and reachable over
HTTPS. Two free options that need no credit card for a small server like this:

### Option A: Render.com

1. Push this folder to a new GitHub repository (private is fine).
2. On https://render.com → **New +** → **Web Service** → connect that repo.
3. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Under **Environment**, add these three variables:
   - `HF_API_KEY_ID` = your Higgsfield API Key ID
   - `HF_API_KEY_SECRET` = your Higgsfield API Key Secret
   - `MCP_ACCESS_TOKEN` = any long random string you make up (e.g. run
     `openssl rand -hex 32` locally, or just mash the keyboard for 40+
     characters) — this is the password Claude will use to talk to your
     server, so nobody else can spend your Higgsfield credits.
5. Deploy. Render gives you a URL like `https://higgsfield-mcp-server.onrender.com`.
   Your MCP endpoint is that URL + `/mcp`, e.g.
   `https://higgsfield-mcp-server.onrender.com/mcp`.

Note: Render's free web services sleep after inactivity and take a few
seconds to wake up on the next request — fine for occasional use.

### Option B: Railway.app

Same idea: new project from this GitHub repo, set the same three environment
variables, Railway auto-detects `npm start`. You get a URL like
`https://higgsfield-mcp-server-production.up.railway.app`, endpoint is that +
`/mcp`.

## 3. Add it to Claude as a custom connector

In Claude (claude.ai / desktop app) → Settings → Connectors → **Add custom
connector**:

- **Name**: Higgsfield
- **URL**: `https://<your-deployed-url>/mcp`
- **Authentication**: Bearer token → paste the `MCP_ACCESS_TOKEN` value you
  set in step 2.

Enable it for your chat, and Claude will be able to call the tools above.

## Local testing (optional)

```bash
cp .env.example .env   # fill in real values
npm install
npm start
```

The server listens on `http://localhost:3000/mcp` (or `$PORT`).

## Security notes

- `HF_API_KEY_ID` / `HF_API_KEY_SECRET` give full access to your Higgsfield
  account and billing. They live only in the host's environment variables —
  never commit them, never put them in the URL.
- `MCP_ACCESS_TOKEN` is what stops a random person who finds your server URL
  from generating content on your Higgsfield credits. Treat it like a
  password.
- Every generation call spends Higgsfield credits per your plan's pricing.
