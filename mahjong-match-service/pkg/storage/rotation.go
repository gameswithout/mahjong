package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
	"github.com/jackc/pgx/v5"
)

var (
	ErrRotationNotFound = errors.New("full rotation is not persisted")
	// ErrRotationHandMismatch means a hand row exists at this index with a
	// different dealer or continuation count than the caller expected. It
	// signals a genuine inconsistency rather than a race: the runtime derives
	// both from the persisted rotation state, so they cannot legitimately
	// differ between replicas.
	ErrRotationHandMismatch = errors.New("persisted rotation hand does not match the requested one")
)

// RotationRecord is a Full Rotation container: the fixed table positions, the
// running §8.4 state, and which hand is currently open.
type RotationRecord struct {
	Key       MatchKey
	RuntimeID string
	// Seats maps each player to their fixed table position for the whole
	// rotation. Winds turn with the dealership; these do not.
	Seats map[string]rulesengine.Seat
	State rulesengine.RotationState
	// HandIndex is the most recently opened hand, numbered from 1. Zero means
	// no hand has been opened yet.
	HandIndex int
	Complete  bool
}

// SeatOrder is §8.4's uniformly randomized initial seat order, the last
// tie-break in FinalPlacement. It is recovered from the seat assignment rather
// than stored separately: EnsureMatch assigns positions by walking the roster
// in canonical (sorted) order against a shuffled seat list, so reading the
// positions back in that same order reproduces the shuffle exactly.
func (r RotationRecord) SeatOrder() []rulesengine.Seat {
	userIDs := make([]string, 0, len(r.Seats))
	for userID := range r.Seats {
		userIDs = append(userIDs, userID)
	}
	sort.Strings(userIDs)
	order := make([]rulesengine.Seat, 0, len(userIDs))
	for _, userID := range userIDs {
		order = append(order, r.Seats[userID])
	}
	return order
}

// HandKey is the match identity of one hand of a rotation. Hands live in the
// matches table alongside ordinary Quick Play matches, distinguished by a
// suffix on the match ID, so the existing runtime can play them unchanged.
func HandKey(rotation MatchKey, handIndex int) MatchKey {
	return MatchKey{
		Namespace: rotation.Namespace,
		SessionID: rotation.SessionID,
		MatchID:   rotation.MatchID + rotationHandSuffix + strconv.Itoa(handIndex),
	}
}

// rotationHandSuffix separates a rotation's match ID from its hand number.
// AGS session and match IDs are UUID-shaped, so "#" cannot occur in one and a
// hand key can never collide with a real Quick Play match.
const rotationHandSuffix = "#h"

// EnsureRotation creates or reads the rotation container for key. It is
// idempotent on the match key, like EnsureMatch, so a request storm at the
// start of a match seats everyone once.
func (p *PostgreSQLStorage) EnsureRotation(
	ctx context.Context,
	key MatchKey,
	roster []string,
	startedAt time.Time,
) (RotationRecord, bool, error) {
	record, _, err := p.EnsureMatch(ctx, key, roster)
	if err != nil {
		return RotationRecord{}, false, err
	}

	state := rulesengine.NewRotationState(startedAt)
	encoded, err := json.Marshal(state)
	if err != nil {
		return RotationRecord{}, false, fmt.Errorf("encode rotation state: %w", err)
	}
	tag, err := p.pool.Exec(ctx, `
		INSERT INTO rotation_matches (runtime_id, started_at, state)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING`,
		record.RuntimeID, startedAt, encoded,
	)
	if err != nil {
		return RotationRecord{}, false, fmt.Errorf("insert rotation: %w", err)
	}
	if tag.RowsAffected() == 1 {
		return RotationRecord{
			Key:       key,
			RuntimeID: record.RuntimeID,
			Seats:     record.Seats,
			State:     state,
		}, true, nil
	}
	existing, err := p.GetRotation(ctx, key)
	return existing, false, err
}

