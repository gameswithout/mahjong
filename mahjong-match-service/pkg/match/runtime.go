package match

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gameswithout/mahjong/bots"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

// takeoverSeatOrder fixes the scan order driveLocked uses when more than
// one seat is taken over simultaneously; only ordering, not fairness,
// depends on it (each drive pass re-evaluates from scratch).
var takeoverSeatOrder = []rulesengine.Seat{rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North}

// Each individual hand is dealt with East as the engine's dealer. Full
// Rotation turns the players' winds between hands and keeps the real dealer
// and continuation state in its container; Quick Play remains one Bamboo
// Courtyard hand.
const matchDealer = rulesengine.East
const matchContinuations = 0
const openingBotTurnDelay = 2 * time.Second

var matchTier = rulesengine.TierBambooCourtyard

type handMode uint8

const (
	handModeQuickPlay handMode = iota
	handModeFullRotation
)

func deadlineConfigForHand(mode handMode) (rulesengine.DeadlineConfig, error) {
	switch mode {
	case handModeQuickPlay:
		// The only public Quick Play tier currently open is Bamboo Courtyard,
		// whose beginner interception window is 10 seconds rather than 7.
		return rulesengine.NewDeadlineConfig(rulesengine.ContextPublicQuickPlay, true, 0)
	case handModeFullRotation:
		return rulesengine.NewDeadlineConfig(rulesengine.ContextRankedFullRotation, false, 0)
	default:
		return rulesengine.DeadlineConfig{}, fmt.Errorf("unknown hand mode %d", mode)
	}
}

// applyBotSeats marks every seat whose roster userID is a synthetic AI
// Practice bot ID (session.IsBotUserID — see AGSResolver.Roster's
// ai_practice roster padding) as permanently bot-controlled, and, if any
// were marked, switches the whole match to the untimed §5.10 AI Practice
// deadline preset. Must run right after NewTurnEngine, before
// NewMatchActor — the same timing contract SetDeadlineConfig documents —
// so the initial match.created snapshot captures both.
func applyBotSeats(engine *rulesengine.TurnEngine, seats map[string]rulesengine.Seat) error {
	anyBot := false
	for userID, seat := range seats {
		if session.IsBotUserID(userID) {
			engine.MarkBotSeat(seat)
			anyBot = true
		}
	}
	if !anyBot {
		return nil
	}
	deadlines, err := rulesengine.NewDeadlineConfig(rulesengine.ContextAIPractice, false, 0)
	if err != nil {
		return err
	}
	engine.SetDeadlineConfig(deadlines)
	return nil
}

// enrichedView calls actor.View(seat) and, once the hand has actually
// ended, attaches the §9.7 items ProjectSeat itself cannot compute
// (Settlement, NextDealer) since those need dealer/continuation/tier
// session state ProjectSeat has no visibility into.
//
// tier is what the hand settles in: Jade at the table's tier for Quick Play,
// or §8.4 table points for a Full Rotation hand, which uses no Jade at all.
// The dealer is East either way — in a rotation the winds turn with the
// dealership, so every hand is dealt and settled as an East-dealer hand, and
// only the rotation container tracks who that actually is.
func enrichedView(
	actor *rulesengine.MatchActor,
	seat rulesengine.Seat,
	tier rulesengine.LobbyTier,
	continuations int,
) (rulesengine.SeatView, error) {
	view, err := actor.View(seat)
	if err != nil || view.HandResult == nil {
		return view, err
	}
	settlement, settleErr := rulesengine.SettleHand(rulesengine.SettlementInput{
		Tier:          tier,
		Dealer:        matchDealer,
		Continuations: continuations,
		Result:        view.HandResult,
	})
	if settleErr == nil {
		view.Settlement = &settlement
	}
	dealerTing := false
	if view.HandResult.Kind == rulesengine.KindExhaustiveDraw {
		if engine := actor.Peek(); engine != nil {
			for _, player := range engine.Deal.Players {
				if player.Seat != matchDealer {
					continue
				}
				waits, _ := rulesengine.WinningTiles(player.Hand, player.Melds)
				dealerTing = len(waits) > 0
			}
		}
	}
	outcome, outcomeErr := rulesengine.NextDealerState(matchDealer, continuations, view.HandResult, dealerTing)
	if outcomeErr == nil {
		view.NextDealer = &outcome
	}
	return view, nil
}

var (
	ErrNotMember        = errors.New("player is not a member of this match")
	ErrMatchNotLoaded   = errors.New("match has not been joined")
	ErrActionNotAllowed = errors.New("match action is not allowed")
)

