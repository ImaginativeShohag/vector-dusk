#!/bin/sh
# Use a locally selected CLI without loading personal model/MCP configuration.
if [ -z "${VECTOR_DUSK_CODEX_BIN:-}" ]; then
  printf '%s\n' 'Codex CLI is not selected. In your terminal, check codex --version, then run:' 'export VECTOR_DUSK_CODEX_BIN="$(command -v codex)"' 'Run npm run eval or npm run eval:workflow in that same terminal.' >&2
  exit 1
fi
case "$1" in
  exec) set -- "$@" --ignore-user-config ;;
esac
exec "$VECTOR_DUSK_CODEX_BIN" "$@"
