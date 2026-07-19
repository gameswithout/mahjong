package rulesengine

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	mathrand "math/rand"
	"sort"
)

const (
	StackCount       = 72
	TilesPerStack    = 2
	ReserveTileCount = 16
)

var (
	ErrWallExhausted = errors.New("wall exhausted")
	ErrReserveEmpty  = errors.New("replacement reserve exhausted")
	ErrInvalidDice   = errors.New("dice sum must be between 2 and 12")
	ErrInvalidWall   = errors.New("wall must contain exactly 144 tiles")
	ErrInvalidSeed   = errors.New("seed must be non-zero")
	ErrUnknownSeat   = errors.New("unknown seat")
)

type Seat string

const (
	East  Seat = "E"
	South Seat = "S"
	West  Seat = "W"
	North Seat = "N"
)

var seats = [...]Seat{East, South, West, North}

type Stack struct {
	Side  Seat    `json:"side"`
	Index int     `json:"index"`
	Tiles [2]Tile `json:"tiles"`
}

type Wall struct {
	tiles   []Tile
	front   int
	back    int
	reserve int
}

func NewWall(tiles []Tile, reserve int) (*Wall, error) {
	if len(tiles) != len(Catalog()) {
		return nil, ErrInvalidWall
	}
	if reserve < 0 || reserve >= len(tiles) {
		return nil, fmt.Errorf("invalid reserve size %d", reserve)
	}
	return &Wall{tiles: append([]Tile(nil), tiles...), reserve: reserve}, nil
}

func (w *Wall) Remaining() int {
	return len(w.tiles) - w.front - w.back
}

// DrawableRemaining counts the tiles either end may still remove before the
// fixed 16-tile boundary (§5.2). Front draws and replacements consume the same
// pool: the hand becomes exhaustible when exactly 16 tiles remain, however
// they were removed.
func (w *Wall) DrawableRemaining() int {
	drawable := w.Remaining() - w.reserve
	if drawable < 0 {
		return 0
	}
	return drawable
}

func (w *Wall) ReserveRemaining() int {
	return w.reserve
}

func (w *Wall) DrawFront() (Tile, error) {
	if w.Remaining() <= w.reserve {
		return Tile{}, ErrWallExhausted
	}

	tile := w.tiles[w.front]
	w.front++
	return tile, nil
}

// DrawBack removes a replacement tile from the deque back. The final 16 tiles
// are a boundary, not a replacement pool: a mandatory replacement required at
// the boundary ends the hand as an exhaustive draw (§5.2).
func (w *Wall) DrawBack() (Tile, error) {
	if w.Remaining() <= w.reserve {
		return Tile{}, ErrReserveEmpty
	}

	w.back++
	return w.tiles[len(w.tiles)-w.back], nil
}

func (w *Wall) Snapshot() wallSnapshot {
	return wallSnapshot{
		Tiles:            append([]Tile(nil), w.tiles...),
		Front:            w.front,
		Back:             w.back,
		ReserveRemaining: w.reserve,
	}
}

type wallSnapshot struct {
	Tiles            []Tile `json:"tiles"`
	Front            int    `json:"front"`
	Back             int    `json:"back"`
	ReserveRemaining int    `json:"reserve_remaining"`
}

type PlayerState struct {
	Seat    Seat   `json:"seat"`
	Hand    []Tile `json:"hand"`
	Exposed []Tile `json:"exposed"`
	Melds   []Meld `json:"melds,omitempty"`
}

type DealState struct {
	Seed        uint64        `json:"seed"`
	Dice        [2]uint8      `json:"dice"`
	CatalogHash string        `json:"catalog_hash"`
	WallHash    string        `json:"wall_hash"`
	Players     []PlayerState `json:"players"`
	Wall        *Wall         `json:"-"`
}

func NewSeed() (uint64, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return 0, err
	}
	seed := binary.BigEndian.Uint64(bytes[:])
	if seed == 0 {
		return 0, ErrInvalidSeed
	}
	return seed, nil
}