type MatchRepository interface {
	GetMatch(context.Context, storage.MatchKey) (storage.MatchRecord, error)
	EnsureMatch(context.Context, storage.MatchKey, []string) (storage.MatchRecord, bool, error)
}

type Runtime struct {
	mu        sync.Mutex
	rosters   session.Resolver
	matches   MatchRepository
	rotations RotationRepository
	events    rulesengine.EventStore
	now       func() time.Time
	actors    map[string]*loadedMatch
	locks     map[string]*sync.Mutex
}

// SetRotations supplies the storage a Full Rotation needs. Without it the
// runtime plays Quick Play only, and a session asking for Full Rotation is
// refused rather than quietly downgraded to a single hand.
func (r *Runtime) SetRotations(repository RotationRepository) {
	if r != nil {
		r.rotations = repository
	}
}

// table is the hand a player is acting on, plus the rotation around it when
// there is one. Quick Play is the degenerate case: one hand, no rotation.
type table struct {
	current  *loadedMatch
	seat     rulesengine.Seat
	userID   string
	rotation *rotationTable
}

// tier is what the hand settles in. §8.4 Full Rotation "is ranked and uses no
// Jade": its hands settle in table points, which are not an account currency,
// so no Jade tier applies to them.
func (t *table) tier() rulesengine.LobbyTier {
	if t.rotation != nil {
		return rulesengine.TablePointTier
	}
	return matchTier
}

// continuations is the §5.11 count standing behind this hand, which sets the
// Dealer Tai. Quick Play always plays the first hand of a notional round.
func (t *table) continuations() int {
	if t.rotation != nil {
		return t.rotation.hand.Continuations
	}
	return matchContinuations
}

type loadedMatch struct {
	record storage.MatchRecord
	actor  *rulesengine.MatchActor
	// openingBotReadyAt holds the one-time presentation grace period for a
	// match whose dealer is bot-controlled. driveLocked returns the untouched
	// opening state until this time so clients can render the table before the
	// first move. The deadline is derived from the persisted match.created
	// event, keeping it consistent across runtime replicas and restarts.
	openingBotReadyAt time.Time
	// pendingRestore marks a seat whose rightful owner has been observed
	// present (an authenticated Join/View/Apply call) while that seat was
	// taken over (§8.7). It is only ever set while the seat is actually
	// taken over at the moment of the call — never preemptively — so a
	// call made before any takeover exists cannot leave a stale flag that
	// would instantly (and wrongly) restore control the next time the seat
	// happens to be taken over in some later, unrelated window. driveLocked
	// consumes (clears) this flag once it actually restores control, at
	// the seat's next legal personal turn rather than immediately.
	pendingRestore map[rulesengine.Seat]bool
}

// markPresentIfTakenOver records that seat's owner was just observed
// (an authenticated call succeeded) while the seat was under takeover —
// the §8.7 reconnect signal driveLocked acts on.
func (r *Runtime) markPresentIfTakenOver(current *loadedMatch, seat rulesengine.Seat) {
	engine := current.actor.Peek()
	if engine == nil || !engine.IsTakenOver(seat) {
		return
	}
	if current.pendingRestore == nil {
		current.pendingRestore = map[rulesengine.Seat]bool{}
	}
	current.pendingRestore[seat] = true
}

type eventHeadStore interface {
	LastSequence(context.Context, string) (uint64, error)
}

func NewRuntime(
	rosters session.Resolver,
	matches MatchRepository,
	events rulesengine.EventStore,
	now func() time.Time,
) *Runtime {
	if now == nil {
		now = time.Now
	}
	return &Runtime{
		rosters: rosters,
		matches: matches,
		events:  events,
		now:     now,
		actors:  make(map[string]*loadedMatch),
		locks:   make(map[string]*sync.Mutex),
	}
}

func (r *Runtime) Join(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
) (TableView, error) {
	if r == nil || r.rosters == nil || r.matches == nil || r.events == nil {
		return TableView{}, fmt.Errorf("match runtime is not initialized")
	}
	if err := key.Validate(); err != nil {
		return TableView{}, err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return TableView{}, ErrNotMember
	}

	matchLock := r.matchLock(key.RuntimeID())
	matchLock.Lock()
	defer matchLock.Unlock()
	current, err := r.joinLocked(ctx, key, userID)
	if err != nil {
		return TableView{}, err
	}
	if err := r.refreshLocked(ctx, current.current); err != nil {
		return TableView{}, err
	}
	r.markPresentIfTakenOver(current.current, current.seat)
	if err := r.driveLocked(ctx, current.current); err != nil {
		return TableView{}, err
	}
	return r.settleAndView(ctx, current)
}