// GetRotation reads a rotation container. It returns ErrRotationNotFound both
// when no match exists and when a match exists that is not a rotation, so a
// Quick Play match can never be mistaken for one.
func (p *PostgreSQLStorage) GetRotation(ctx context.Context, key MatchKey) (RotationRecord, error) {
	record, err := p.GetMatch(ctx, key)
	if errors.Is(err, ErrMatchNotFound) {
		return RotationRecord{}, ErrRotationNotFound
	}
	if err != nil {
		return RotationRecord{}, err
	}
	rotation := RotationRecord{Key: key, RuntimeID: record.RuntimeID, Seats: record.Seats}
	var encoded []byte
	if err := p.pool.QueryRow(ctx, `
		SELECT state, hand_index, complete
		FROM rotation_matches
		WHERE runtime_id = $1`, record.RuntimeID,
	).Scan(&encoded, &rotation.HandIndex, &rotation.Complete); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RotationRecord{}, ErrRotationNotFound
		}
		return RotationRecord{}, fmt.Errorf("read rotation: %w", err)
	}
	if err := json.Unmarshal(encoded, &rotation.State); err != nil {
		return RotationRecord{}, fmt.Errorf("decode rotation state: %w", err)
	}
	return rotation, nil
}

// RotationHand is one hand of a rotation and the match it is played as.
type RotationHand struct {
	Index         int
	Match         MatchRecord
	Dealer        rulesengine.Seat
	Continuations int
	Settled       bool
	// SettledAt is when this hand's result was folded into the rotation. The
	// inter-hand pause that lets players read the result is measured from it,
	// so every replica opens the next hand at the same moment.
	SettledAt *time.Time
}

