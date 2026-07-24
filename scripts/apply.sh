#!/usr/bin/env bash
# Apply local code changes to the running OpenPostings services.
#
# Figures out which services are running stale code by comparing file mtimes
# against each systemd unit's start time, verifies the code compiles and tests
# pass, then restarts only the services that actually need it.
#
# Usage:
#   scripts/apply.sh                # verify, then restart whatever is stale
#   scripts/apply.sh status         # report only; change nothing
#   scripts/apply.sh server mcp     # restart named targets (implies --force)
#   scripts/apply.sh --force        # restart even if nothing looks stale
#   scripts/apply.sh --no-verify    # skip syntax checks and tests
#   scripts/apply.sh --yes          # don't prompt when a sync is in flight

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

API_URL="http://localhost:8787"
ALL_TARGETS=(server web mcp)

FORCE=0
VERIFY=1
ASSUME_YES=0
STATUS_ONLY=0
REQUESTED=()

if [[ -t 1 ]]; then
  B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; N=$'\033[0m'
else
  B=""; DIM=""; R=""; G=""; Y=""; N=""
fi

info() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "${Y}$*${N}"; }
fail() { printf '%s\n' "${R}$*${N}" >&2; }
ok()   { printf '%s\n' "${G}$*${N}"; }

for arg in "$@"; do
  case "$arg" in
    status)            STATUS_ONLY=1 ;;
    --force|-f)        FORCE=1 ;;
    --no-verify)       VERIFY=0 ;;
    --yes|-y)          ASSUME_YES=1 ;;
    server|web|mcp)    REQUESTED+=("$arg") ;;
    -h|--help)         sed -n '2,15p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) fail "Unknown argument: $arg (try --help)"; exit 2 ;;
  esac
done

unit_for() { printf 'openpostings-%s' "$1"; }

# Paths whose modification means the given target is running stale code.
# Only existing paths are emitted so find doesn't error on absent dirs.
watch_paths_for() {
  local target="$1" candidates=()
  case "$target" in
    server) candidates=(server package.json) ;;
    mcp)    candidates=(server/mcp-apply-server.js package.json) ;;
    web)    candidates=(App.js src app.json babel.config.js metro.config.js package.json) ;;
  esac
  local p
  for p in "${candidates[@]}"; do
    [[ -e "$p" ]] && printf '%s\n' "$p"
  done
}

unit_start_epoch() {
  local ts
  ts="$(systemctl show "$(unit_for "$1")" -p ActiveEnterTimestamp --value 2>/dev/null)"
  [[ -z "$ts" ]] && return 1
  date -d "$ts" +%s 2>/dev/null
}

# Echoes the first file found newer than the unit's start time, if any.
stale_file_for() {
  local target="$1" start_epoch prune=()
  start_epoch="$(unit_start_epoch "$target")" || return 1
  [[ -z "$start_epoch" ]] && return 1

  # The MCP server is standalone; changes to the rest of server/ don't affect it,
  # and its own file shouldn't force an API-server restart.
  [[ "$target" == server ]] && prune=(-not -name mcp-apply-server.js)

  mapfile -t paths < <(watch_paths_for "$target")
  [[ ${#paths[@]} -eq 0 ]] && return 1

  find "${paths[@]}" -type f \
    -not -path '*/node_modules/*' -not -path '*/.git/*' \
    "${prune[@]}" \
    -newermt "@$start_epoch" -print -quit 2>/dev/null
}

verify_target() {
  local target="$1"
  case "$target" in
    server)
      node --check server/index.js || return 1
      [[ -f server/tests/location-state-filter.test.js ]] &&
        { node server/tests/location-state-filter.test.js >/dev/null || return 1; }
      [[ -f server/tests/seeded-source-parser.test.js ]] &&
        { node server/tests/seeded-source-parser.test.js >/dev/null || return 1; }
      ;;
    mcp)
      node --check server/mcp-apply-server.js || return 1
      ;;
    web)
      # App.js is JSX, so node --check can't parse it; use the project's babel config.
      node -e '
        const babel = require("@babel/core");
        const fs = require("fs");
        babel.parseSync(fs.readFileSync("App.js", "utf8"), {
          filename: "App.js", presets: ["babel-preset-expo"]
        });
      ' || return 1
      ;;
  esac
  return 0
}

sync_progress_line() {
  curl -fsS --max-time 5 "$API_URL/sync/status" 2>/dev/null | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(d);
        if (!j.running || !j.progress) return;
        const p = j.progress;
        process.stdout.write(`${p.current}/${p.total} targets, ${p.total_collected} postings collected`);
      } catch {}
    });
  ' 2>/dev/null
}