// joinLocked resolves the table a joining player belongs to, creating the
// match on first contact.
//
// A persisted rotation is authoritative: the mode is decided once, when the
// match is created, and cannot change under a match already being played.
func (r *Runtime) joinLocked(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
) (*table, error) {
	rotation, err := r.loadRotation(ctx, key)
	if err == nil {
		return r.seatInRotation(ctx, rotation, userID)
	}
	if !errors.Is(err, storage.ErrRotationNotFound) {
		return nil, err
	}

	record, err := r.matches.GetMatch(ctx, key)
	if errors.Is(err, storage.ErrMatchNotFound) {
		roster, rosterErr := r.rosters.Roster(ctx, key.Namespace, key.SessionID)
		if rosterErr != nil {
			return nil, rosterErr
		}
		if !contains(roster, userID) {
			return nil, ErrNotMember
		}
		mode, modeErr := r.rosters.Mode(ctx, key.Namespace, key.SessionID)
		if modeErr != nil {
			return nil, modeErr
		}
		if mode == session.ModeFullRotation {
			opened, openErr := r.openRotation(ctx, key, roster)
			if openErr != nil {
				return nil, openErr
			}
			return r.seatInRotation(ctx, opened, userID)
		}
		record, _, err = r.matches.EnsureMatch(ctx, key, roster)
	}
	if err != nil {
		return nil, err
	}
	loaded, err := r.loadLocked(ctx, record, handModeQuickPlay)
	if err != nil {
		return nil, err
	}
	seat, seated := loaded.record.Seats[userID]
	if !seated {
		return nil, ErrNotMember
	}
	return &table{current: loaded, seat: seat, userID: userID}, nil
}

// seatInRotation loads the actor for the rotation's current hand and finds the
// player's wind in it.
func (r *Runtime) seatInRotation(
	ctx context.Context,
	rotation *rotationTable,
	userID string,
) (*table, error) {
	loaded, err := r.loadLocked(ctx, rotation.hand.Match, handModeFullRotation)
	if err != nil {
		return nil, err
	}
	seat, seated := loaded.record.Seats[userID]
	if !seated {
		return nil, ErrNotMember
	}
	return &table{current: loaded, seat: seat, userID: userID, rotation: rotation}, nil
}

// loadTable resolves the table for a player who has already joined.
func (r *Runtime) loadTable(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
) (*table, error) {
	rotation, err := r.loadRotation(ctx, key)
	if err == nil {
		return r.seatInRotation(ctx, rotation, userID)
	}
	if !errors.Is(err, storage.ErrRotationNotFound) {
		return nil, err
	}
	loaded, seat, err := r.loadPersisted(ctx, key, userID)
	if err != nil {
		return nil, err
	}
	return &table{current: loaded, seat: seat, userID: strings.TrimSpace(userID)}, nil
}

// settleAndView folds a finished rotation hand into the standings, opens the
// next one when the result has been on screen long enough, and projects
// whichever hand the player should now be looking at.
func (r *Runtime) settleAndView(ctx context.Context, current *table) (TableView, error) {
	current, err := r.advanceLocked(ctx, current)
	if err != nil {
		return TableView{}, err
	}
	view, err := enrichedView(current.current.actor, current.seat, current.tier(), current.continuations())
	if err != nil {
		return TableView{}, err
	}
	projected := TableView{SeatView: view, HandRuntimeID: current.current.record.RuntimeID}
	if current.rotation != nil {
		rotationView, rotationErr := r.rotationView(current.rotation)
		if rotationErr != nil {
			return TableView{}, rotationErr
		}
		projected.Rotation = rotationView
	}
	return projected, nil
}

// advanceLocked is settleAndView's rotation half, separated so the view logic
// stays readable. It returns the table to serve, which becomes the next hand
// once the inter-hand pause has elapsed.
func (r *Runtime) advanceLocked(ctx context.Context, current *table) (*table, error) {
	if current.rotation == nil {
		return current, nil
	}
	advanced, err := r.foldCompletedHand(ctx, current.rotation, current.current)
	if err != nil {
		return nil, err
	}
	if advanced.hand.Index == current.rotation.hand.Index {
		current.rotation = advanced
		return current, nil
	}
	next, err := r.seatInRotation(ctx, advanced, current.userID)
	if err != nil {
		return nil, err
	}
	// The freshly opened hand needs the same opening treatment any match gets:
	// initial Flower replacement (done by loadLocked) and, if the dealer is a
	// taken-over seat, its first move.
	if err := r.driveLocked(ctx, next.current); err != nil {
		return nil, err
	}
	return next, nil
}

