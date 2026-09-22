#!/usr/bin/env node
"use strict";

/**
 * Smoke test for a running deployment.
 *
 * Hits the critical public routes and verifies the admin API enforces auth.
 * Used both in CI (post-deploy) and locally:
 *
 *   SMOKE_BASE_URL=https://consultorio-demo.example.com npm run smoke
 *   npm run smoke -- https://consultorio-demo.example.com
 *
 * Exits 0 if every check passes, 1 otherwise.
 */

const DEFAULT_BASE_URL = "https://consultorio-demo.example.com";
const baseUrl = (
  process.argv[2] ||
  process.env.SMOKE_BASE_URL ||
  DEFAULT_BASE_URL
).replace(/\/$/, "");

const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

/**
 * Each check describes one HTTP expectation against the deployment.
 * `expectStatus` may be a single number or an array of acceptable codes.
 * `expectBodyIncludes` (optional) asserts a substring is present in the body.
 */
const checks = [
  {
    name: "Health endpoint",
    path: "/health",
    expectStatus: 200,
    expectBodyIncludes: '"ok":true'
  },
  {
    name: "Landing page",
    path: "/",
    expectStatus: 200,
    expectBodyIncludes: "<html"
  },
  {
    name: "Privacy page",
    path: "/privacidade",
    expectStatus: 200
  },
  {
    name: "Public content API",
    path: "/api/public/content",
    expectStatus: 200,
    expectBodyIncludes: '"ok":true'
  },
  {
    name: "Admin login page",
    path: "/admin/login",
    expectStatus: 200
  },
  {
    name: "Admin API requires auth",
    path: "/api/admin/leads",
    expectStatus: 401
  }
];

function statusMatches(actual, expected) {
  return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
}

async function runCheck(check) {
  const url = `${baseUrl}${check.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "*/*" },
      signal: controller.signal
    });
    const body = await response.text();
    const elapsed = Date.now() - startedAt;

    if (!statusMatches(response.status, check.expectStatus)) {
      return {
        ok: false,
        name: check.name,
        message: `esperava HTTP ${check.expectStatus}, recebeu ${response.status} (${url})`,
        elapsed
      };
    }

    if (check.expectBodyIncludes && !body.includes(check.expectBodyIncludes)) {
      return {
        ok: false,
        name: check.name,
        message: `corpo não contém "${check.expectBodyIncludes}" (${url})`,
        elapsed
      };
    }

    return { ok: true, name: check.name, message: `HTTP ${response.status}`, elapsed };
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    const reason = error.name === "AbortError" ? `timeout após ${REQUEST_TIMEOUT_MS}ms` : error.message;
    return { ok: false, name: check.name, message: `${reason} (${url})`, elapsed };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`Smoke test → ${baseUrl}\n`);

  const results = [];
  for (const check of checks) {
    // Sequential keeps output readable and avoids hammering the deployment.
    // eslint-disable-next-line no-await-in-loop
    const result = await runCheck(check);
    results.push(result);
    const icon = result.ok ? "✓" : "✗";
    console.log(`  ${icon} ${result.name} — ${result.message} [${result.elapsed}ms]`);
  }

  const failures = results.filter((result) => !result.ok);
  console.log("");

  if (failures.length) {
    console.error(`Smoke test FALHOU: ${failures.length}/${results.length} verificação(ões) com erro.`);
    process.exit(1);
  }

  console.log(`Smoke test OK: ${results.length}/${results.length} verificações passaram.`);
}

main().catch((error) => {
  console.error("Smoke test abortado por erro inesperado:", error);
  process.exit(1);
});
