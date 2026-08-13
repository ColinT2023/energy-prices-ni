"use client";

/**
 * Off by default — someone has to knowingly turn this on. Deliberately a
 * plain labelled checkbox rather than a slicker switch graphic: this is an
 * experimental, unofficial data source, and the control for it shouldn't
 * look more polished/confidence-inspiring than the data underneath it
 * actually is.
 */
export default function ProvisionalToggle({ enabled, onChange }) {
  return (
    <label className="provisional-toggle">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      Show provisional prices
      <span className="provisional-toggle-note">unofficial, today only</span>
    </label>
  );
}