func (r *Runtime) View(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
) (TableView, error) {
	if r == nil {
		return TableView{}, ErrMatchNotLoaded
	}
	if err := key.Validate(); err != nil {
		return TableView{}, err
	}
	matchLock := r.matchLock(key.RuntimeID())
	matchLock.Lock()
	defer matchLock.Unlock()
	current, err := r.loadTable(ctx, key, userID)
	if err != nil {
		return TableView{}, err
	}
	if err := r.refreshLocked(ctx, current.current); err != nil {
		return TableView{}, err
	}
	r.markPresentIfTakenOver(current.current, current.seat)
	if err := r.driveLocked(ctx, current.current); err != nil {
		return TableView{}, err
	}
	return r.settleAndView(ctx, current)
}

func (r *Runtime) Apply(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
	command rulesengine.MatchCommand,
) (rulesengine.CommandResult, TableView, error) {
	if r == nil || strings.TrimSpace(command.RequestID) == "" {
		return rulesengine.CommandResult{}, TableView{}, ErrActionNotAllowed
	}
	if err := key.Validate(); err != nil {
		return rulesengine.CommandResult{}, TableView{}, err
	}
	matchLock := r.matchLock(key.RuntimeID())
	matchLock.Lock()
	defer matchLock.Unlock()
	table, err := r.loadTable(ctx, key, userID)
	if err != nil {
		return rulesengine.CommandResult{}, TableView{}, err
	}
	current, seat := table.current, table.seat
	if err := r.refreshLocked(ctx, current); err != nil {
		return rulesengine.CommandResult{}, TableView{}, err
	}
	r.markPresentIfTakenOver(current, seat)
	if err := r.driveLocked(ctx, current); err != nil {
		return rulesengine.CommandResult{}, TableView{}, err
	}

	command.MatchID = current.record.RuntimeID
	command.RequestID = "player:" + userID + ":" + command.RequestID
	command.Seat = seat
	if previous, found := current.actor.Previous(command.RequestID); found {
		if command.Type == rulesengine.CommandSubmitClaim {
			previous, err = r.resolveClaimResponse(ctx, current, previous)
			if err != nil {
				return previous, TableView{}, err
			}
			if err = r.driveLocked(ctx, current); err != nil {
				return previous, TableView{}, err
			}
		}
		view, err := r.settleAndView(ctx, table)
		return previous, view, err
	}
	view, err := current.actor.View(seat)
	if err != nil {
		return rulesengine.CommandResult{}, TableView{}, err
	}
	if command.ExpectedVersion != view.StateVersion {
		return rulesengine.CommandResult{}, TableView{}, rulesengine.ErrStaleAction
	}
	if err := authorizeCommand(view, seat, &command); err != nil {
		return rulesengine.CommandResult{}, TableView{}, err
	}
	result, err := current.actor.Apply(ctx, command)
	if err != nil {
		if errors.Is(err, rulesengine.ErrEventSequence) {
			restored, restoreErr := rulesengine.RestoreMatchActor(ctx, current.record.RuntimeID, r.events, r.now)
			if restoreErr != nil {
				return result, TableView{}, fmt.Errorf("restore after concurrent command: %w", restoreErr)
			}
			current.actor = restored
			if previous, found := restored.Previous(command.RequestID); found {
				view, viewErr := r.settleAndView(ctx, table)
				return previous, view, viewErr
			}
			return result, TableView{}, fmt.Errorf("%w: another replica committed first", rulesengine.ErrStaleAction)
		}
		return result, TableView{}, err
	}
	if command.Type == rulesengine.CommandSubmitClaim {
		result, err = r.resolveClaimResponse(ctx, current, result)
		if err != nil {
			return result, TableView{}, err
		}
		// A human Pass can leave bot-controlled eligible seats unanswered.
		// Finish those responses in this same request instead of making the
		// table wait for its next polling tick to call driveLocked.
		if err = r.driveLocked(ctx, current); err != nil {
			return result, TableView{}, err
		}
	}
	nextView, err := r.settleAndView(ctx, table)
	return result, nextView, err
}

