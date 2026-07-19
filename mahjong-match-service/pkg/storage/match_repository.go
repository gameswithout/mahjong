package storage

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	mathrand "math/rand"
	"sort"
	"strings"

	"github.com/gameswithout/mahjong/rulesengine"
	"github.com/jackc/pgx/v5"
)

var (
	ErrInvalidMatch  = errors.New("invalid match identity")
	ErrInvalidRoster = errors.New("match roster must contain exactly four unique users")
	ErrRosterChanged = errors.New("session roster differs from the persisted match roster")
	ErrMatchNotFound = errors.New("match is not persisted")
)

type MatchKey struct {
	Namespace string
	SessionID string
	MatchID   string
}

func (p *PostgreSQLStorage) GetMatch(ctx context.Context, key MatchKey) (MatchRecord, error) {
	if err := key.Validate(); err != nil {
		return MatchRecord{}, err
	}
	var record MatchRecord
	record.Key = key
	if err := p.pool.QueryRow(ctx, `
		SELECT runtime_id, roster_hash
		FROM matches
		WHERE namespace = $1 AND session_id = $2 AND match_id = $3`,
		key.Namespace, key.SessionID, key.MatchID,
	).Scan(&record.RuntimeID, &record.RosterHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return MatchRecord{}, ErrMatchNotFound
		}
		return MatchRecord{}, fmt.Errorf("read match: %w", err)
	}
	rows, err := p.pool.Query(ctx, `
		SELECT user_id, seat
		FROM match_seats
		WHERE runtime_id = $1
		ORDER BY seat`, record.RuntimeID)
	if err != nil {
		return MatchRecord{}, fmt.Errorf("read match seats: %w", err)
	}
	defer rows.Close()
	record.Seats = make(map[string]rulesengine.Seat, 4)
	for rows.Next() {
		var userID, seat string
		if err := rows.Scan(&userID, &seat); err != nil {
			return MatchRecord{}, fmt.Errorf("scan match seat: %w", err)
		}
		record.Seats[userID] = rulesengine.Seat(seat)
	}
	if err := rows.Err(); err != nil {
		return MatchRecord{}, fmt.Errorf("iterate match seats: %w", err)
	}
	if len(record.Seats) != 4 {
		return MatchRecord{}, fmt.Errorf("persisted match has %d seats: %w", len(record.Seats), ErrInvalidRoster)
	}
	return record, nil
}

type MatchRecord struct {
	Key        MatchKey
	RuntimeID  string
	RosterHash string
	Seats      map[string]rulesengine.Seat
}

func (k MatchKey) Validate() error {
	if strings.TrimSpace(k.Namespace) == "" || strings.TrimSpace(k.SessionID) == "" || strings.TrimSpace(k.MatchID) == "" ||
		len(k.Namespace) > 128 || len(k.SessionID) > 128 || len(k.MatchID) > 128 {
		return ErrInvalidMatch
	}
	return nil
}

func (k MatchKey) RuntimeID() string {
	sum := sha256.Sum256([]byte(fmt.Sprintf(
		"%d:%s|%d:%s|%d:%s",
		len(k.Namespace), k.Namespace,
		len(k.SessionID), k.SessionID,
		len(k.MatchID), k.MatchID,
	)))
	return hex.EncodeToString(sum[:])
}

