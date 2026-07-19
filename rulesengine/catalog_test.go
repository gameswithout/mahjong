package rulesengine

import (
	"encoding/json"
	"testing"
)

func TestCatalogHasStableMahjongCounts(t *testing.T) {
	tiles := Catalog()
	if len(tiles) != 144 {
		t.Fatalf("catalog length = %d, want 144", len(tiles))
	}

	counts := map[TileKind]int{}
	ids := map[string]struct{}{}
	for _, tile := range tiles {
		counts[tile.Kind]++
		if _, exists := ids[tile.ID]; exists {
			t.Fatalf("duplicate tile ID %q", tile.ID)
		}
		ids[tile.ID] = struct{}{}
	}
	want := map[TileKind]int{Characters: 36, Bamboo: 36, Dots: 36, Wind: 16, Dragon: 12, Flower: 8}
	for kind, count := range want {
		if counts[kind] != count {
			t.Fatalf("%s count = %d, want %d", kind, counts[kind], count)
		}
	}
	if CatalogHash() == "" {
		t.Fatal("CatalogHash() returned empty hash")
	}
}

func TestCatalogRoundTripsAsStableJSON(t *testing.T) {
	encoded, err := json.Marshal(Catalog())
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	var decoded []Tile
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if len(decoded) != 144 || decoded[0] != Catalog()[0] {
		t.Fatalf("catalog did not round-trip deterministically")
	}
}
