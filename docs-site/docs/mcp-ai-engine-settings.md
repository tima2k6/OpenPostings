---
sidebar_position: 7
title: MCP / AI Engine Settings
description: Configure the MCP application agent, safety controls, credentials, and targeting preferences.
---

## Where to configure

Open:

- `Settings > MCP Settings`

This page controls the OpenPostings MCP application agent (AI service engine behavior).

## Installer dependency

For MSI installs, MCP runtime is included when you choose:

- `Complete`, or
- `Custom` with `MCP Apply Agent Server (AI Service Engine)` enabled

## Core safety toggles

- `Enable MCP application agent`: master switch for MCP candidate/apply endpoints.
- `Dry run only (do not submit)`: records payload preview without committing applications.
- `Require final user approval`: blocks commit unless explicit approval is provided.

![MCP settings toggles](/MCP_settings_1.png)

## Agent identity and login fields

- `Preferred agent label`
- `Agent login email`
- `Agent login password`
- `MFA/login notes`

![Agent identity fields](/MCP_settings_2.png)

Use a dedicated mailbox account for automation workflows.

## Throughput and targeting fields

- `Max applications per run`
- `Preferred search text`
- `Preferred remote filter`
- `Preferred Industries`
- `Preferred Regions`
- `Preferred Countries`
- `Preferred States`
- `Preferred Counties`
- `Agent instructions`

![Agent instructions](/MCP_settings_3.png)

## Save behavior

When MCP settings are saved:

- Settings are persisted through `/settings/mcp`.
- OpenPostings runs a preview candidate query.
- UI confirms with match count: `MCP settings saved. <count> candidate postings currently match.`

## How preferences reach the agent

The targeting fields above are defaults, not limits. `find_posting_candidates` accepts every
filter the job list offers — `search`, `ats`, `industries`, `compensation_types`,
`pay_periods`, `pay_min`, `pay_max`, `education_levels`, `states`, `counties`, `countries`,
`regions`, `remote`, `sort_by`, `hide_no_date`, `limit`, `offset`, `include_applied`,
`include_ignored`, `include_descriptions` — and a filter the agent passes explicitly replaces
the saved preference for that field only. Passing `use_settings=false` ignores the saved
preferences entirely.

`get_filter_options` returns the accepted values for each list filter: industry keys, ATS
names, states, counties (pass `states` to scope them), ISO country codes, regions, education
levels, compensation types and pay periods. Values outside those lists match nothing rather
than reporting an error, so an agent should read this before filtering.

## The screening workflow

Four tools carry the loop between shortlisting and applying:

- `query_postings` — precision queries the candidate filters cannot phrase: `title_any`
  ORs its terms, groups AND together, `*_none` excludes, plus pay bounds, `seen_days` /
  `found_days` recency, and `visibility` to look under the hidden flag. Ignores saved
  preferences and the freshness window by design.
- `get_posting_details` — everything stored about named postings, full description
  included, so fit is decided from the database before a browser session is spent.
- `ignore_posting` — marks a posting not-a-fit (with a reason shown in the app), which
  removes it from every future candidate query. Reversible with `ignored=false`.
- `list_applications` — application history with attribution, for dedupe across runs.

The `dry_run_only` and `require_final_approval` toggles gate only the apply/record path;
the screening tools are read-or-tracking-state and run whenever the agent is enabled.

## API endpoints tied to this page

- `GET /settings/mcp`
- `PUT /settings/mcp`
- `GET /mcp/candidates`
- `POST /mcp/cover-letter-draft`
- `POST /mcp/applications/complete`

## Security note

MCP settings, including credentials, are stored in local SQLite fields by default. Use OS-level hardening if you need stronger controls.
