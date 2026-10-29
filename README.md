# n8n-nodes-superbotai

n8n community nodes for [SuperBot AI](https://superbotapp.ai), the AI chatbot for websites and stores.

- **SuperBot Trigger** starts a workflow when SuperBot captures a lead, a visitor starts a conversation, or a conversation is escalated to a human. It uses webhooks: when the workflow is activated, the node subscribes its webhook URL with SuperBot, and when the workflow is deactivated it removes the subscription. Deliveries are signed (`X-SuperBot-Signature`, HMAC-SHA256 of the raw body), and the node rejects unsigned or forged deliveries by default.
- **SuperBot** (also usable as an AI-agent tool):
  - Lead → Create (an existing lead with the same email is returned, not duplicated), Get Many
  - Conversation → Get Many (optionally escalated only)
  - Training Answer → Create or Update (teaches the bot a question and answer)

The nodes call the same public API as the SuperBot Zapier app (`https://superbotapp.ai/api/zapier/*`, documented at https://superbotapp.ai/docs/zapier). The package has no runtime dependencies.

## Credentials

1. In SuperBot, open **Integrations**, scroll to **API keys**, click **Create API key**.
2. Under **Used with**, choose **n8n, Make, Pipedream or my own server**. (Zapier keys can only deliver events to `hooks.zapier.com`, so the trigger would be refused.)
3. In n8n, create a **SuperBot API** credential and paste the key. n8n tests it against `GET /api/zapier/me`.

Only workspace owners and admins can create keys. Revoking a key in SuperBot also removes every webhook subscription it created.

The trigger needs an n8n instance reachable over public **https** (n8n Cloud, or a self-hosted instance with `WEBHOOK_URL` set to its public https address). SuperBot never delivers to private, loopback or internal addresses.

## Development

```bash
npm install
npm run build     # n8n-node build -> dist/
npm run lint      # n8n-node lint (n8n's community-node ESLint rules, strict mode)
npm test          # build + node:test unit tests in test/
npm run dev       # runs a local n8n with this package linked (http://localhost:5678)
```

## Publishing (owner only)

npm publishing needs the owner's npm login, so these steps are manual.

1. Create a public GitHub repo for the package (n8n verification requires a public repo that matches `repository.url` in package.json, currently `https://github.com/shaggyistaken/n8n-nodes-superbotai`), and push the contents of this folder to it:
   ```bash
   cd superbot-n8n
   git init && git add . && git commit -m "n8n-nodes-superbotai 0.1.0"
   gh repo create shaggyistaken/n8n-nodes-superbotai --public --source . --push
   ```
2. `npm login` (owner account).
3. Publish with provenance (n8n only verifies packages published from GitHub Actions with an npm provenance statement since May 1 2026). The workflow is already in `.github/workflows/publish.yml` (copied from n8n-nodes-starter); it runs on a pushed version tag like `0.1.0`.
   - One-time: the first version must exist on npm before a trusted publisher can be added, so either publish 0.1.0 once with a Granular Access Token stored as the repo secret `NPM_TOKEN`, or (preferred, if npm allows it for a new package name) on npmjs.com open the package settings → **Publish access → Trusted Publishers** → GitHub Actions, owner `shaggyistaken`, repo `n8n-nodes-superbotai`, workflow `publish.yml`.
   - Then run `npm run release` locally: it lints, builds, bumps the version, commits, tags and pushes, and the workflow publishes.
4. Check the published package with n8n's scanner: `npx @n8n/scan-community-package n8n-nodes-superbotai`.
5. Test install: in any self-hosted n8n, **Settings → Community nodes → Install** → `n8n-nodes-superbotai`. Activate a workflow with the SuperBot Trigger and confirm a test lead arrives.

## n8n verified-node submission (owner only)

Verified nodes appear in the n8n nodes panel for every user, including n8n Cloud.

1. Make sure the package meets n8n's verification guidelines: built with `@n8n/node-cli` (it is), `n8n-community-node-package` keyword, no runtime dependencies, MIT license, English UI text, README with credential setup, passes `npm run lint` and the scanner above, published with provenance. n8n may reject nodes that compete with its paid features; SuperBot does not.
2. Sign in to the **n8n Creator Portal** at https://creators.n8n.io/nodes and submit the node: package name `n8n-nodes-superbotai`, the GitHub repo URL, and a test API key for the reviewers (create a dedicated key in a test workspace, never a production key, and paste it only into the portal form).
3. n8n reviews the code and UX; reply to their feedback from the portal. Each later version is re-reviewed after `npm publish`.

## Server-side note

Before this package, `POST /api/zapier/hooks` only accepted `https://hooks.zapier.com` targets. API keys now carry a `purpose`: `zapier` (default, unchanged behaviour) or `automation` (n8n, Make, Pipedream, own server), which may subscribe any public https URL. The policy is stored on each subscription and re-checked on every delivery, and delivery always goes through `safeFetch` (DNS pinned to a public address, no redirects). See `superbot-website/src/lib/zapier/hook-provider.ts`.
