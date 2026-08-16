import type { BotPersonaCard } from "./bot-persona-catalog";

export const MAX_PERSONA_PICKS = 3;

export interface BotPersonaPickerState {
  personas: BotPersonaCard[];
  loading: boolean;
  error: string | null;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSelectForMe: () => void;
  // Fired once, the first time the picker is expanded — the catalog fetch
  // it triggers is not worth spending on a player who never opens the
  // section, so App.tsx defers it until this fires.
  onOpen: () => void;
}

/**
 * "Give me option to pick which bot to play against, or select for me."
 *
 * A flat multi-select, not a per-seat assignment: which of E/S/W/N a player
 * draws is randomized and not visible until the table loads, so asking them
 * to assign a persona to "seat 2" would be a decision about something they
 * cannot see yet. Picking 0-3 personalities to guarantee somewhere at the
 * table, with the rest auto-filled, is what both halves of the ask actually
 * need: a player who picks nothing gets exactly today's default, and a
 * player who picks one gets it plus two surprises.
 */
export function BotPersonaPicker({ state }: { state: BotPersonaPickerState }) {
  const { personas, loading, error, selectedIds, onToggle, onSelectForMe, onOpen } = state;
  const atCap = selectedIds.length >= MAX_PERSONA_PICKS;

  return (
    <details
      className="persona-picker"
      onToggle={(event) => {
        if ((event.target as HTMLDetailsElement).open) {
          onOpen();
        }
      }}
    >
      <summary className="persona-picker-summary">
        Choose your opponents
        {selectedIds.length > 0 ? (
          <span className="persona-picker-count">{selectedIds.length}/{MAX_PERSONA_PICKS} picked</span>
        ) : (
          <span className="persona-picker-count persona-picker-count-auto">Select for me</span>
        )}
      </summary>

      <p className="persona-picker-hint">
        Pick up to {MAX_PERSONA_PICKS} personalities to guarantee at your table. Leave the
        rest — or all of it — to fill automatically.
      </p>

      {selectedIds.length > 0 && (
        <button type="button" className="secondary-action persona-picker-reset" onClick={onSelectForMe}>
          Select for me
        </button>
      )}

      {loading && <p className="persona-picker-status">Loading opponents…</p>}
      {error && !loading && <p className="persona-picker-status persona-picker-error" role="alert">{error}</p>}

      {!loading && !error && personas.length > 0 && (
        <div className="persona-picker-grid" role="group" aria-label="Choose your opponents">
          {personas.map((persona) => {
            const selected = selectedIds.includes(persona.id);
            const disabled = !selected && atCap;
            return (
              <button
                key={persona.id}
                type="button"
                className={`persona-picker-card${selected ? " persona-picker-card-selected" : ""}`}
                aria-pressed={selected}
                disabled={disabled}
                title={disabled ? `Deselect another opponent first (max ${MAX_PERSONA_PICKS})` : undefined}
                onClick={() => onToggle(persona.id)}
              >
                <span className="persona-picker-card-glyph" aria-hidden="true">{persona.glyph}</span>
                <span className="persona-picker-card-name">{persona.name}</span>
                <span className="persona-picker-card-tag">{persona.styleTag}</span>
                <span className="persona-picker-card-tagline">{persona.tagline}</span>
                <PersonaBarsDisplay bars={persona.bars} />
                <span className="persona-picker-card-trait">
                  <strong>Strength</strong> {persona.strength}
                </span>
                <span className="persona-picker-card-trait">
                  <strong>Weakness</strong> {persona.weakness}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </details>
  );
}

const BAR_LABELS: Array<{ key: keyof BotPersonaCard["bars"]; label: string }> = [
  { key: "pace", label: "Pace" },
  { key: "value", label: "Value" },
  { key: "caution", label: "Caution" },
  { key: "calling", label: "Calling" },
  { key: "concealment", label: "Concealment" },
];

function PersonaBarsDisplay({ bars }: { bars: BotPersonaCard["bars"] }) {
  return (
    <span className="persona-picker-bars" aria-hidden="true">
      {BAR_LABELS.map(({ key, label }) => (
        <span className="persona-picker-bar" key={key} title={`${label}: ${bars[key]}/5`}>
          <span className="persona-picker-bar-label">{label[0]}</span>
          <span className="persona-picker-bar-track">
            <span
              className="persona-picker-bar-fill"
              style={{ width: `${(Math.max(0, Math.min(5, bars[key])) / 5) * 100}%` }}
            />
          </span>
        </span>
      ))}
    </span>
  );
}
