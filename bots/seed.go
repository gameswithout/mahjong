package bots

import (
	mathrand "math/rand"
	"time"
)

// seedSequence derives a deterministic, independent sub-seed per decision
// from one recorded bot-randomness seed, so a whole hand's worth of
// decisions replays exactly from a single stored seed (§11.4) while each
// decision still gets its own random stream rather than reusing one PRNG
// state across unrelated choices.
type seedSequence struct {
	base uint64
}

func newSeedSequence(base uint64) seedSequence {
	return seedSequence{base: base}
}

// forStep mixes the base seed with a step index using splitmix64, a small
// well-distributed integer hash, so nearby step indices do not produce
// correlated seeds.
func (s seedSequence) forStep(step uint64) uint64 {
	z := s.base + step*0x9E3779B97F4A7C15
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
	z = (z ^ (z >> 27)) * 0x94D049BB133111EB
	return z ^ (z >> 31)
}

func (s seedSequence) rngForStep(step uint64) *mathrand.Rand {
	return mathrand.New(mathrand.NewSource(int64(s.forStep(step))))
}

// reactionDelay maps a seed deterministically into [min, max], matching
// §11.3's per-difficulty reaction-time ranges. It never sleeps — timing
// enforcement belongs to whichever caller schedules bot actions (E2).
func reactionDelay(seed uint64, min, max time.Duration) time.Duration {
	rng := mathrand.New(mathrand.NewSource(int64(seed)))
	span := max - min
	if span <= 0 {
		return min
	}
	return min + time.Duration(rng.Int63n(int64(span)))
}
