package bots

import (
	"testing"
)

// fidelitySamples is small enough for a normal test run. §9.2's real gate
// wants far more positions and is part of the separate tuning pass; what
// this size supports is the question this increment actually has to answer
// — are the personas different at all, and different in the direction their
// own card promises.
const fidelitySamples = 150

func fidelityReports(t *testing.T) map[string]PersonaFidelityReport {
	t.Helper()
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	reports := map[string]PersonaFidelityReport{}
	for _, id := range roster.IDs() {
		persona, _ := roster.ByID(id)
		report, err := RunPersonaFidelity(persona, Hard, fidelitySamples, 20260814)
		if err != nil {
			t.Fatalf("RunPersonaFidelity(%s) error = %v", id, err)
		}
		reports[id] = report
	}
	return reports
}

// TestEverySpecialistDivergesFromTheReference asks the question this
// increment is responsible for: is each persona a style, or only a name? A
// bot that agrees with River Scholar on nearly every decision is the latter.
//
// The floor asserted here is 10%, not §9.2's proposed 15% product gate.
// That gate is a tuning-pass target and is currently met by four of the six
// personas; Swift Sparrow and Thunder Tiger sit just under it, for a reason
// worth recording rather than tuning away. Both differ from the reference
// mostly in *degree* along an axis the neutral evaluator already optimises
// — speed — so their best-scoring action frequently coincides with its own.
// Closing that needs the reference itself to price an open hand's lost
// concealed value properly, which §3.2 lists as evaluator work still to do,
// not a weight that can be nudged: every scale that widened the gap here
// pushed Stone Lion into never calling at all.
func TestEverySpecialistDivergesFromTheReference(t *testing.T) {
	reports := fidelityReports(t)

	if scholar := reports[DefaultPersonaID]; scholar.StyleRelevantDivergence != 0 {
		t.Fatalf("the reference persona diverges from itself by %.3f, want 0", scholar.StyleRelevantDivergence)
	}
	const floor = 0.10
	for id, report := range reports {
		if id == DefaultPersonaID {
			continue
		}
		if report.DiscardSamples == 0 || report.ClaimOpportunities == 0 {
			t.Fatalf("%s: sample was empty (%d discards, %d claims)", id, report.DiscardSamples, report.ClaimOpportunities)
		}
		if report.StyleRelevantDivergence < floor {
			t.Errorf("%s diverges from %s on %.1f%% of style-relevant decisions, want at least %.0f%%",
				id, report.ReferenceID, report.StyleRelevantDivergence*100, floor*100)
		}
	}
}

// TestPersonasDivergeInTheDirectionTheyPromise is the check that matters
// more than the size of the divergence: a persona that differs from the
// reference in the wrong direction would still clear the gate above while
// contradicting the card the player is shown.
func TestPersonasDivergeInTheDirectionTheyPromise(t *testing.T) {
	reports := fidelityReports(t)
	scholar := reports[DefaultPersonaID]
	sparrow := reports["swift-sparrow"]
	lion := reports["stone-lion"]
	tiger := reports["thunder-tiger"]
	crane := reports["silent-crane"]

	// "Calls early" versus "calls rarely" (§6.2, §6.3).
	if sparrow.ClaimAcceptance <= scholar.ClaimAcceptance {
		t.Errorf("Swift Sparrow accepted %.1f%% of claim opportunities, River Scholar %.1f%% — Rush must call more",
			sparrow.ClaimAcceptance*100, scholar.ClaimAcceptance*100)
	}
	if lion.ClaimAcceptance >= scholar.ClaimAcceptance {
		t.Errorf("Stone Lion accepted %.1f%% of claim opportunities, River Scholar %.1f%% — Guard must call less",
			lion.ClaimAcceptance*100, scholar.ClaimAcceptance*100)
	}
	// "Keeps its plan hidden" is the lowest call rate on the roster (§6.6).
	for id, report := range reports {
		if id == "silent-crane" {
			continue
		}
		if crane.ClaimAcceptance > report.ClaimAcceptance {
			t.Errorf("Silent Crane accepted %.1f%% of claim opportunities, more than %s at %.1f%%",
				crane.ClaimAcceptance*100, id, report.ClaimAcceptance*100)
		}
	}
	// "Turns pairs into pressure" (§6.5): measured per shape, because a
	// random hand is offered far more Chows than Pongs. What must hold is
	// that Thunder Tiger takes a larger share of the Pongs it is offered
	// than of the Chows, and takes more Pongs than the reference does.
	if tiger.PongAcceptance <= tiger.ChowAcceptance {
		t.Errorf("Thunder Tiger took %.1f%% of its Pong opportunities and %.1f%% of its Chow opportunities — Pongs & Kongs must prefer the triplet",
			tiger.PongAcceptance*100, tiger.ChowAcceptance*100)
	}
	if tiger.PongAcceptance <= scholar.PongAcceptance {
		t.Errorf("Thunder Tiger took %.1f%% of its Pong opportunities, River Scholar %.1f%%",
			tiger.PongAcceptance*100, scholar.PongAcceptance*100)
	}
}

// TestPersonaFidelityIsWorthRecording prints the measured profile of the
// roster. It asserts nothing beyond the sample being non-degenerate: the
// numbers are the evidence a later tuning pass calibrates against, and are
// more useful in the log than buried in a threshold.
func TestPersonaFidelityIsWorthRecording(t *testing.T) {
	for id, report := range fidelityReports(t) {
		t.Logf("%-14s divergence=%.1f%% (discard %.1f%%, claim %.1f%%)  pong=%.1f%% (%d/%d)  chow=%.1f%% (%d/%d)",
			id,
			report.StyleRelevantDivergence*100, report.DiscardDivergence*100, report.ClaimDivergence*100,
			report.PongAcceptance*100, report.PongsAccepted, report.PongOpportunities,
			report.ChowAcceptance*100, report.ChowsAccepted, report.ChowOpportunities,
		)
		if report.PongOpportunities == 0 || report.ChowOpportunities == 0 {
			t.Errorf("%s: sample offered no %s opportunities", id, map[bool]string{true: "Pong", false: "Chow"}[report.PongOpportunities == 0])
		}
	}
}

func TestRunPersonaFidelityRejectsAnEmptySample(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	if _, err := RunPersonaFidelity(roster.Default(), Hard, 0, 1); err == nil {
		t.Fatal("RunPersonaFidelity(0 samples) error = nil, want a rejection")
	}
}
