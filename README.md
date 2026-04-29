# ClankerMails plugin for OpenClaw

Give your OpenClaw agent a real email address. This plugin exposes the [ClankerMails](https://clankermails.com) REST API as agent tools so your bot can create inboxes, read incoming mail, and manage messages directly.

## What it does

After installing, the agent gets these tools:

- `clankermails_list_inboxes` -- list all inboxes on your account
- `clankermails_create_inbox` -- create `mybot@clankermails.com` (or `@inboxbot.email`)
- `clankermails_get_inbox` -- get a specific inbox
- `clankermails_delete_inbox` -- remove an inbox and its messages
- `clankermails_list_messages` -- list messages in an inbox (with `unread_only` filter and cursor pagination)
- `clankermails_read_message` -- get full message content (body, headers, attachment metadata)
- `clankermails_mark_read` / `clankermails_mark_unread`
- `clankermails_delete_message`
- `clankermails_check_alerts` -- pull pending new-mail notifications from the background watcher

### New mail alerts

There are three notification surfaces, in order of immediacy:

**1. Real-time webhook (best)**
Point a ClankerMails inbox `webhook_url` at `https://<your-openclaw-host>/clankermails/webhook` and put the inbox's `webhook_secret` in plugin config under `webhookSecret`. Mail is pushed the moment it arrives.

**2. Background polling (default)**
Polls every `pollIntervalSeconds` (default 60). Works without exposing OpenClaw to the public internet.

**3. Slash command**
The user can type `/clankermails check` in their channel any time to drain pending alerts.

Alerts get injected into the agent's next prompt:

```
You have new email at the following inboxes:
  - mybot@clankermails.com: 3 new messages ("New PR: Fix auth", "Payment $49", "TypeError in worker.ts")
Use clankermails_list_messages or clankermails_read_message to view them.
```

Alerts are debounced -- by default, the same inbox won't generate more than one alert per 5 minutes, no matter how much mail arrives. Tune via `debounceSeconds`.

### Slash commands

Users can interact with ClankerMails directly without going through the agent:

- `/clankermails check` -- show pending new-mail alerts
- `/clankermails inboxes` -- list all inboxes
- `/clankermails recent <inbox-id-or-address>` -- last 10 messages
- `/clankermails read <message-id>` -- print a message's content
- `/clankermails help` -- show usage

## Install

Get an API key from [clankermails.com/dashboard/api-keys](https://clankermails.com/dashboard/api-keys), then install the plugin:

```bash
openclaw plugins install clawhub:@lambda-symbolics/openclaw-clankermails
```

Configure it in your OpenClaw config:

```json
{
  "plugins": {
    "clankermails": {
      "apiKey": "cm_live_...",
      "pollIntervalSeconds": 60,
      "debounceSeconds": 300,
      "inboxesToWatch": "all"
    }
  },
  "tools": {
    "allow": ["clankermails"]
  }
}
```

Config options:

| Field | Default | Purpose |
|---|---|---|
| `apiKey` | (required) | Your ClankerMails API key |
| `baseUrl` | `https://clankermails.com` | Override for self-hosted instances |
| `pollIntervalSeconds` | `60` | How often the background watcher checks for new mail |
| `debounceSeconds` | `300` | Minimum gap between alerts for the same inbox |
| `inboxesToWatch` | `"all"` | Restrict alerts to specific inbox IDs/addresses |

## Pricing

ClankerMails has a free Sandbox tier (1 inbox, 50 messages/month) and paid tiers from $9/month. See [clankermails.com/#pricing](https://clankermails.com/#pricing).

## Use cases

- Bot subscribes to newsletters and summarizes them
- Bot receives notifications from GitHub, Stripe, Sentry and acts on them
- Bot collects confirmation emails and extracts data
- Bot processes approval requests via email
- Forward everything to your personal inbox while the bot processes it

## Development

```bash
npm install
```

The plugin is a single TypeScript module that talks to the ClankerMails REST API. Source is in `index.ts` and `src/`.

## License

MIT, by [Lambda Symbolics OÜ](https://www.lambda-symbolics.com).
