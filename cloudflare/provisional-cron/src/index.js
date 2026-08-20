/**
 * Cloudflare Worker Cron Trigger — replaces GitHub's own `schedule:`
 * trigger for the "Ingest NI provisional prices" workflow specifically.
 *
 * Why this exists: measured directly this session (see
 * .github/workflows/ingest-provisional.yml's own comment and the main
 * README), GitHub's schedule trigger was dropping roughly half — later
 * measured closer to 80% — of this workflow's 15-minute-interval cron
 * triggers under load. That's a documented GitHub Actions limitation ("if the
 * load is sufficiently high enough, some queued jobs may be dropped"),
 * not something fixable from inside the workflow file. `workflow_dispatch`
 * (the manual/API trigger) isn't subject to the same scheduler queue, so
 * calling it from an external, independent scheduler sidesteps the drop
 * entirely rather than trying to outguess it with a tighter interval.
 *
 * Deliberately minimal: one POST per firing, no retry loop. A dropped or
 * failed call here just means one missed dispatch — the same
 * already-accepted risk as a dropped GitHub-native trigger, and the
 * workflow's own coverage-skip check (nothing_left_to_poll, see
 * scripts/provisional_common.py) means a slightly-late run is cheap and
 * harmless, never a correctness problem. Not worth the added complexity
 * of a retry/backoff mechanism for a scheduler that fires again in 5
 * minutes regardless.
 */

const OWNER = "ColinT2023";
const REPO = "energy-prices-ni";
const WORKFLOW_FILE = "ingest-provisional.yml";
const REF = "main";

const DISPATCH_URL = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchWorkflow(env));
  },
};

async function dispatchWorkflow(env) {
  // Read from the Cloudflare secret binding only — never a literal here,
  // never in wrangler.toml (which is committed to git), and never
  // interpolated into a log line below. Set via
  // `wrangler secret put GITHUB_DISPATCH_TOKEN`, not the [vars] table.
  const token = env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    console.error("GITHUB_DISPATCH_TOKEN is not set — check the Worker's secret bindings.");
    return { ok: false, reason: "missing_token" };
  }

  let response;
  try {
    response = await fetch(DISPATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        // Required by GitHub's API — any identifying value works, this
        // just names what's calling it for GitHub's own request logs.
        "User-Agent": "ni-provisional-cron-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: REF }),
    });
  } catch (error) {
    // Network-level failure (DNS, timeout, etc.) — the error object
    // itself never contains the token, so logging it plainly is safe.
    console.error("workflow_dispatch request failed:", error.message);
    return { ok: false, reason: "network_error", detail: error.message };
  }

  // A successful dispatch is 204 No Content, no response body to read.
  if (response.ok) {
    console.log(`Dispatched ${WORKFLOW_FILE} @ ${REF} — ${response.status}`);
    return { ok: true, status: response.status };
  }

  // GitHub's own error body (rate limit, bad ref, revoked token, etc.)
  // never contains the request's own bearer token back — safe to log in
  // full for debugging via `wrangler tail`.
  const body = await response.text();
  console.error(`workflow_dispatch failed — ${response.status}: ${body}`);
  return { ok: false, status: response.status, detail: body };
}
