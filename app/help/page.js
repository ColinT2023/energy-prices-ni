import { BAND_EXPLANATION, PROVISIONAL_EXPLANATION, TYPICAL_PUBLISH_TIME } from "../../lib/priceSeries";
import DataCoverageNote from "../../components/DataCoverageNote";

export const metadata = {
  title: "Help — NI Energy Prices",
  description: "How the SEM electricity market and its auctions work, and what the numbers on this site mean.",
};

// Expands on BAND_EXPLANATION's one-line summary (shared with the Ring's
// tooltip and the Excel export, so kept terse there) with the statistical
// concept it's actually using — this page is the one place that can
// afford the fuller explanation.
const TERCILE_EXPLANATION_PARAGRAPHS = [
  "A tercile is one of three equal-sized groups you get by sorting a set of numbers from lowest to highest and splitting them into three parts. Picture sorting every runner in a race by finishing time and dividing them into three even groups, the fastest third, the middle third, and the slowest third. Each of those groups is a tercile.",
  "We use terciles here because the banding always needs exactly three labels, low, typical, and peak. Splitting into terciles guarantees each label captures a genuine third of the recent prices, whether the week's been calm or volatile, rather than assuming prices are spread out the same way every week.",
];

// Deliberately hypothetical throughout ("say", "might show", "would then
// be") rather than a real historical reading, and rendered under its own
// small "Example figures" label (same visual language as the control-
// group labels above the Chart/Date range toggles) plus italics (the
// same treatment already used sitewide for an auxiliary note — see
// .chart-provisional-note) — two independent signals, on top of the
// wording itself, that these are illustrative numbers, not an actual
// past day's prices.
const TERCILE_WORKED_EXAMPLE =
  "For example, say the half-hourly prices over the last 7 days mostly ranged between £90/MWh and £200/MWh. Sorting all of those prices and finding the cut-off points might show the bottom third ends at £120/MWh and the top third begins at £160/MWh. A price of £105/MWh this half hour would then be labelled low, £145/MWh would be typical, and £185/MWh would be peak. Those two cut-off figures shift day to day as the trailing 7-day window moves, so “typical” always reflects genuinely recent prices, not a fixed benchmark.";

// The general boundary rule, applying to every half-hourly price site-
// wide — not specific to daily-aggregated views, which just apply the
// same rule to an averaged number (see "Banding on daily-aggregated
// views" below, which references this rather than restating it).
// Confirmed directly against ni_prices_banded's live SQL: strict < and
// > in the case statement, percentile_cont(0.33)/(0.67) for the cutoffs
// themselves.
const TERCILE_BOUNDARY_RULE =
  "To be precise: the two cutoffs are the 33rd and 67th percentiles of the trailing 7 days' half-hourly prices. A price is only low if it falls strictly below the 33rd percentile cutoff, and only peak if it falls strictly above the 67th percentile cutoff. A price landing exactly on either cutoff, or anywhere between the two, counts as typical.";