func (r *Runtime) loadPersisted(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
) (*loadedMatch, rulesengine.Seat, error) {
	if r == nil || r.matches == nil || r.events == nil {
		return nil, "", ErrMatchNotLoaded
	}
	if err := key.Validate(); err != nil {
		return nil, "", err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, "", ErrNotMember
	}

	current := r.actor(key.RuntimeID())
	if current == nil {
		record, err := r.matches.GetMatch(ctx, key)
		if errors.Is(err, storage.ErrMatchNotFound) {
			return nil, "", ErrMatchNotLoaded
		}
		if err != nil {
			return nil, "", err
		}
		current, err = r.loadLocked(ctx, record, handModeQuickPlay)
		if err != nil {
			return nil, "", err
		}
	}
	seat, ok := current.record.Seats[userID]
	if !ok {
		return nil, "", ErrNotMember
	}
	return current, seat, nil
}

func (r *Runtime) resolveClaimResponse(
	ctx context.Context,
	current *loadedMatch,
	result rulesengine.CommandResult,
) (rulesengine.CommandResult, error) {
	resolved, err := resolveClaimsWhenReady(ctx, current.actor, result, r.now())
	if errors.Is(err, rulesengine.ErrClaimPending) {
		return result, nil
	}
	if !errors.Is(err, rulesengine.ErrEventSequence) {
		return resolved, err
	}
	restored, restoreErr := rulesengine.RestoreMatchActor(ctx, current.record.RuntimeID, r.events, r.now)
	if restoreErr != nil {
		return resolved, fmt.Errorf("restore after concurrent claim resolution: %w", restoreErr)
	}
	current.actor = restored
	resolved, err = resolveClaimsWhenReady(ctx, restored, result, r.now())
	if errors.Is(err, rulesengine.ErrClaimPending) {
		return result, nil
	}
	return resolved, err
}

