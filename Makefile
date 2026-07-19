# E0.F1: one entry point for both toolchains in this monorepo.
# `make build test` on a fresh clone builds and tests everything green.

.PHONY: build test build-go build-client test-go test-client vendor

build: build-go build-client

test: test-go test-client

build-go:
	go build ./...
	cd mahjong-match-service && go build ./...

build-client:
	npm ci
	npm run build

test-go:
	go vet ./...
	# bots is excluded from -race: it is CPU-bound simulation, not
	# concurrency-sensitive code, and the race detector's overhead there
	# is ~9x (28s -> 260s) for no correctness signal specific to this
	# package. The concurrency-relevant packages (server/match etc.) are
	# covered.
	go test $$(go list ./... | grep -v '/bots$$') -race -count=1
	go test ./bots/... -count=1
	cd mahjong-match-service && go vet ./... && go test ./... -race -count=1

test-client:
	npm test

# Regenerates mahjong-match-service's gitignored vendor/ bundle (used for
# its Docker image's hermetic -mod=vendor build) from the current
# rulesengine/bots source. Run this after touching either package and
# before building that module's image — see mahjong-match-service/Dockerfile.
vendor:
	cd mahjong-match-service && go mod vendor
