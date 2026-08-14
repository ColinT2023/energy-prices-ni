import { BAND_EXPLANATION, PROVISIONAL_EXPLANATION } from "../../lib/priceSeries";

export const metadata = {
  title: "Help — NI Energy Prices",
  description: "How the SEM electricity market and its auctions work, and what the numbers on this site mean.",
};

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
        body: "The half hour block that every price on this site refers to, for example 13:00 to 13:30. There are 48 settlement periods in a normal day. This is the delivery time the price applies to, not when the auction that set it ran — a day ahead price for 13:00 tomorrow was set by an auction that ran this afternoon, not at 13:00 itself.",
      },
      {
        term: "Day ahead auction (SEM-DA)",
        body: "The main auction, held the afternoon before, that sets a price for every half hour of the following day. This is the price most people mean when they talk about “tomorrow's electricity price”, it's known well in advance, which is what makes things like time of use tariffs possible.",
      },
      {
        term: "Intraday auctions (SEM-IDA1, SEM-IDA2, SEM-IDA3)",
        body: "Three further auctions held on the day itself, each one repricing the remaining periods of that day using more up to date information, most importantly, a better picture of how much wind is actually blowing. SEM-IDA1 is the first revision, SEM-IDA2 the second, SEM-IDA3 the third and closest to real time — a period won't necessarily have all three, but where it does, the highest-numbered one is the most current. Because Northern Ireland gets a large share of its power from wind, these auctions often move noticeably from the day ahead price.",
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
    terms: [
      {
        term: "Day average",
        body: "A plain absolute figure next to the Ring's date picker, alongside (not instead of) the low/typical/peak colours above — this day's actual average price, in both units, so a day's colours (relative to its own recent week) can be read against a real number too. The day average only counts periods with a known price, it isn't adjusted or estimated for periods that haven't happened yet.",
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
        term: "Day ahead / Intraday / Both",
        body: "Filter the chart to just the day ahead line, just the latest intraday line, or both together.",
      },
      {
        term: "Custom date range",
        body: "Pick Custom instead of Today, 7 day, or All time to set your own start and end date.",
      },
      {
        term: "Exporting to Excel",
        body: "The Export .xlsx button downloads whatever's currently shown — it always matches the active date range and series filter.",
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="page-wrap">
      <p className="eyebrow">NI Electricity · SEM Auctions</p>
      <h1>Help &amp; glossary</h1>

      <p className="glossary-intro">
        This shows how Northern Ireland&rsquo;s electricity price changes throughout
        the day &mdash; it isn&rsquo;t a bill calculator and doesn&rsquo;t show how much
        electricity anyone&rsquo;s using, just what electricity itself costs on the
        wholesale market at any given moment.
      </p>

      <p className="glossary-lede">
        Northern Ireland and the Republic of Ireland share a single electricity
        market called the SEM. Generators and suppliers trade power through daily
        auctions, and the price set by each auction is what this site shows. This
        is price data only, not a measure of demand or consumption &mdash; there are
        no figures anywhere on this site for how much electricity is actually
        being used or generated at any given time. There is no single &ldquo;the
        price of electricity&rdquo; the way there&rsquo;s a petrol price on a forecourt
        sign, there&rsquo;s a different price for every half hour of the day, set the
        day before and then revised as the actual day gets closer.
      </p>

      {SECTIONS.map((section) => (
        <section key={section.heading} className="glossary-section">
          <h2>{section.heading}</h2>
          {section.intro && <p className="glossary-body">{section.intro}</p>}
          <dl>
            {section.terms.map(({ term, body }) => (
              <div key={term} className="glossary-entry">
                <dt className="glossary-term">{term}</dt>
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
      </section>
    </div>
  );
}