// driveLocked lazily advances current toward its next human-actionable
// state (§5.10/§8.7/§11.1): committing an overdue turn's canonical
// auto-discard, resolving an overdue (or fully-answered) claim window, and
// playing any taken-over seat's move. It runs after every refreshLocked, so
// it fires speculatively on each client request; a premature attempt is
// rejected harmlessly by the engine's own deadline check, so calling it
// whether or not anything has actually expired is safe.
//
// This is lazy, request-triggered expiry, not a background ticker — a match
// nobody calls Join/View/Apply against again will not self-advance past a
// deadline on its own. In practice this is bounded by the other seats at
// the table continuing to interact with the match while waiting on an AFK
// player; a dedicated reaper is out of scope here.
//
// Rob windows and §5.9 offers are also driven here, because nothing else
// can drive them: the player command surface (authorizeCommand) does not
// accept rob/offer responses yet and no client UI exists for either (a
// pre-existing E2 gap). A bot-controlled seat's offer is accepted (§11.3:
// bots always take a win — both offer types are wins); everything else is
// declined/passed exactly as the §5.10 timeout path would have ruled, but
// without waiting — which is what makes untimed AI Practice matches (no
// TurnDeadline, sentinel claim/rob deadlines) unable to deadlock on them.
func (r *Runtime) driveLocked(ctx context.Context, current *loadedMatch) error {
	const dealer, prevailingWind = rulesengine.East, rulesengine.East
	const maxSteps = 16
	for step := 0; step < maxSteps; step++ {
		engine := current.actor.Peek()
		if engine == nil {
			return nil
		}
		version := engine.Version
		now := r.now()
		if !current.openingBotReadyAt.IsZero() {
			if now.Before(current.openingBotReadyAt) {
				return nil
			}
			// The grace period is strictly an opening presentation delay.
			// Clear it before driving so no later bot turn can inherit it.
			current.openingBotReadyAt = time.Time{}
		}

		if engine.TurnDeadline != nil && !now.Before(*engine.TurnDeadline) {
			switch engine.Phase {
			case rulesengine.PhaseAwaitingDraw, rulesengine.PhaseAwaitingDiscard, rulesengine.PhaseOfferPending:
				_, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
					MatchID:   current.record.RuntimeID,
					RequestID: "system:auto-discard:" + strconv.FormatUint(version, 10),
					Type:      rulesengine.CommandAutoDiscardExpiredTurn,
				})
				if err == nil {
					continue
				}
				if !errors.Is(err, rulesengine.ErrTurnNotExpired) {
					return err
				}
			}
		}

		if engine.Phase == rulesengine.PhaseClaimWindow && engine.Claim != nil {
			claim := engine.Claim
			fullyAnswered := len(claim.Responses) == len(claim.Eligible)
			if fullyAnswered || now.After(claim.Deadline) {
				// Same request ID scheme as resolveClaimsWhenReady, so this
				// stays idempotent whether resolution is triggered from
				// here or from a player's own claim response completing
				// the window.
				_, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
					MatchID:         current.record.RuntimeID,
					RequestID:       "server:resolve-claims:" + claim.ActionID,
					Type:            rulesengine.CommandResolveClaims,
					ExpectedVersion: claim.StateVersion,
				})
				if err != nil {
					return err
				}
				continue
			}
		}

		if engine.Phase == rulesengine.PhaseOfferPending {
			if offer := engine.Offer(); offer != nil {
				accept := engine.IsTakenOver(offer.Seat)
				// A bot-controlled seat always accepts (§11.3 always-win; both
				// §5.9 offer types are wins for the offered seat). A human's
				// offer is normally left to the §5.10 timeout branch above —
				// but when no turn deadline exists (untimed AI Practice, or a
				// Heavenly offer raised during initial replacement before any
				// deadline was ever set), nothing else can ever resolve it:
				// no player command surface or client UI accepts an offer
				// response yet. Decline exactly as the timeout would have —
				// Eight Flowers is re-offered on later turns (never
				// forfeited), Heavenly lapses (§5.9).
				if accept || engine.TurnDeadline == nil {
					_, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
						MatchID:         current.record.RuntimeID,
						RequestID:       "system:respond-offer:" + string(offer.Seat) + ":" + strconv.FormatUint(version, 10),
						Type:            rulesengine.CommandRespondOffer,
						Seat:            offer.Seat,
						ExpectedVersion: version,
						Accept:          accept,
					})
					if err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
						return err
					}
					continue
				}
			}
		}

		if engine.Phase == rulesengine.PhaseRobWindow {
			if rob := engine.Rob(); rob != nil {
				// Decline for every seat that has not answered — bot seats per
				// the documented Medium takeover scope (a legal outcome for a
				// player who simply doesn't rob), humans because no rob
				// command surface or client UI exists yet: waiting would add
				// nothing in a timed match and deadlock an untimed one.
				for _, seat := range rob.Eligible {
					if _, answered := rob.Responses[seat]; answered {
						continue
					}
					_, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
						MatchID:   current.record.RuntimeID,
						RequestID: "system:rob-decline:" + rob.ActionID + ":" + string(seat),
						Type:      rulesengine.CommandSubmitRob,
						Rob: &rulesengine.RobResponse{
							Seat:         seat,
							Win:          false,
							StateVersion: rob.StateVersion,
						},
					})
					// An already-expired window rejects late responses; that
					// is fine — resolution below succeeds on expiry alone.
					if err != nil && !errors.Is(err, rulesengine.ErrClaimDeadline) {
						return err
					}
				}
				_, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
					MatchID:         current.record.RuntimeID,
					RequestID:       "system:resolve-rob:" + rob.ActionID,
					Type:            rulesengine.CommandResolveRob,
					ExpectedVersion: rob.StateVersion,
				})
				if err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
					return err
				}
				continue
			}
		}

		acted := false
		for _, seat := range takeoverSeatOrder {
			if !engine.IsTakenOver(seat) {
				continue
			}
			if current.pendingRestore[seat] {
				// §8.7: the seat's rightful owner has been observed present
				// (Join/View/Apply succeeded while taken over) and this is
				// their next legal personal turn/claim opportunity — hand
				// control back now instead of driving another bot move.
				delete(current.pendingRestore, seat)
				_, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
					MatchID:   current.record.RuntimeID,
					RequestID: "system:restore-control:" + string(seat) + ":" + strconv.FormatUint(version, 10),
					Type:      rulesengine.CommandRestoreControl,
					Seat:      seat,
				})
				if err != nil {
					return err
				}
				acted = true
				break
			}
			command, err := bots.DecideTakeoverCommand(engine, seat, dealer, prevailingWind, 0, version)
			if err != nil {
				return fmt.Errorf("drive takeover seat %s: %w", seat, err)
			}
			if command == nil {
				continue
			}
			command.MatchID = current.record.RuntimeID
			command.RequestID = "system:takeover:" + string(seat) + ":" + strconv.FormatUint(version, 10)
			result, applyErr := current.actor.Apply(ctx, *command)
			if applyErr != nil && !errors.Is(applyErr, rulesengine.ErrHandComplete) {
				return applyErr
			}
			if command.Type == rulesengine.CommandSubmitClaim {
				if _, err := r.resolveClaimResponse(ctx, current, result); err != nil {
					return err
				}
			}
			acted = true
			break
		}
		if !acted {
			return nil
		}
	}
	return nil
}