wait_for_api() {
  local deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    if curl -fsS -o /dev/null --max-time 5 "$API_URL/sync/status" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

report_status() {
  local target unit active enabled stale mem
  printf '%s\n' "${B}service          state             memory      code${N}"
  for target in "${ALL_TARGETS[@]}"; do
    unit="$(unit_for "$target")"
    active="$(systemctl is-active "$unit" 2>/dev/null)"
    enabled="$(systemctl is-enabled "$unit" 2>/dev/null)"
    mem="$(systemctl show "$unit" -p MemoryCurrent --value 2>/dev/null)"
    if [[ "$mem" =~ ^[0-9]+$ ]] && (( mem > 0 )); then
      mem="$(( mem / 1024 / 1024 ))M"
    else
      mem="-"
    fi

    if [[ "$active" != active ]]; then
      stale="${DIM}not running${N}"
    elif stale_file_for "$target" | grep -q .; then
      stale="${Y}stale${N}"
    else
      stale="${G}current${N}"
    fi
    printf '%-16s %-17s %-11s %b\n' "$target" "$active/$enabled" "$mem" "$stale"
  done

  local progress
  progress="$(sync_progress_line)"
  if [[ -n "$progress" ]]; then
    info ""
    info "${B}sync in progress:${N} $progress"
  fi
}

restart_target() {
  local target="$1" unit
  unit="$(unit_for "$target")"

  if [[ "$(systemctl is-active "$unit" 2>/dev/null)" != active ]]; then
    if [[ "$target" == mcp ]]; then
      info "  ${DIM}mcp is not running as a service (stdio servers are spawned per client);${N}"
      info "  ${DIM}your edits apply the next time a client connects. Nothing to restart.${N}"
    else
      warn "  $target is not running; starting it"
      systemctl start "$unit" || { fail "  failed to start $unit"; return 1; }
    fi
    return 0
  fi

  info "  restarting $unit"
  systemctl restart "$unit" || { fail "  failed to restart $unit"; return 1; }

  if [[ "$target" == server ]]; then
    if wait_for_api; then
      ok "  api healthy"
    else
      fail "  api did not become healthy within 45s — check: journalctl -u $unit -n 40"
      return 1
    fi
  fi
  return 0
}

if (( STATUS_ONLY )); then
  report_status
  exit 0
fi

# Decide targets: explicit list wins, otherwise everything that looks stale.
targets=()
if (( ${#REQUESTED[@]} > 0 )); then
  targets=("${REQUESTED[@]}")
  FORCE=1
else
  for t in "${ALL_TARGETS[@]}"; do
    changed="$(stale_file_for "$t")"
    if [[ -n "$changed" ]]; then
      info "$t: changed ${DIM}(${changed})${N}"
      targets+=("$t")
    fi
  done
fi

if [[ ${#targets[@]} -eq 0 ]]; then
  if (( FORCE )); then
    targets=("${ALL_TARGETS[@]}")
  else
    ok "Everything is already running current code. Nothing to do."
    info "${DIM}(use --force to restart anyway, or 'status' for details)${N}"
    exit 0
  fi
fi

# Metro's file watcher does not fire under this deployment (the unit sets CI=1,
# which disables Expo's watch mode), so frontend edits are only picked up when
# the bundler is restarted. Do not assume hot reload will apply them.

if (( VERIFY )); then
  info ""
  info "${B}Verifying${N}"
  for t in "${targets[@]}"; do
    printf '  %-8s' "$t"
    if verify_target "$t"; then
      ok "ok"
    else
      fail "FAILED"
      fail ""
      fail "Refusing to restart — that would put broken code into a running service."
      exit 1
    fi
  done
fi

# Restarting the API server aborts an in-flight sync. It resumes from a freshly
# shuffled target list rather than where it stopped, so warn before throwing
# away progress.
if [[ " ${targets[*]} " == *" server "* ]] && (( ! ASSUME_YES )); then
  progress="$(sync_progress_line)"
  if [[ -n "$progress" ]]; then
    info ""
    warn "A sync is in progress: $progress"
    warn "Restarting the API server aborts it. Postings already saved are kept, but"
    warn "the pass restarts from a reshuffled target list rather than resuming."
    if [[ -t 0 ]]; then
      read -r -p "Restart anyway? [y/N] " reply
      [[ "$reply" =~ ^[Yy]$ ]] || { info "Aborted."; exit 130; }
    else
      fail "Refusing to abort a running sync without confirmation (pass --yes to override)."
      exit 1
    fi
  fi
fi

info ""
info "${B}Applying${N}"
failed=0
for t in "${targets[@]}"; do
  restart_target "$t" || failed=1
done

info ""
if (( failed )); then
  fail "Finished with errors."
  report_status
  exit 1
fi
ok "Done."
report_status