func (p *PostgreSQLStorage) EnsureMatch(ctx context.Context, key MatchKey, roster []string) (MatchRecord, bool, error) {
	if err := key.Validate(); err != nil {
		return MatchRecord{}, false, err
	}
	canonical, rosterHash, err := canonicalRoster(roster)
	if err != nil {
		return MatchRecord{}, false, err
	}
	assignments, err := randomizedSeats(canonical)
	if err != nil {
		return MatchRecord{}, false, err
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return MatchRecord{}, false, fmt.Errorf("begin ensure match: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	runtimeID := key.RuntimeID()
	tag, err := tx.Exec(ctx, `
		INSERT INTO matches (runtime_id, namespace, session_id, match_id, roster_hash)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT DO NOTHING`,
		runtimeID, key.Namespace, key.SessionID, key.MatchID, rosterHash,
	)
	if err != nil {
		return MatchRecord{}, false, fmt.Errorf("insert match: %w", err)
	}
	created := tag.RowsAffected() == 1
	if created {
		for userID, seat := range assignments {
			if _, err := tx.Exec(ctx, `
				INSERT INTO match_seats (runtime_id, user_id, seat)
				VALUES ($1, $2, $3)`,
				runtimeID, userID, string(seat),
			); err != nil {
				return MatchRecord{}, false, fmt.Errorf("insert match seat: %w", err)
			}
		}
	} else {
		var storedRuntimeID, storedHash string
		if err := tx.QueryRow(ctx, `
			SELECT runtime_id, roster_hash
			FROM matches
			WHERE namespace = $1 AND session_id = $2 AND match_id = $3`,
			key.Namespace, key.SessionID, key.MatchID,
		).Scan(&storedRuntimeID, &storedHash); err != nil {
			return MatchRecord{}, false, fmt.Errorf("read existing match: %w", err)
		}
		if storedHash != rosterHash {
			return MatchRecord{}, false, ErrRosterChanged
		}
		runtimeID = storedRuntimeID
		assignments, err = readSeats(ctx, tx, runtimeID)
		if err != nil {
			return MatchRecord{}, false, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return MatchRecord{}, false, fmt.Errorf("commit ensure match: %w", err)
	}
	return MatchRecord{Key: key, RuntimeID: runtimeID, RosterHash: rosterHash, Seats: assignments}, created, nil
}

func readSeats(ctx context.Context, tx pgx.Tx, runtimeID string) (map[string]rulesengine.Seat, error) {
	rows, err := tx.Query(ctx, `
		SELECT user_id, seat
		FROM match_seats
		WHERE runtime_id = $1
		ORDER BY seat`, runtimeID)
	if err != nil {
		return nil, fmt.Errorf("read match seats: %w", err)
	}
	defer rows.Close()
	assignments := make(map[string]rulesengine.Seat, 4)
	for rows.Next() {
		var userID, seat string
		if err := rows.Scan(&userID, &seat); err != nil {
			return nil, fmt.Errorf("scan match seat: %w", err)
		}
		assignments[userID] = rulesengine.Seat(seat)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate match seats: %w", err)
	}
	if len(assignments) != 4 {
		return nil, fmt.Errorf("persisted match has %d seats: %w", len(assignments), ErrInvalidRoster)
	}
	return assignments, nil
}

func canonicalRoster(roster []string) ([]string, string, error) {
	if len(roster) != 4 {
		return nil, "", ErrInvalidRoster
	}
	canonical := make([]string, 0, 4)
	seen := make(map[string]struct{}, 4)
	for _, value := range roster {
		userID := strings.TrimSpace(value)
		if userID == "" {
			return nil, "", ErrInvalidRoster
		}
		if _, exists := seen[userID]; exists {
			return nil, "", ErrInvalidRoster
		}
		seen[userID] = struct{}{}
		canonical = append(canonical, userID)
	}
	sort.Strings(canonical)
	hash := sha256.Sum256([]byte(strings.Join(canonical, "\x00")))
	return canonical, hex.EncodeToString(hash[:]), nil
}

func randomizedSeats(roster []string) (map[string]rulesengine.Seat, error) {
	var seedBytes [8]byte
	if _, err := rand.Read(seedBytes[:]); err != nil {
		return nil, fmt.Errorf("generate seat seed: %w", err)
	}
	seats := []rulesengine.Seat{rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North}
	rng := mathrand.New(mathrand.NewSource(int64(binary.BigEndian.Uint64(seedBytes[:]))))
	rng.Shuffle(len(seats), func(i, j int) { seats[i], seats[j] = seats[j], seats[i] })
	assignments := make(map[string]rulesengine.Seat, 4)
	for index, userID := range roster {
		assignments[userID] = seats[index]
	}
	return assignments, nil
}