func (r *Runtime) matchLock(runtimeID string) *sync.Mutex {
	r.mu.Lock()
	defer r.mu.Unlock()
	lock := r.locks[runtimeID]
	if lock == nil {
		lock = &sync.Mutex{}
		r.locks[runtimeID] = lock
	}
	return lock
}

func (r *Runtime) actor(runtimeID string) *loadedMatch {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.actors[runtimeID]
}

func (r *Runtime) refreshLocked(ctx context.Context, current *loadedMatch) error {
	var (
		head uint64
		err  error
	)
	if store, ok := r.events.(eventHeadStore); ok {
		head, err = store.LastSequence(ctx, current.record.RuntimeID)
	} else {
		var events []rulesengine.MatchEvent
		events, err = r.events.Events(ctx, current.record.RuntimeID)
		if len(events) > 0 {
			head = events[len(events)-1].Sequence
		}
	}
	if err != nil {
		return fmt.Errorf("read match event head: %w", err)
	}
	if head <= current.actor.Sequence() {
		return nil
	}
	current.actor, err = rulesengine.RestoreMatchActor(ctx, current.record.RuntimeID, r.events, r.now)
	if err != nil {
		return fmt.Errorf("refresh match actor: %w", err)
	}
	return nil
}

func (r *Runtime) loadLocked(
	ctx context.Context,
	record storage.MatchRecord,
	mode handMode,
) (*loadedMatch, error) {
	if current := r.actor(record.RuntimeID); current != nil {
		return current, nil
	}
	events, err := r.events.Events(ctx, record.RuntimeID)
	if err != nil {
		return nil, err
	}
	var actor *rulesengine.MatchActor
	if len(events) > 0 {
		actor, err = rulesengine.RestoreMatchActor(ctx, record.RuntimeID, r.events, r.now)
	} else {
		var seed uint64
		seed, err = rulesengine.NewSeed()
		if err == nil {
			dice := [2]uint8{uint8(seed%6) + 1, uint8((seed/6)%6) + 1}
			var deal *rulesengine.DealState
			deal, err = rulesengine.Deal(seed, dice)
			if err == nil {
				var engine *rulesengine.TurnEngine
				engine, err = rulesengine.NewTurnEngine(deal, r.now)
				if err == nil {
					var deadlines rulesengine.DeadlineConfig
					deadlines, err = deadlineConfigForHand(mode)
					if err == nil {
						engine.SetDeadlineConfig(deadlines)
					}
				}
				if err == nil {
					err = applyBotSeats(engine, record.Seats)
				}
				if err == nil {
					actor, err = rulesengine.NewMatchActor(ctx, record.RuntimeID, engine, r.events, r.now)
					if errors.Is(err, rulesengine.ErrEventSequence) {
						actor, err = rulesengine.RestoreMatchActor(ctx, record.RuntimeID, r.events, r.now)
					}
				}
			}
		}
	}
	if err != nil {
		return nil, fmt.Errorf("initialize match actor: %w", err)
	}
	if _, found := actor.Previous("server:initial-replacement"); !found {
		if _, err := actor.Apply(ctx, rulesengine.MatchCommand{
			MatchID:   record.RuntimeID,
			RequestID: "server:initial-replacement",
			Type:      rulesengine.CommandBeginInitialReplacement,
		}); err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
			if errors.Is(err, rulesengine.ErrEventSequence) {
				actor, err = rulesengine.RestoreMatchActor(ctx, record.RuntimeID, r.events, r.now)
			}
			if err != nil {
				return nil, fmt.Errorf("initialize match replacement: %w", err)
			}
		}
	}
	// Re-read after initialization because this call may have created the
	// actor and committed initial replacement events. A persisted takeover
	// command proves the opening bot has already acted, so a restarted
	// runtime must not introduce a second delay.
	committedEvents, eventsErr := r.events.Events(ctx, record.RuntimeID)
	if eventsErr != nil {
		return nil, fmt.Errorf("read initialized match events: %w", eventsErr)
	}
	var openingBotReadyAt time.Time
	openingBotAlreadyActed := false
	for _, event := range committedEvents {
		if strings.HasPrefix(event.RequestID, "system:takeover:"+string(matchDealer)+":") {
			openingBotAlreadyActed = true
			break
		}
	}
	engine := actor.Peek()
	if !openingBotAlreadyActed && len(committedEvents) > 0 && engine != nil &&
		engine.ActiveSeat == matchDealer && engine.IsTakenOver(matchDealer) {
		openingBotReadyAt = committedEvents[0].OccurredAt.Add(openingBotTurnDelay)
	}
	current := &loadedMatch{
		record:            record,
		actor:             actor,
		openingBotReadyAt: openingBotReadyAt,
		pendingRestore:    map[rulesengine.Seat]bool{},
	}
	r.mu.Lock()
	r.actors[record.RuntimeID] = current
	r.mu.Unlock()
	return current, nil
}

