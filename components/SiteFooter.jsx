// Outline-style icon (Feather Icons' "linkedin", MIT licensed), not the
// official filled brand badge — a quiet credit line calls for a
// monochrome mark that follows the page's own palette via currentColor,
// not LinkedIn's brand blue.
function LinkedInIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="footnote">
        This site shows real auction results from{" "}
        <a
          href="https://www.semopx.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="external-link"
        >
          SEMOpx
        </a>
        , not an estimate or a forecast. Prices are pulled and converted
        automatically, so treat the figures as informational. Don&rsquo;t use
        this site as the sole basis for switching tariff, timing large energy
        use, or any financial decision.
      </p>
      <p className="footnote">
        Turning on &ldquo;Show provisional prices&rdquo; shows figures sourced from an
        undocumented SEMOpx feed, not yet formally published as an official
        result. They&rsquo;re real auction data, not an estimate, but per
        SEMOpx&rsquo;s own erroneous bid correction process, a provisional figure
        could still be revised before the official one lands &mdash; treat it as
        informational only, more so than the confirmed figures above it.
      </p>
      <p className="attribution">
        Created and developed by Colin Tomb
        <a
          href="https://www.linkedin.com/in/colintomb"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Colin Tomb on LinkedIn"
          className="linkedin-link"
        >
          <LinkedInIcon />
        </a>
      </p>
    </footer>
  );
}
