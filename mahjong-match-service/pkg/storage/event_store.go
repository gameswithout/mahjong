package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/gameswithout/mahjong/rulesengine"
)

func (p *PostgreSQLStorage) Append(ctx context.Context, event rulesengine.MatchEvent) error {
	if p == nil || p.pool == nil {
		return fmt.Errorf("%w: storage is not initialized", rulesengine.ErrEventStore)
	}
	if event.MatchID == "" {
		return rulesengine.ErrMatchRequired
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("%w: begin append: %v", rulesengine.ErrEventStore, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var lockedID string
	if err := tx.QueryRow(ctx, `
		SELECT runtime_id
		FROM matches
		WHERE runtime_id = $1
		FOR UPDATE`, event.MatchID).Scan(&lockedID); err != nil {
		return fmt.Errorf("%w: lock match: %v", rulesengine.ErrEventStore, err)
	}
	var next uint64
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(sequence), 0) + 1
		FROM match_events
		WHERE runtime_id = $1`, event.MatchID).Scan(&next); err != nil {
		return fmt.Errorf("%w: read next sequence: %v", rulesengine.ErrEventStore, err)
	}
	if event.Sequence != next {
		return fmt.Errorf("%w: got %d want %d", rulesengine.ErrEventSequence, event.Sequence, next)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO match_events (
			runtime_id, sequence, request_id, event_type, occurred_at,
			state_version, state_hash, command, result, snapshot, error_code
		)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9, $10, NULLIF($11, ''))`,
		event.MatchID,
		event.Sequence,
		event.RequestID,
		event.Type,
		event.OccurredAt,
		event.StateVersion,
		event.StateHash,
		jsonOrNil(event.Command),
		jsonOrNil(event.Result),
		jsonOrNil(event.Snapshot),
		event.ErrorCode,
	)
	if err != nil {
		return fmt.Errorf("%w: insert event: %v", rulesengine.ErrEventStore, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("%w: commit append: %v", rulesengine.ErrEventStore, err)
	}
	return nil
}

func (p *PostgreSQLStorage) Events(ctx context.Context, runtimeID string) ([]rulesengine.MatchEvent, error) {
	if p == nil || p.pool == nil {
		return nil, fmt.Errorf("%w: storage is not initialized", rulesengine.ErrEventStore)
	}
	rows, err := p.pool.Query(ctx, `
		SELECT sequence, event_type, COALESCE(request_id, ''), occurred_at,
		       state_version, state_hash, command, result, snapshot,
		       COALESCE(error_code, '')
		FROM match_events
		WHERE runtime_id = $1
		ORDER BY sequence`, runtimeID)
	if err != nil {
		return nil, fmt.Errorf("%w: query events: %v", rulesengine.ErrEventStore, err)
	}
	defer rows.Close()

	events := make([]rulesengine.MatchEvent, 0)
	for rows.Next() {
		event := rulesengine.MatchEvent{MatchID: runtimeID}
		var command, result, snapshot []byte
		if err := rows.Scan(
			&event.Sequence,
			&event.Type,
			&event.RequestID,
			&event.OccurredAt,
			&event.StateVersion,
			&event.StateHash,
			&command,
			&result,
			&snapshot,
			&event.ErrorCode,
		); err != nil {
			return nil, fmt.Errorf("%w: scan event: %v", rulesengine.ErrEventStore, err)
		}
		event.Command = cloneJSON(command)
		event.Result = cloneJSON(result)
		event.Snapshot = cloneJSON(snapshot)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: iterate events: %v", rulesengine.ErrEventStore, err)
	}
	return events, nil
}

func (p *PostgreSQLStorage) LastSequence(ctx context.Context, runtimeID string) (uint64, error) {
	if p == nil || p.pool == nil {
		return 0, fmt.Errorf("%w: storage is not initialized", rulesengine.ErrEventStore)
	}
	var sequence uint64
	if err := p.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(sequence), 0)
		FROM match_events
		WHERE runtime_id = $1`, runtimeID).Scan(&sequence); err != nil {
		return 0, fmt.Errorf("%w: read event head: %v", rulesengine.ErrEventStore, err)
	}
	return sequence, nil
}

func jsonOrNil(value json.RawMessage) any {
	if len(value) == 0 {
		return nil
	}
	return []byte(value)
}

func cloneJSON(value []byte) json.RawMessage {
	if len(value) == 0 {
		return nil
	}
	return append(json.RawMessage(nil), value...)
}