// OpenHand creates hand handIndex of a rotation, or returns the existing one.
//
// The hand's seat map holds winds rather than table positions: the dealer plays
// East, so the runtime can play the hand with no knowledge of the rotation. It
// is created with an explicit seat map rather than through EnsureMatch, whose
// randomized assignment is right for the rotation container and wrong here —
// re-randomizing per hand would move players around the table mid-match.
func (p *PostgreSQLStorage) OpenHand(
	ctx context.Context,
	rotation RotationRecord,
	handIndex int,
	dealer rulesengine.Seat,
	continuations int,
) (RotationHand, error) {
	if handIndex < 1 {
		return RotationHand{}, fmt.Errorf("%w: hand index %d", ErrInvalidMatch, handIndex)
	}
	winds := make(map[string]rulesengine.Seat, len(rotation.Seats))
	for userID, position := range rotation.Seats {
		wind, err := rulesengine.SeatWind(position, dealer)
		if err != nil {
			return RotationHand{}, fmt.Errorf("hand %d seat map: %w", handIndex, err)
		}
		winds[userID] = wind
	}
	key := HandKey(rotation.Key, handIndex)
	if err := key.Validate(); err != nil {
		return RotationHand{}, err
	}
	roster := make([]string, 0, len(winds))
	for userID := range winds {
		roster = append(roster, userID)
	}
	_, rosterHash, err := canonicalRoster(roster)
	if err != nil {
		return RotationHand{}, err
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return RotationHand{}, fmt.Errorf("begin open hand: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	handRuntimeID := key.RuntimeID()
	tag, err := tx.Exec(ctx, `
		INSERT INTO matches (runtime_id, namespace, session_id, match_id, roster_hash)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT DO NOTHING`,
		handRuntimeID, key.Namespace, key.SessionID, key.MatchID, rosterHash,
	)
	if err != nil {
		return RotationHand{}, fmt.Errorf("insert rotation hand match: %w", err)
	}
	if tag.RowsAffected() == 1 {
		for userID, wind := range winds {
			if _, err := tx.Exec(ctx, `
				INSERT INTO match_seats (runtime_id, user_id, seat)
				VALUES ($1, $2, $3)`,
				handRuntimeID, userID, string(wind),
			); err != nil {
				return RotationHand{}, fmt.Errorf("insert rotation hand seat: %w", err)
			}
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO rotation_hands (rotation_id, hand_index, hand_runtime_id, dealer, continuations)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT DO NOTHING`,
		rotation.RuntimeID, handIndex, handRuntimeID, string(dealer), continuations,
	); err != nil {
		return RotationHand{}, fmt.Errorf("insert rotation hand: %w", err)
	}
	// hand_index only ever moves forward. A slow replica re-opening an earlier
	// hand must not drag the rotation backwards.
	if _, err := tx.Exec(ctx, `
		UPDATE rotation_matches
		SET hand_index = GREATEST(hand_index, $2), updated_at = NOW()
		WHERE runtime_id = $1`,
		rotation.RuntimeID, handIndex,
	); err != nil {
		return RotationHand{}, fmt.Errorf("advance rotation hand index: %w", err)
	}

	var stored RotationHand
	stored.Index = handIndex
	var storedDealer string
	if err := tx.QueryRow(ctx, `
		SELECT dealer, continuations, settled, settled_at
		FROM rotation_hands
		WHERE rotation_id = $1 AND hand_index = $2`,
		rotation.RuntimeID, handIndex,
	).Scan(&storedDealer, &stored.Continuations, &stored.Settled, &stored.SettledAt); err != nil {
		return RotationHand{}, fmt.Errorf("read rotation hand: %w", err)
	}
	stored.Dealer = rulesengine.Seat(storedDealer)
	if stored.Dealer != dealer || stored.Continuations != continuations {
		return RotationHand{}, fmt.Errorf(
			"%w: hand %d is dealt by %s after %d continuations, requested %s after %d",
			ErrRotationHandMismatch, handIndex, stored.Dealer, stored.Continuations, dealer, continuations,
		)
	}
	seats, err := readSeats(ctx, tx, handRuntimeID)
	if err != nil {
		return RotationHand{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RotationHand{}, fmt.Errorf("commit open hand: %w", err)
	}
	stored.Match = MatchRecord{Key: key, RuntimeID: handRuntimeID, RosterHash: rosterHash, Seats: seats}
	return stored, nil
}

// SettleHand folds one completed hand's outcome into the rotation state,
// exactly once.
//
// applied reports whether this call was the one that did it. The conditional
// UPDATE on settled and the state write share a transaction, so concurrent
// replicas observing the same completed hand cannot both advance the
// standings. Everything that must happen once per hand — XP, statistics, the
// next hand — keys off applied rather than off observing a completed hand,
// because every replica observes that.
func (p *PostgreSQLStorage) SettleHand(
	ctx context.Context,
	rotationRuntimeID string,
	handIndex int,
	next rulesengine.RotationState,
	completedAt time.Time,
) (applied bool, err error) {
	encoded, err := json.Marshal(next)
	if err != nil {
		return false, fmt.Errorf("encode rotation state: %w", err)
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin settle rotation hand: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE rotation_hands
		SET settled = TRUE, settled_at = $3
		WHERE rotation_id = $1 AND hand_index = $2 AND NOT settled`,
		rotationRuntimeID, handIndex, completedAt,
	)
	if err != nil {
		return false, fmt.Errorf("mark rotation hand settled: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}

	var completedAtValue *time.Time
	if next.Complete {
		completedAtValue = &completedAt
	}
	if _, err := tx.Exec(ctx, `
		UPDATE rotation_matches
		SET state = $2, complete = $3, completed_at = $4, updated_at = NOW()
		WHERE runtime_id = $1`,
		rotationRuntimeID, encoded, next.Complete, completedAtValue,
	); err != nil {
		return false, fmt.Errorf("write rotation state: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit settle rotation hand: %w", err)
	}
	return true, nil
}

// Hands lists a rotation's hands in play order.
func (p *PostgreSQLStorage) Hands(ctx context.Context, rotationRuntimeID string) ([]RotationHand, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT hand_index, hand_runtime_id, dealer, continuations, settled, settled_at
		FROM rotation_hands
		WHERE rotation_id = $1
		ORDER BY hand_index`, rotationRuntimeID)
	if err != nil {
		return nil, fmt.Errorf("read rotation hands: %w", err)
	}
	defer rows.Close()
	hands := make([]RotationHand, 0, 4)
	for rows.Next() {
		var hand RotationHand
		var dealer string
		if err := rows.Scan(
			&hand.Index, &hand.Match.RuntimeID, &dealer,
			&hand.Continuations, &hand.Settled, &hand.SettledAt,
		); err != nil {
			return nil, fmt.Errorf("scan rotation hand: %w", err)
		}
		hand.Dealer = rulesengine.Seat(dealer)
		hands = append(hands, hand)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rotation hands: %w", err)
	}
	return hands, nil
}
