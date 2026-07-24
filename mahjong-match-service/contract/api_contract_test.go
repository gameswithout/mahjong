package contract_test

import (
	"net/http"
	"testing"

	pb "github.com/gameswithout/mahjong/mahjong-match-service/pkg/pb"

	openapiv2 "github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-openapiv2/options"
	annotations "google.golang.org/genproto/googleapis/api/annotations"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
)

func TestMahjongServiceHTTPContract(t *testing.T) {
	t.Parallel()

	tests := []struct {
		method string
		verb   string
		path   string
	}{
		{
			method: "GetJadeAccount",
			verb:   http.MethodGet,
			path:   "/v1/namespaces/{namespace}/jade",
		},
		{
			method: "ReserveJade",
			verb:   http.MethodPost,
			path:   "/v1/namespaces/{namespace}/jade/reservation",
		},
		{
			method: "ReleaseJade",
			verb:   http.MethodDelete,
			path:   "/v1/namespaces/{namespace}/jade/reservation",
		},
		{
			method: "JoinMatch",
			verb:   http.MethodPost,
			path:   "/v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}/join",
		},
		{
			method: "GetMatchState",
			verb:   http.MethodGet,
			path:   "/v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}",
		},
		{
			method: "SubmitMatchCommand",
			verb:   http.MethodPost,
			path:   "/v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}/commands",
		},
	}

	service := pb.File_service_proto.Services().ByName("Service")
	if service == nil {
		t.Fatal("service.Service descriptor is missing")
	}
	if got, want := service.Methods().Len(), len(tests); got != want {
		t.Fatalf("RPC count: got %d, want %d", got, want)
	}

	for _, test := range tests {
		test := test
		t.Run(test.method, func(t *testing.T) {
			t.Parallel()

			method := service.Methods().ByName(protoreflect.Name(test.method))
			if method == nil {
				t.Fatalf("RPC %q is missing", test.method)
			}

			options, ok := method.Options().(*descriptorpb.MethodOptions)
			if !ok {
				t.Fatalf("RPC %q options have type %T", test.method, method.Options())
			}

			httpRule, ok := proto.GetExtension(options, annotations.E_Http).(*annotations.HttpRule)
			if !ok || httpRule == nil {
				t.Fatalf("RPC %q has no HTTP rule", test.method)
			}
			gotVerb, gotPath := httpBinding(httpRule)
			if gotVerb != test.verb || gotPath != test.path {
				t.Errorf("HTTP binding: got %s %s, want %s %s", gotVerb, gotPath, test.verb, test.path)
			}

			operation, ok := proto.GetExtension(options, openapiv2.E_Openapiv2Operation).(*openapiv2.Operation)
			if !ok || operation == nil {
				t.Fatalf("RPC %q has no OpenAPI operation", test.method)
			}
			if !requiresSecurity(operation, "Bearer") {
				t.Errorf("RPC %q does not require Bearer security", test.method)
			}
		})
	}
}

func TestMahjongCommandContract_DoesNotAcceptCallerIdentityOrSeat(t *testing.T) {
	for _, messageName := range []protoreflect.Name{
		"GetJadeAccountRequest",
		"ReserveJadeRequest",
		"ReleaseJadeRequest",
		"JoinMatchRequest",
		"GetMatchStateRequest",
		"SubmitMatchCommandRequest",
		"ClaimCommand",
	} {
		message := pb.File_service_proto.Messages().ByName(messageName)
		if message == nil {
			t.Fatalf("message %q is missing", messageName)
		}
		for _, forbidden := range []protoreflect.Name{"user_id", "player_id", "seat"} {
			if field := message.Fields().ByName(forbidden); field != nil {
				t.Errorf("%s accepts untrusted identity field %q", messageName, forbidden)
			}
		}
	}
}

func httpBinding(rule *annotations.HttpRule) (string, string) {
	switch pattern := rule.Pattern.(type) {
	case *annotations.HttpRule_Get:
		return http.MethodGet, pattern.Get
	case *annotations.HttpRule_Post:
		return http.MethodPost, pattern.Post
	case *annotations.HttpRule_Delete:
		return http.MethodDelete, pattern.Delete
	default:
		return "", ""
	}
}

func requiresSecurity(operation *openapiv2.Operation, scheme string) bool {
	for _, requirement := range operation.GetSecurity() {
		if _, ok := requirement.GetSecurityRequirement()[scheme]; ok {
			return true
		}
	}
	return false
}
