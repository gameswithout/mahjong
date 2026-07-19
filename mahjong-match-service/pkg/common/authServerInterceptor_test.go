package common

import (
	"context"
	"encoding/base64"
	"errors"
	"testing"

	"github.com/AccelByte/accelbyte-go-sdk/services-api/pkg/service/iam"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type fakeTokenValidator struct {
	err       error
	validated bool
}

func (v *fakeTokenValidator) Initialize(...context.Context) error { return nil }

func (v *fakeTokenValidator) Validate(
	string,
	*iam.Permission,
	*string,
	*string,
) error {
	v.validated = true
	return v.err
}

func TestUnaryAuthInterceptor_AttachesValidatedSubject(t *testing.T) {
	previous := Validator
	validator := &fakeTokenValidator{}
	Validator = validator
	t.Cleanup(func() { Validator = previous })

	token := testJWT(`{"sub":"user-123"}`)
	ctx := metadata.NewIncomingContext(
		context.Background(),
		metadata.Pairs("authorization", "Bearer "+token),
	)
	interceptor := NewUnaryAuthServerIntercept()
	_, err := interceptor(
		ctx,
		nil,
		&grpc.UnaryServerInfo{FullMethod: "/service.Service/JoinMatch"},
		func(ctx context.Context, _ any) (any, error) {
			principal, ok := PrincipalFromContext(ctx)
			if !ok || principal.UserID != "user-123" {
				t.Fatalf("principal = %#v, %v", principal, ok)
			}
			return nil, nil
		},
	)
	if err != nil {
		t.Fatalf("interceptor() error = %v", err)
	}
	if !validator.validated {
		t.Fatal("token validator was not called")
	}
}

func TestUnaryAuthInterceptor_AttachesSubjectFromCookie(t *testing.T) {
	previous := Validator
	validator := &fakeTokenValidator{}
	Validator = validator
	t.Cleanup(func() { Validator = previous })

	token := testJWT(`{"sub":"cookie-user"}`)
	ctx := metadata.NewIncomingContext(
		context.Background(),
		metadata.Pairs("cookie", "theme=dark; access_token="+token),
	)
	_, err := NewUnaryAuthServerIntercept()(
		ctx,
		nil,
		&grpc.UnaryServerInfo{FullMethod: "/service.Service/GetMatchState"},
		func(ctx context.Context, _ any) (any, error) {
			principal, ok := PrincipalFromContext(ctx)
			if !ok || principal.UserID != "cookie-user" {
				t.Fatalf("principal = %#v, %v", principal, ok)
			}
			return nil, nil
		},
	)
	if err != nil {
		t.Fatalf("interceptor() error = %v", err)
	}
	if !validator.validated {
		t.Fatal("cookie token validator was not called")
	}
}

func TestUnaryAuthInterceptor_RejectsTokenWithoutSubject(t *testing.T) {
	previous := Validator
	Validator = &fakeTokenValidator{}
	t.Cleanup(func() { Validator = previous })

	ctx := metadata.NewIncomingContext(
		context.Background(),
		metadata.Pairs("authorization", "Bearer "+testJWT(`{"client_id":"client"}`)),
	)
	_, err := NewUnaryAuthServerIntercept()(
		ctx,
		nil,
		&grpc.UnaryServerInfo{FullMethod: "/service.Service/JoinMatch"},
		func(context.Context, any) (any, error) {
			t.Fatal("handler must not run")
			return nil, nil
		},
	)
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("interceptor() code = %s, want Unauthenticated", status.Code(err))
	}
}

func TestUnaryAuthInterceptor_RejectsFailedValidation(t *testing.T) {
	previous := Validator
	Validator = &fakeTokenValidator{err: errors.New("invalid token")}
	t.Cleanup(func() { Validator = previous })

	ctx := metadata.NewIncomingContext(
		context.Background(),
		metadata.Pairs("authorization", "Bearer "+testJWT(`{"sub":"user-123"}`)),
	)
	_, err := NewUnaryAuthServerIntercept()(
		ctx,
		nil,
		&grpc.UnaryServerInfo{FullMethod: "/service.Service/JoinMatch"},
		func(context.Context, any) (any, error) {
			t.Fatal("handler must not run")
			return nil, nil
		},
	)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("interceptor() code = %s, want PermissionDenied", status.Code(err))
	}
}

func TestPrincipalContext_RoundTripsValidatedIdentity(t *testing.T) {
	ctx := ContextWithPrincipal(context.Background(), Principal{UserID: "user-123"})
	principal, ok := PrincipalFromContext(ctx)
	if !ok || principal.UserID != "user-123" {
		t.Fatalf("PrincipalFromContext() = %#v, %v", principal, ok)
	}
	if _, ok := PrincipalFromContext(context.Background()); ok {
		t.Fatal("empty context unexpectedly contained a principal")
	}
}

func TestTokenSubject_RejectsMalformedJWT(t *testing.T) {
	tests := []string{
		"not-a-jwt",
		"header.invalid-base64!.signature",
		testJWT(`{"sub":" "}`),
	}
	for _, token := range tests {
		if subject, err := tokenSubject(token); err == nil {
			t.Errorf("tokenSubject(%q) = %q, want error", token, subject)
		}
	}
}

func FuzzTokenSubject_NeverReturnsBlankOnSuccess(f *testing.F) {
	f.Add("not-a-jwt")
	f.Add(testJWT(`{"sub":"user-123"}`))
	f.Add(testJWT(`{"sub":""}`))
	f.Fuzz(func(t *testing.T, token string) {
		subject, err := tokenSubject(token)
		if err == nil && subject == "" {
			t.Fatal("tokenSubject() succeeded with an empty subject")
		}
	})
}

func testJWT(payload string) string {
	encode := base64.RawURLEncoding.EncodeToString
	return encode([]byte(`{"alg":"none"}`)) + "." + encode([]byte(payload)) + ".signature"
}
