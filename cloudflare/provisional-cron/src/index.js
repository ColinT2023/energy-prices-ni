/**
 * Cloudflare Worker Cron Trigger — replaces GitHub's own `schedule:`
 * trigger for BOTH of this repo's ingestion workflows ("Ingest NI
 * prices" / ingest.yml, and "Ingest NI provisional prices" /
 * ingest-provisional.yml). Originally built for the provisional
 * workflow alone; extended to also cover the official one once the same
 * schedule-trigger drop was worth fixing there too — one Worker, one
 * secret, two dispatch calls per firing, not a second Worker.
 *
 * Why this exists: measured directly this session (see each workflow
 * file's own comment and the main README), GitHub's schedule trigger
 * was dropping roughly half — later measured closer to 80% — of these
 * workflows' 15-minute-interval cron triggers under load. That's a
 * documented GitHub Actions limitation ("if the load is sufficiently
 * high enough, some queued jobs may be dropped"), not something fixable
 * from inside a workflow file. `workflow_dispatch` (the manual/API
 * trigger) isn't subject to the same scheduler queue, so calling it
 * from an external, independent scheduler sidesteps the drop entirely
 * rather than trying to outguess it with a tighter interval.
 *
 * Same GITHUB_DISPATCH_TOKEN for both calls — GitHub's Actions
 * permission model (both classic PAT `workflow` scope and fine-grained
 * PAT `actions: read and write`) is granted per-repository, not per
 * workflow file, so one token already covers every workflow_dispatch
 * call in this repo. No second secret to provision.
 *
 * Deliberately minimal: one POST per workflow per firing, no retry
 * loop. A dropped or failed call here just means one missed dispatch —
 * the same already-accepted risk as a dropped GitHub-native trigger,
 * and both workflows' own designs tolerate a late run cheaply (the
 * provisional one via its coverage-skip check, nothing_left_to_poll —
 * see scripts/provisional_common.py; the official one via its
 * watermark-based incremental sync, which just picks up wherever it
 * left off). Not worth the added complexity of a retry/backoff
 * mechanism for a scheduler that fires again in 5 minutes regardless.
 * The two dispatches are independent of each other too — one failing
 * (network error, bad token, etc.) doesn't block or skip the other.
 */

const OWNER = "ColinT2023";
const REPO = "energy-prices-ni";
const REF = "main";
const WORKFLOW_FILES = ["ingest-provisional.yml", "ingest.yml"];

function dispatchUrl(workflowFile) {
  return `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflowFile}/dispatches`;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchAll(env));
  },
};

async function dispatchAll(env) {
  // Sequential, not Promise.all — not for correctness (the two calls are
  // genuinely independent either way), just so each dispatch's own log
  // line finishes printing before the next one starts, easier to read
  // in `wrangler tail` than interleaved output from two concurrent
  // requests logging at once.
  const results = [];
  for (const workflowFile of WORKFLOW_FILES) {
    results.push(await dispatchWorkflow(env, workflowFile));
  }
  return results;
}

async function dispatchWorkflow(env, workflowFile) {
  // Read from the Cloudflare secret binding only — never a literal here,
  // never in wrangler.toml (which is committed to git), and never
  // interpolated into a log line below. Set via
  // `wrangler secret put GITHUB_DISPATCH_TOKEN`, not the [vars] table.
  const token = env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    console.error("GITHUB_DISPATCH_TOKEN is not set — check the Worker's secret bindings.");
    return { workflowFile, ok: false, reason: "missing_token" };
  }

  let response;
  try {
    response = await fetch(dispatchUrl(workflowFile), {
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
    console.error(`workflow_dispatch request failed for ${workflowFile}:`, error.message);
    return { workflowFile, ok: false, reason: "network_error", detail: error.message };
  }

  // A successful dispatch is 204 No Content, no response body to read.
  if (response.ok) {
    console.log(`Dispatched ${workflowFile} @ ${REF} — ${response.status}`);
    return { workflowFile, ok: true, status: response.status };
  }

  // GitHub's own error body (rate limit, bad ref, revoked token, etc.)
  // never contains the request's own bearer token back — safe to log in
  // full for debugging via `wrangler tail`.
  const body = await response.text();
  console.error(`workflow_dispatch failed for ${workflowFile} — ${response.status}: ${body}`);
  return { workflowFile, ok: false, status: response.status, detail: body };
}