func ShuffledCatalog(seed uint64) ([]Tile, error) {
	if seed == 0 {
		return nil, ErrInvalidSeed
	}
	tiles := Catalog()
	rng := mathrand.New(mathrand.NewSource(int64(seed)))
	rng.Shuffle(len(tiles), func(i, j int) { tiles[i], tiles[j] = tiles[j], tiles[i] })
	return tiles, nil
}

func StackLayout(tiles []Tile) ([]Stack, error) {
	if len(tiles) != StackCount*TilesPerStack {
		return nil, ErrInvalidWall
	}

	stacks := make([]Stack, 0, StackCount)
	for index := 0; index < StackCount; index++ {
		side := seats[index/18]
		stacks = append(stacks, Stack{
			Side:  side,
			Index: index,
			Tiles: [2]Tile{tiles[index*2], tiles[index*2+1]},
		})
	}
	return stacks, nil
}

func BreakSide(diceSum int) (Seat, error) {
	if diceSum < 2 || diceSum > 12 {
		return "", ErrInvalidDice
	}
	return seats[(diceSum-1)%len(seats)], nil
}

func FlattenStacks(stacks []Stack, diceSum int) ([]Tile, error) {
	if len(stacks) != StackCount {
		return nil, ErrInvalidWall
	}
	if _, err := BreakSide(diceSum); err != nil {
		return nil, err
	}

	// The owner side is selected by ((s-1) mod 4)+1. Counting s stacks from
	// that side's right edge gives a deterministic break index; the later
	// engine work can attach physical wall coordinates without changing this
	// seeded sequence contract.
	start := ((diceSum - 1) % 4) * 18
	start = (start + diceSum - 1) % StackCount
	flattened := make([]Tile, 0, StackCount*TilesPerStack)
	for offset := 0; offset < StackCount; offset++ {
		stack := stacks[(start+offset)%StackCount]
		flattened = append(flattened, stack.Tiles[0], stack.Tiles[1])
	}
	return flattened, nil
}

func Deal(seed uint64, dice [2]uint8) (*DealState, error) {
	if seed == 0 {
		return nil, ErrInvalidSeed
	}
	if dice[0] < 1 || dice[0] > 6 || dice[1] < 1 || dice[1] > 6 {
		return nil, ErrInvalidDice
	}
	diceSum := int(dice[0]) + int(dice[1])
	if _, err := BreakSide(diceSum); err != nil {
		return nil, err
	}

	shuffled, err := ShuffledCatalog(seed)
	if err != nil {
		return nil, err
	}
	stacks, err := StackLayout(shuffled)
	if err != nil {
		return nil, err
	}
	wallTiles, err := FlattenStacks(stacks, diceSum)
	if err != nil {
		return nil, err
	}
	wall, err := NewWall(wallTiles, ReserveTileCount)
	if err != nil {
		return nil, err
	}

	players := make([]PlayerState, len(seats))
	for index, seat := range seats {
		players[index] = PlayerState{Seat: seat, Hand: make([]Tile, 0, 17), Exposed: []Tile{}, Melds: []Meld{}}
	}
	for pass := 0; pass < 4; pass++ {
		for playerIndex := range players {
			for draw := 0; draw < 4; draw++ {
				tile, err := wall.DrawFront()
				if err != nil {
					return nil, err
				}
				players[playerIndex].Hand = append(players[playerIndex].Hand, tile)
			}
		}
	}
	eastTile, err := wall.DrawFront()
	if err != nil {
		return nil, err
	}
	players[0].Hand = append(players[0].Hand, eastTile)
	for index := range players {
		sort.Slice(players[index].Hand, func(i, j int) bool { return players[index].Hand[i].ID < players[index].Hand[j].ID })
	}

	state := &DealState{
		Seed:        seed,
		Dice:        dice,
		CatalogHash: CatalogHash(),
		WallHash:    hashTiles(wallTiles),
		Players:     players,
		Wall:        wall,
	}
	return state, nil
}

