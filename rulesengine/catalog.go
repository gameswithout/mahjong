package rulesengine

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

type TileKind string

const (
	Characters TileKind = "characters"
	Bamboo     TileKind = "bamboo"
	Dots       TileKind = "dots"
	Wind       TileKind = "wind"
	Dragon     TileKind = "dragon"
	Flower     TileKind = "flower"
)

type Tile struct {
	ID   string   `json:"id"`
	Kind TileKind `json:"kind"`
	Rank uint8    `json:"rank,omitempty"`
	Copy uint8    `json:"copy,omitempty"`
}

func (t Tile) IsFlower() bool {
	return t.Kind == Flower
}

func (t Tile) IsNumbered() bool {
	return t.Kind == Characters || t.Kind == Bamboo || t.Kind == Dots
}

func Catalog() []Tile {
	tiles := make([]Tile, 0, 144)
	for _, kind := range []TileKind{Characters, Bamboo, Dots} {
		for rank := uint8(1); rank <= 9; rank++ {
			for copyNumber := uint8(1); copyNumber <= 4; copyNumber++ {
				tiles = append(tiles, Tile{
					ID:   fmt.Sprintf("%s-%d-%d", kind, rank, copyNumber),
					Kind: kind,
					Rank: rank,
					Copy: copyNumber,
				})
			}
		}
	}

	for _, name := range []string{"east", "south", "west", "north"} {
		for copyNumber := uint8(1); copyNumber <= 4; copyNumber++ {
			tiles = append(tiles, Tile{
				ID:   fmt.Sprintf("wind-%s-%d", name, copyNumber),
				Kind: Wind,
				Copy: copyNumber,
			})
		}
	}

	for _, name := range []string{"red", "green", "white"} {
		for copyNumber := uint8(1); copyNumber <= 4; copyNumber++ {
			tiles = append(tiles, Tile{
				ID:   fmt.Sprintf("dragon-%s-%d", name, copyNumber),
				Kind: Dragon,
				Copy: copyNumber,
			})
		}
	}

	for _, name := range []string{
		"plum", "orchid", "chrysanthemum", "bamboo",
		"spring", "summer", "autumn", "winter",
	} {
		tiles = append(tiles, Tile{ID: "flower-" + name, Kind: Flower})
	}

	return tiles
}

func CatalogHash() string {
	encoded, _ := json.Marshal(Catalog())
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}
