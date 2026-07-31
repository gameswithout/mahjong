package match

import "testing"

func TestDeadlineConfigForHandUsesProductPreset(t *testing.T) {
	tests := []struct {
		name         string
		mode         handMode
		turnSeconds  int
		claimSeconds int
	}{
		{
			name:         "Bamboo Quick Play",
			mode:         handModeQuickPlay,
			turnSeconds:  15,
			claimSeconds: 10,
		},
		{
			name:         "ranked Full Rotation",
			mode:         handModeFullRotation,
			turnSeconds:  12,
			claimSeconds: 5,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config, err := deadlineConfigForHand(test.mode)
			if err != nil {
				t.Fatalf("deadlineConfigForHand() error = %v", err)
			}
			if config.TurnSeconds != test.turnSeconds {
				t.Fatalf("TurnSeconds = %d, want %d", config.TurnSeconds, test.turnSeconds)
			}
			if config.InterceptSeconds != test.claimSeconds {
				t.Fatalf(
					"InterceptSeconds = %d, want %d",
					config.InterceptSeconds,
					test.claimSeconds,
				)
			}
		})
	}
}

func TestDeadlineConfigForHandRejectsUnknownMode(t *testing.T) {
	if _, err := deadlineConfigForHand(handMode(255)); err == nil {
		t.Fatal("deadlineConfigForHand() error = nil, want unknown-mode error")
	}
}