func (s *DealState) SnapshotBytes() ([]byte, error) {
	if s == nil || s.Wall == nil {
		return nil, errors.New("deal state is incomplete")
	}
	return json.Marshal(struct {
		Seed        uint64        `json:"seed"`
		Dice        [2]uint8      `json:"dice"`
		CatalogHash string        `json:"catalog_hash"`
		WallHash    string        `json:"wall_hash"`
		Players     []PlayerState `json:"players"`
		Wall        wallSnapshot  `json:"wall"`
	}{s.Seed, s.Dice, s.CatalogHash, s.WallHash, s.Players, s.Wall.Snapshot()})
}

func (s *DealState) Hash() (string, error) {
	bytes, err := s.SnapshotBytes()
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(bytes)
	return hex.EncodeToString(digest[:]), nil
}

// ReplaceInitialFlowers performs the server-controlled initial replacement in
// East, South, West, North order. A replacement Flower is exposed and
// replaced again until a playable tile is obtained or the reserve boundary is
// reached. The returned playable tiles stay in the player's concealed hand.
func (s *DealState) ReplaceInitialFlowers() error {
	if s == nil || s.Wall == nil || len(s.Players) != len(seats) {
		return errors.New("deal state is incomplete")
	}

	for playerIndex := range s.Players {
		if err := s.replaceInitialFlowersFor(playerIndex); err != nil {
			return err
		}
	}
	return nil
}

// replaceInitialFlowersFor runs one seat's complete initial replacement
// sequence. The turn engine calls seats individually so an Eight Flowers offer
// can interrupt between seats (§5.9).
func (s *DealState) replaceInitialFlowersFor(playerIndex int) error {
	if s == nil || s.Wall == nil || playerIndex < 0 || playerIndex >= len(s.Players) {
		return errors.New("deal state is incomplete")
	}
	for {
		flowerIndex := -1
		for index, tile := range s.Players[playerIndex].Hand {
			if tile.IsFlower() {
				flowerIndex = index
				break
			}
		}
		if flowerIndex == -1 {
			break
		}

		flower := s.Players[playerIndex].Hand[flowerIndex]
		s.Players[playerIndex].Hand = append(
			s.Players[playerIndex].Hand[:flowerIndex],
			s.Players[playerIndex].Hand[flowerIndex+1:]...,
		)
		s.Players[playerIndex].Exposed = append(s.Players[playerIndex].Exposed, flower)

		replacement, err := s.Wall.DrawBack()
		if err != nil {
			return err
		}
		s.Players[playerIndex].Hand = append(s.Players[playerIndex].Hand, replacement)
	}
	sort.Slice(s.Players[playerIndex].Hand, func(i, j int) bool {
		return s.Players[playerIndex].Hand[i].ID < s.Players[playerIndex].Hand[j].ID
	})
	return nil
}

// ReplaceFlower exposes a Flower already drawn during play and returns the
// first playable replacement. Callers should append the returned tile to the
// active hand; chained bonus tiles are recorded in Exposed automatically.
func (s *DealState) ReplaceFlower(seat Seat, drawn Tile) (Tile, error) {
	if s == nil || s.Wall == nil {
		return Tile{}, errors.New("deal state is incomplete")
	}
	playerIndex := -1
	for index, player := range s.Players {
		if player.Seat == seat {
			playerIndex = index
			break
		}
	}
	if playerIndex == -1 {
		return Tile{}, ErrUnknownSeat
	}

	for drawn.IsFlower() {
		s.Players[playerIndex].Exposed = append(s.Players[playerIndex].Exposed, drawn)
		var err error
		drawn, err = s.Wall.DrawBack()
		if err != nil {
			return Tile{}, err
		}
	}
	return drawn, nil
}

func hashTiles(tiles []Tile) string {
	bytes, _ := json.Marshal(tiles)
	digest := sha256.Sum256(bytes)
	return hex.EncodeToString(digest[:])
}