const SECTIONS = [
  {
    heading: "The market",
    terms: [
      {
        term: "SEM (Single Electricity Market)",
        body: "The wholesale electricity market covering both Northern Ireland and the Republic of Ireland together, run as one system rather than two separate national markets. It exists because the island's electricity grid is physically joined, so it makes more sense to trade power across the whole island than to split it artificially at the border.",
      },
      {
        term: "SEMOpx",
        termHref: "https://www.semopx.com/",
        body: "The company that runs the day ahead and intraday auctions for the SEM. All the price data on this site comes from SEMOpx's published auction results.",
      },
      {
        term: "Market area",
        body: "Within the SEM, prices are reported separately for Northern Ireland and the Republic of Ireland (labelled NI and ROI). They're usually close together since it's one physical grid, but not always identical.",
      },
    ],
  },
  {
    heading: "The auctions",
    intro:
      "Electricity has to be bought and sold in advance because it can't be stored at scale, someone has to commit to generating exactly what everyone else is about to use, half hour by half hour. That commitment happens through a sequence of auctions, each one closer to real time and each one refining the price using better information. This is what the Auction column on this site shows: SEM-DA for the day ahead auction, then SEM-IDA1, SEM-IDA2, and SEM-IDA3 for the three intraday auctions that follow it, in order, a higher number always means a more recent revision.",
    terms: [
      {
        term: "Settlement period",
        body: `The half hour block that every price on this site refers to, for example 13:00 to 13:30. There are 48 settlement periods in a normal day. This is the delivery time the price applies to, not when the auction that set it ran — a day ahead price for 13:00 tomorrow was set by an auction that ran earlier today, ${TYPICAL_PUBLISH_TIME}, not at 13:00 itself.`,
      },
      {
        term: "Day ahead auction (SEM-DA)",
        body: `The main auction, held the day before and usually published ${TYPICAL_PUBLISH_TIME}, that sets a price for every half hour of the following day. This is the price most people mean when they talk about “tomorrow's electricity price”, it's known well in advance, which is what makes things like time of use tariffs possible.`,
      },
      {
        term: "Intraday auctions (SEM-IDA1, SEM-IDA2, SEM-IDA3)",
        body: "Three further auctions held on the day itself, each one repricing the remaining periods of that day using more up to date information, most importantly, a better picture of how much wind is actually blowing. SEM-IDA1 is the first revision, SEM-IDA2 the second, SEM-IDA3 the third and closest to real time — a period won't necessarily have all three, but where it does, the highest-numbered one is the most current. Because Northern Ireland gets a large share of its power from wind, these auctions often move noticeably from the day ahead price.",
      },
      {
        term: "Which intraday price is shown",
        body: "The Ring and the chart's “Latest intraday” line show a single price per half hour — whichever of SEM-IDA3, SEM-IDA2, or SEM-IDA1 is the most recent one available for that specific period, not a fixed auction. Two neighbouring half hours can therefore come from different auctions at the same moment, if one period already has an IDA3 result and its neighbour doesn't yet. On SEMOpx's own site, where each auction has its own tab, that can look like several different numbers around the same time; this site is just showing the newest one available for each half hour individually.",
      },
      {
        term: "Does a later auction ever revise an already-elapsed period?",
        body: "No, once a settlement period has actually happened, its displayed price is locked in permanently. Every auction, including the closest-to-real-time SEM-IDA3, always publishes for periods that haven't happened yet, never for ones that already have, since there's nothing left to trade once the electricity's already been used. For example, the price shown for 16:00-16:30 on 13 August came from SEM-IDA3 (£132.37/MWh), published at 13:15, nearly three hours before that period even began. Once 16:30 passed, no later auction ever touched that period again.",
      },
      {
        term: "Index price",
        body: "The published clearing price from a given auction. This is what “the price” means on this site, pounds (or euros) per unit of electricity for a specific settlement period, from a specific auction.",
      },
    ],
  },
  {
    heading: "The numbers",
    terms: [
      {
        term: "£/MWh (pounds per megawatt hour)",
        body: "The standard wholesale unit, used for trading between generators and suppliers. One megawatt hour is a thousand kilowatt hours, roughly what a typical UK home uses in a few weeks.",
      },
      {
        term: "p/kWh (pence per kilowatt hour)",
        body: "The retail unit that shows up on a household bill. This site converts wholesale £/MWh figures into p/kWh so the numbers are easier to compare against a bill, but it's worth knowing wholesale price is only one part of what a supplier charges, it doesn't include network costs, supplier margin, or green levies.",
      },
      {
        term: "EUR and GBP",
        body: "SEMOpx publishes prices in both currencies, since the SEM spans two currency zones. This site shows GBP by default.",
      },
    ],
  },
  {
    heading: "Low, typical, and peak",
    intro: BAND_EXPLANATION,
    extraParagraphs: TERCILE_EXPLANATION_PARAGRAPHS,
    example: TERCILE_WORKED_EXAMPLE,
    afterExample: TERCILE_BOUNDARY_RULE,
    terms: [
      {
        term: "Day average",
        body: "A plain absolute figure next to the Ring's date picker, alongside (not instead of) the low/typical/peak colours above — this day's actual average price, in both units, so a day's colours (relative to its own recent week) can be read against a real number too. The day average only counts periods with a known price, it isn't adjusted or estimated for periods that haven't happened yet.",
      },
      {
        term: "Banding on daily-aggregated views",
        body: "When viewing All time or a wide custom range, each point on the chart represents a full day's average price rather than one half hour. Its colour works the same way conceptually, low, typical, or peak relative to recent prices, but is calculated slightly differently: it compares that day's average price against the average of that same day's own low/peak cutoffs (the same cutoffs each half hour within it was individually judged against). So a day's colour reflects how its overall average sat relative to a typical half hour that day, not a ranking against other days. The same precise boundary rule above applies here too, just compared against the day's own averaged cutoffs rather than a single half hour's cutoffs.",
      },
    ],
  },
  {
    heading: "Provisional prices",
    intro: PROVISIONAL_EXPLANATION,
    terms: [
      {
        term: "Why this exists",
        body: "The official static report for a settlement period sometimes isn't generated by SEMOpx for a while after the auction that set it has actually run, occasionally by hours. During that gap the Ring shows nothing for those periods, even though the price has, in reality, already been set. The provisional toggle lets you knowingly look at that price early, kept clearly separate from the confirmed figure.",
      },
      {
        term: "Where it appears",
        body: "One toggle governs all four places prices show up on this site — the Ring, the price history chart, the table, and the Excel export — and only when you turn it on, off by default. The same rule applies everywhere: official wins for any period it covers, provisional only fills in periods official hasn't reached yet. In the table and the export specifically, a Status column marks each row Official or Provisional so it's identifiable on its own, not just inferred from a dashed line. It isn't limited to today specifically — browse back a day and it can still fill in a trailing period or two that the official pipeline hadn't caught up on yet, but in practice you'll rarely see it anywhere except today and, occasionally, the tail end of yesterday.",
      },
      {
        term: "How to tell it apart",
        body: "A dashed, dimmer segment on the Ring, a dashed line on the chart, and a “provisional” note wherever a price appears — never blended into a confirmed figure without that marking. A count next to the Ring's date picker (for example “46 official · 2 provisional”) shows exactly how much of the day you're viewing is confirmed versus not, rather than just whether each source has anything at all.",
      },
    ],
  },
  {
    heading: "Using this site",
    terms: [
      {
        term: "Browsing other days",
        body: "Use the arrows or the date picker above the Ring to look at any earlier day, back to when this site's records begin.",
      },
      {
        term: "Provisional data toggle",
        body: "Switch on to fill in today's not-yet-official prices where the confirmed figure hasn't landed yet — off by default. See “Provisional prices” above for what that means and how it's marked.",
      },
      {
        term: "Chart and Table view",
        body: "The price history section below the Ring can show the same data as a chart or as a sortable table — switch between them with the Chart/Table buttons.",
      },
      {
        term: "Intraday / Tomorrow / Both",
        body: "Chart-only, and only available while viewing Today: Intraday shows today's actual prices, Tomorrow shows tomorrow's day-ahead price on its own, and Both overlays the two so they can be compared hour by hour. Outside Today, only Intraday applies, since Tomorrow and Both are both about comparing against tomorrow's date specifically.",
      },
      {
        term: "Custom date range",
        body: "Pick Custom instead of Today, 7 day, or All time to set your own start and end date.",
      },
      {
        term: "Exporting to Excel",
        body: "The Export .xlsx button downloads whatever's currently shown in the table — every auction's row for the active date range — regardless of which chart series is selected.",
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="page-wrap">
      <p className="eyebrow">NI Electricity · SEM Auctions</p>
      <h1>Help &amp; glossary</h1>

      <section className="glossary-section">
        <h2>Purpose of this dashboard</h2>
        <p className="glossary-body">
          This dashboard tracks Northern Ireland&rsquo;s wholesale electricity price
          throughout the day, and compares day ahead and intraday prices to help
          identify cheaper periods. It&rsquo;s price data only, not a measure of demand
          or consumption, there are no figures here for how much electricity is
          actually being used or generated at any given time. Whether you&rsquo;re a
          household deciding when to run the washing machine or a business
          managing flexible energy use, non essential activity can be shifted
          towards lower price windows to reduce costs, while anything time
          sensitive can simply continue as normal regardless of price.
        </p>
      </section>

      <section className="glossary-section">
        <h2>Where the data comes from</h2>
        <p className="glossary-body">
          The prices shown are sourced from SEMOpx, the official operator of the
          day ahead and intraday electricity auctions for the Single Electricity
          Market covering Ireland and Northern Ireland. SEMOpx is jointly
          regulated by the Utility Regulator (Northern Ireland) and the CRU
          (Republic of Ireland), meaning this data is not a third party
          estimate but the actual settlement data the wholesale market runs
          on. It can be considered the single source of truth for wholesale
          electricity pricing in this market.
        </p>
      </section>

      <section className="glossary-section">
        <h2>Why this matters compared to a supplier bill</h2>
        <p className="glossary-body">
          Electricity suppliers, including the major retail providers, ultimately
          trade through this same wholesale market before applying their own
          markup and passing costs on to customers, whether you&rsquo;re on a
          household tariff or a business contract. A standard supplier bill
          doesn&rsquo;t expose this underlying wholesale price or its half hourly
          movement. This dashboard makes that normally hidden pricing visible,
          giving anyone insight the retail relationship alone doesn&rsquo;t provide.
        </p>
      </section>

      <section className="glossary-section">
        <h2>How to use it</h2>
        <p className="glossary-body">
          Today&rsquo;s Ring shows the live price at a glance, coloured low, typical,
          or peak against the last 7 days. For a fuller picture, the price
          history chart&rsquo;s &ldquo;Both&rdquo; view overlays today&rsquo;s actual intraday
          price against tomorrow&rsquo;s already-set day ahead price on the same
          time-of-day axis, a preview of whether tomorrow looks cheaper or more
          expensive than today&rsquo;s pattern. Where a period&rsquo;s price runs lower,
          that&rsquo;s a potentially good window for anything flexible, a business
          process or just a household appliance. Anything time sensitive should
          continue to run as needed regardless of price, this tool is intended
          for spotting savings opportunities in the flexible portion of energy
          use, not for managing anything critical.
        </p>
      </section>

      {SECTIONS.map((section) => (
        <section key={section.heading} className="glossary-section">
          <h2>{section.heading}</h2>
          {section.intro && <p className="glossary-body">{section.intro}</p>}
          {section.extraParagraphs?.map((paragraph, i) => (
            <p key={i} className="glossary-body">
              {paragraph}
            </p>
          ))}
          {section.example && (
            <>
              <p className="glossary-example-label">Example figures</p>
              <p className="glossary-body glossary-example">{section.example}</p>
            </>
          )}
          {section.afterExample && <p className="glossary-body">{section.afterExample}</p>}
          <dl>
            {section.terms.map(({ term, termHref, body }) => (
              <div key={term} className="glossary-entry">
                <dt className="glossary-term">
                  {termHref ? (
                    <a
                      href={termHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="external-link"
                    >
                      {term}
                    </a>
                  ) : (
                    term
                  )}
                </dt>
                <dd className="glossary-body">{body}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="glossary-section">
        <h2>A note on accuracy</h2>
        <p className="glossary-body">
          This site shows real auction results from SEMOpx, not an estimate or a
          forecast built by AI. That said, prices are pulled and converted
          automatically, so treat the figures as informational. Don&rsquo;t use this
          site as the sole basis for switching tariff, timing large energy use, or
          any financial decision, always check a live supplier tariff or SEMOpx&rsquo;s
          own published data if a decision depends on it.
        </p>
        <DataCoverageNote />
      </section>
    </div>
  );
}
