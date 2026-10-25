#!/usr/bin/env bash
# Runs the ADR-001 spike against both OpenTelemetry JS lines.
# Usage: ./matrix.sh   (rewrites node_modules; ends on the modern stack)
set -euo pipefail
cd "$(dirname "$0")"

rm_pkgs() { for p in "$@"; do pnpm remove "$p" >/dev/null 2>&1 || true; done; }
run() { echo "=== $1 ==="; shift; env "$@" pnpm vitest run 2>&1 | grep -E "Tests |×" | cut -c1-160 || true; }

echo ">>> Legacy line: @opentelemetry/api 1.9.1 + sdk-node 0.223 (SDK 2.12)"
rm_pkgs @opentelemetry/sdk-trace @opentelemetry/sdk-node @opentelemetry/sdk-trace-base
pnpm add -D @opentelemetry/api@1.9.1 @opentelemetry/sdk-node@0.223.0 >/dev/null
pnpm peers check
run "legacy / ctxkey" TOADWRIGHT_DESIGN=ctxkey
run "legacy / rootspan (expected: 2 parentage failures)" TOADWRIGHT_DESIGN=rootspan

echo ">>> Modern line: @opentelemetry/api 1.10.0 + sdk-node 0.300 (SDK 3.0)"
rm_pkgs @opentelemetry/sdk-trace-base @opentelemetry/sdk-node
pnpm add -D @opentelemetry/api@1.10.0 @opentelemetry/sdk-node@0.300.0 @opentelemetry/sdk-trace@3.0.0 >/dev/null
pnpm peers check
run "modern / ctxkey" TOADWRIGHT_DESIGN=ctxkey
run "modern / rootspan (expected: 2 parentage failures)" TOADWRIGHT_DESIGN=rootspan