func authorizeCommand(view rulesengine.SeatView, seat rulesengine.Seat, command *rulesengine.MatchCommand) error {
	switch command.Type {
	case rulesengine.CommandDraw:
		if view.ActiveSeat != seat || view.Phase != rulesengine.PhaseAwaitingDraw {
			return ErrActionNotAllowed
		}
	case rulesengine.CommandDiscard:
		if view.ActiveSeat != seat || view.Phase != rulesengine.PhaseAwaitingDiscard {
			return ErrActionNotAllowed
		}
	case rulesengine.CommandSubmitClaim:
		if command.Claim == nil || view.Phase != rulesengine.PhaseClaimWindow || view.Claim == nil ||
			command.Claim.ActionID != view.Claim.ActionID || !seatIn(view.Claim.Eligible, seat) {
			return ErrActionNotAllowed
		}
		claim := *command.Claim
		claim.Seat = seat
		claim.ActionID = view.Claim.ActionID
		claim.StateVersion = view.StateVersion
		claim.TileIDs = append([]string(nil), claim.TileIDs...)
		command.Claim = &claim
	case rulesengine.CommandDeclareZimo:
		if view.ActiveSeat != seat || view.Phase != rulesengine.PhaseAwaitingDiscard ||
			view.SelfTurnOptions == nil || !view.SelfTurnOptions.CanWin {
			return ErrActionNotAllowed
		}
	case rulesengine.CommandDeclareConcealedKong:
		if view.ActiveSeat != seat || view.Phase != rulesengine.PhaseAwaitingDiscard ||
			view.SelfTurnOptions == nil ||
			!containsTileIDSet(view.SelfTurnOptions.ConcealedKongs, command.TileIDs) {
			return ErrActionNotAllowed
		}
		command.TileIDs = append([]string(nil), command.TileIDs...)
	case rulesengine.CommandDeclareAddedKong:
		if view.ActiveSeat != seat || view.Phase != rulesengine.PhaseAwaitingDiscard ||
			view.SelfTurnOptions == nil ||
			!containsTileID(view.SelfTurnOptions.AddedKongTileIDs, command.TileID) {
			return ErrActionNotAllowed
		}
	default:
		return ErrActionNotAllowed
	}
	return nil
}

func containsTileID(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func containsTileIDSet(options [][]string, requested []string) bool {
	if len(requested) != 4 {
		return false
	}
	requestedCounts := make(map[string]int, len(requested))
	for _, tileID := range requested {
		requestedCounts[tileID]++
	}
	for _, option := range options {
		if len(option) != len(requested) {
			continue
		}
		optionCounts := make(map[string]int, len(option))
		for _, tileID := range option {
			optionCounts[tileID]++
		}
		matches := true
		for tileID, count := range requestedCounts {
			if optionCounts[tileID] != count {
				matches = false
				break
			}
		}
		if matches {
			return true
		}
	}
	return false
}

func resolveClaimsWhenReady(
	ctx context.Context,
	actor *rulesengine.MatchActor,
	result rulesengine.CommandResult,
	now time.Time,
) (rulesengine.CommandResult, error) {
	claim := result.Snapshot.Claim
	if claim == nil {
		return result, nil
	}
	if len(claim.Responses) != len(claim.Eligible) && !now.After(claim.Deadline) {
		hasPongOrKong := false
		for _, response := range claim.Responses {
			if response.Type == rulesengine.ClaimPong || response.Type == rulesengine.ClaimKong {
				hasPongOrKong = true
				break
			}
		}
		if !hasPongOrKong {
			return result, nil
		}
	}
	requestID := "server:resolve-claims:" + claim.ActionID
	if previous, found := actor.Previous(requestID); found {
		return previous, nil
	}
	return actor.Apply(ctx, rulesengine.MatchCommand{
		MatchID:         result.Event.MatchID,
		RequestID:       requestID,
		Type:            rulesengine.CommandResolveClaims,
		ExpectedVersion: claim.StateVersion,
	})
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func seatIn(values []rulesengine.Seat, target rulesengine.Seat) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
