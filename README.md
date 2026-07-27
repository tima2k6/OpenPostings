# OpenPostings


## Table of Contents

- [OpenPostings](#openpostings)
- [Youtube Video](#youtube-video)
- [Diagram](#diagram)
- [Features](#features)
- [Supported ATS](#supported-ats)
- [Docs](#docs)
- [Android Install from Google PlayStore (In Beta Coming Soon...)](#android-install-from-google-playstore-in-beta-comming-soon)
- [Android Phone/Device DIRECT Install](#android-phonedevice-direct-install-easiest-setup-but-still-wip-and-may-have-some-bugs)
- [Windows Installer Setup (Windows 10/11)](#windows-installer-setup-windows-1011-easiest-setup-but-still-wip-and-may-have-some-bugs)
- [MacOS Direct Install](#macos-direct-install-there-will-never-be-a-playstore-version-as-apples-garden-wall-requires-100-soul-bucks-every-year-just-for-a-free-app-this-its-outside-of-scope-of-an-opensource-application)
- [Source Installation Setup](#source-installation-setup-best-stability--compatibility)
  - [Requirements](#requirements)
  - [Installation](#installation)
  - [Quick Start (Web)](#quick-start-web)
- [Chrome Extension](#chrome-extension-for-capturingadding-more-companies-to-your-app)
  - [Load as Unpacked Extension](#load-as-unpacked-extension)
  - [Run Backend + Extension](#run-backend--extension)
  - [Example Supported Seeded URL Patterns](#example-supported-seeded-url-patterns)
  - [Troubleshooting](#troubleshooting)
- [REST API (Summary)](#rest-api-summary)
- [MCP Apply Agent Server](#mcp-apply-agent-server)
- [Security Notes](#security-notes)

<br/>
OpenPostings is an OpenSource ATS job aggregator and application tracking app. **It pulls jobs that were posted in the last 24 hours** or that has no posted date. 

Over **110000+** companies from multiple ATSs all sourced into 1 location!

Over **THOUSANDS** fresh jobs on average **DAILY**!

## Youtube Video
[![OpenPostings Discussion](https://img.youtube.com/vi/5sVIhhwx3Yk/0.jpg)](https://www.youtube.com/watch?v=5sVIhhwx3Yk)

## Diagram (Light)
![Web UI Screenshot](README-Images/OpenPostings_Diagram_Light.png)

## Diagram (Core)
![Web UI Screenshot](README-Images/OpenPostings_Diagram_Core.png)

## Features

It combines:
- A React Native client (`Web`, `Android`, `Windows`)
- A local Node/Express API
- A local SQLite database
- An MCP apply-agent server for agent-assisted workflows


- Pulls jobs from **multiple ATS** providers into one local database.
- Filters postings by **search text, ATS, industry, region (AMER/EMEA/APAC), country, state, county, and remote mode**.
- Tracks **applied/ignored** posting state and application lifecycle status.
<br>
<img src="README-Images/apply_or_ignore.png" alt="Applications" width="25%" />
<br>
<img src="README-Images/applications.png" alt="Applications" width="70%" />
- Stores applicant profile and MCP agent settings in SQLite.
- Exposes MCP tools for **candidate selection, cover-letter drafting, and result recording.**

## Supported ATS

Current sync support includes:

- `ADP MyJobs`
- `ADP Workforce Now`
- `ApplicantAI`
- `ApplicantPro`
- `ApplyToJob`
- `Ashby`
- `BambooHR`
- `BrassRing`
- `BreezyHR`
- `CareerPlug`
- `CareerPuck`
- `CareersPage`
- `Dayforce`
- `Eightfold`
- `Fountain`
- `Freshteam`
- `Gem`
- `Getro`
- `Greenhouse`
- `Hirebridge`
- `HRMDirect`
- `iCIMS`
- `JobAps`
- `Jobvite`
- `JOIN`
- `Lever`
- `Loxo`
- `Manatal`
- `Oracle Cloud`
- `PageUp`
- `Paylocity`
- `PeopleForce`
- `PinpointHQ`
- `RecruitCRM`
- `Recruitee`
- `Rippling`
- `SageHR`
- `SAP HR Cloud`
- `Simplicant`
- `Talentlyft`
- `TalentReef`
- `Taleo`
- `Talexio`
- `Teamtailor`
- `The Applicant Manager`
- `UltiPro`
- `Workday`
- `Zoho`
- `governmentjobs`
- `smartrecruiters`
- `hibob`
- `isolved`
- `policeapp`
- `usajobs`
- `k12jobspot`
- `schoolspring`
- `calcareers`
- `calopps`
- `statejobsny`
- `PaycomOnline`
- `AgileHR`
- `Avature`
- `Comeet`
- `FactorialHR`
- `Hireology`
- `Crelate`
- `HiringPlatform`
- `Homerun`
- `JibeApply`
- `Jobs2Web`
- `Occupop`
- `PeopleAdmin`
- `Personio`
- `Recruiterflow`
- `Softgarden`
- `Trakstar`
- `UKG`
- `YCombinator`
- `Yello`
- `EdJoin`
- `Webcruiter`
- `AcademicJobsOnline`
- `Hcareers`
- `Amazon Jobs`
- `Expedia Group`
- `Microsoft Careers`
- `Apple`
- `Meta`
- `Walmart`
- `Disney`
- `Boeing`
- `prismhr`
- `silkroad`
- `paycor`
- `snaphunt`
- `dover`
- `oorwin`

<br>
<img src="README-Images/ATS_list.png" alt="Applications" width="70%" />

OVER **110000+** companies in total. All gathered from search engine data like Google and DuckDuckGo and also using subdomain searching techniques and directory searching techniques. 
<br>
<img src="README-Images/company_amount.png" alt="Applications" width="25%" />
<br>
It pulls in new job data at random from companies and stores it in the database. If the posting has lasted longer than 24 hours in the database its no longer used/deleted. 

## Docs
- Docs: https://masterjx9.github.io/OpenPostings/docs/intro

## Android Install from Google PlayStore (Easiest Setup)
If you are interested in being a beta tester follow the Google Form here:

- https://play.google.com/store/apps/details?id=com.jatonjustice.openpostings&hl=en_US

## Android Phone/Device DIRECT Install
You can download the latest app from the github releases page and run it. 

- https://github.com/Masterjx9/OpenPostings/releases/download/v2.0.1/app-release.apk

## Windows Installer Setup (Windows 10/11) (Easiest Setup But Still WIP and may have some bugs)
Download the latest installer from the github releases page and run it. It will guide you through installation and setup.
- https://github.com/Masterjx9/OpenPostings/releases/download/v2.0.1/openpostings-2.0.1-x64.msi

Choose the setup type during install:
- `Typical`: Installs the standard OpenPostings app setup (Includes the backend service worker, recommended for most users).
- `Complete`: Installs all available OpenPostings features. (Includes the backend service worker and MCP apply agent server, which may not be needed for all users).
- `Custom`: Lets you choose exactly which features to install (for example, whether to include the backend service worker and MCP apply agent server).
<img src="README-Images/windows_setup_type.png" alt="windows install setup types" width="70%" />

Once the installation is complete, you can launch OpenPostings from the start menu. 

## MacOS Direct Install (There will never be a playstore version as Apple's Garden wall requires 100 soul bucks every year just for a free app, this its outside of scope of an opensource application)
You can download the lastest app from the github releases page and run it. 

- https://github.com/Masterjx9/OpenPostings/releases/download/v2.0.1/openpostings-2.0.1-universal.dmg

## Source Installation Setup (Best Stability & Compatibility)

### Requirements

- Node.js 18+ and npm
  - https://docs.npmjs.com/downloading-and-installing-node-js-and-npm
- For Windows target: React Native Windows prerequisites
  - https://microsoft.github.io/react-native-windows/
- For Android target: Android Studio/emulator or device
  - https://developer.android.com/studio

### Installation

```powershell
cd OpenPostings
npm install
```

### Quick Start (Web)

Terminal 1:

```powershell
cd OpenPostings
npm run server
```

Terminal 2:

```powershell
cd OpenPostings
npm run web
```

Access the Web UI
- `http://localhost:8081`

Default API base URL behavior:
- Web/Windows: `http://localhost:8787`
- Android (on-device backend): `http://127.0.0.1:8787`


### You can run this Windows or Android as well!

```powershell
npm run windows (For windows)
npm run android (For Android)
```

## Chrome Extension (For Capturing/Adding more companies to your app)

This repo includes a Chrome extension at:

- `chrome-extension/openpostings-seeded-url-capture`

It captures the active tab URL and submits it to OpenPostings as a **seeded ATS company source**.  
Dynamic ATS sources are intentionally blocked.

### Load as Unpacked Extension

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `OpenPostings/chrome-extension/openpostings-seeded-url-capture`. (The folder where the chrome extension is)

### Run Backend + Extension

1. Start backend:

```powershell
cd OpenPostings
npm run server
```

NOTE: Or if you are using the Windows MSI installer version, just have your backend service set to `running`.

2. Open a seeded ATS company board URL in Chrome.
3. Open the extension popup.
4. Confirm/edit:
   - Backend API URL (default `http://localhost:8787`)
   - Source URL and company name
5. Click `Add to OpenPostings`.

### Example Supported Seeded URL Patterns

- Workday: `https://<subdomain>.wd*.myworkdayjobs.com/<companyPath>`
- Ashby: `https://jobs.ashbyhq.com/<orgSlug>`
- Greenhouse: `https://job-boards.greenhouse.io/<boardToken>` or `https://boards.greenhouse.io/<boardToken>`
- Lever: `https://jobs.lever.co/<organization>`
- iCIMS: `https://<tenant>.icims.com/jobs/search?...`
- BambooHR: `https://<tenant>.bamboohr.com/careers`
- Jobvite: `https://jobs.jobvite.com/<companySlug>/jobs`
- It works for all 80+ ATSs!

### Troubleshooting

- `Failed to fetch`:
  - Ensure backend is running at `http://localhost:8787`.
  - If backend runs elsewhere, update backend URL in the extension popup.
- `URL does not match a supported seeded ATS company source`:
  - The current page is likely not a seeded ATS company board URL.
- `Dynamic ATS URLs are not supported`:
  - Expected behavior. This extension only inserts seeded ATS company sources.


## REST API (Summary)

Core:

- `GET /health`
- `GET /sync/status`
- `POST /sync/ats` (`?wait=1` optional)
- `POST /sync/workday` (alias route)

Postings:

- `GET /postings`
- `GET /postings/filter-options`
- `POST /postings/ignore`

Applications:

- `GET /applications`
- `POST /applications`
- `PATCH /applications/:id`
- `DELETE /applications/:id`

Settings:

- `GET /settings/personal-information`
- `PUT /settings/personal-information`
- `GET /settings/mcp`
- `PUT /settings/mcp`
- `GET /settings/sync`
- `PUT /settings/sync`
- `GET /settings/export`
- `GET /extension/seeded-source/options`
- `POST /extension/seeded-source/classify`
- `POST /extension/seeded-source/upsert`

MCP helper endpoints:

- `GET /mcp/candidates`
- `POST /mcp/cover-letter-draft`
- `POST /mcp/applications/complete`

## MCP Apply Agent Server

You can have Codex/Claude/Gemini/Qwen/LLMs do the following for you:
- Get your applicantee information `get_applicant_context`
- Read your actual resume (PDF, docx, txt or md) so screening happens against your real background `get_resume` — upload it once with `POST /settings/applicant-documents` and it is stored in the database, so it stays readable even when the server runs on a different machine than your files
- List every filter value it can search on `get_filter_options`
- Find the latest relevant jobs for you. `find_posting_candidates`
- Run precision queries like "(manager OR director) AND NOT assistant, in WA, over 140k, seen in the last 3 days" `query_postings`
- Read everything stored about a shortlisted posting — description included — before opening a browser `get_posting_details`
- Mark postings as not a fit so no later run resurfaces them `ignore_posting`
- Check what has already been applied to, and by whom `list_applications`
- Apply to those jobs (As long as your LLM model has access to a browser)
- Build a dynamic cover letter for you that relates to your resume, experience and the job you are applying for. `draft_cover_letter`
- Update job application tracking for you. `record_application_result`

The intended loop is shortlist → screen → apply: read the resume once with `get_resume`,
filter with `find_posting_candidates` or `query_postings`, weigh each survivor's
`get_posting_details` description against the resume, `ignore_posting` the misses (they
stay gone across runs), apply to the rest, and `record_application_result` what happened.
`list_applications` keeps separate runs from double-applying.

`find_posting_candidates` runs the same filter engine as the app's job list, so the agent can
search on anything the app can:

| | |
|---|---|
| Text | `search` |
| Source | `ats` |
| Role | `industries` |
| Pay | `compensation_types`, `pay_periods`, `pay_min`, `pay_max` |
| Requirements | `education_levels` |
| Location | `states`, `counties`, `countries`, `regions`, `remote` |
| Listing | `sort_by`, `hide_no_date`, `limit`, `offset` |
| State | `include_applied`, `include_ignored`, `include_descriptions` |

Any filter left empty falls back to the matching preference in `Settings > MCP Settings`; pass
`use_settings=false` to search without them. Postings you have already applied to or ignored
are left out unless you ask for them, and job descriptions are omitted unless you set
`include_descriptions=true`. Call `get_filter_options` first for the valid values — an
industry key or county that is not on that list matches nothing rather than raising an error.

To turn on the MCP server so your model can interact with OpenPostings run:

```powershell
cd OpenPostings
npm run mcp:apply-agent
```

MCP server setup for your Codex (If you use a different LLM, ask it to setup an MCP setup for you):
```
[mcp_servers.openpostings-apply]
command = "node"
args = ['C:\Users\<path to where you cloned the repo>\OpenPostings\server\mcp-apply-server.js']
```


## Security Notes

This is designed for local/self-hosted usage.

- MCP credentials/settings are stored in local SQLite fields.
- If you need stricter controls, add OS-level secret storage, DB encryption-at-rest, and tighter filesystem permissions.
