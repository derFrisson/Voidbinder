package voidbinder

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestCardKey(t *testing.T) {
	got, err := CardKey(GamePokemon, " SV1 ", "025")
	if want := "pokemon:sv1-025"; err != nil || got != want {
		t.Errorf("CardKey(pokemon, \" SV1 \", \"025\") = %q, %v, want %q, nil", got, err, want)
	}
	if _, err := CardKey(GameMTG, " ", "1"); !errors.Is(err, ErrEmptyCardKeyPart) {
		t.Errorf("CardKey(mtg, \" \", \"1\") error = %v, want %v", err, ErrEmptyCardKeyPart)
	}
}

func TestParseEmail(t *testing.T) {
	got, err := ParseEmail("  Ash@Example.COM ")
	if want := "ash@example.com"; err != nil || got != want {
		t.Errorf("ParseEmail(\"  Ash@Example.COM \") = %q, %v, want %q, nil", got, err, want)
	}
}

func TestParseEmailRejects(t *testing.T) {
	for _, in := range []string{
		"not-an-email",
		"a@b",
		".a@b.de",
		"a..b@c.de",
		strings.Repeat("a", 250) + "@x.de",
	} {
		if _, err := ParseEmail(in); !errors.Is(err, ErrInvalidEmail) {
			t.Errorf("ParseEmail(%q) error = %v, want %v", in, err, ErrInvalidEmail)
		}
	}
}

func TestLocaleValid(t *testing.T) {
	tests := []struct {
		locale Locale
		want   bool
	}{
		{"de", true},
		{"en", true},
		{"fr", false},
	}
	for _, tt := range tests {
		if got := tt.locale.Valid(); got != tt.want {
			t.Errorf("Locale(%q).Valid() = %t, want %t", tt.locale, got, tt.want)
		}
	}
}

func parseSignup(t *testing.T, body string) (WaitlistSignup, []Issue) {
	t.Helper()
	var w WaitlistSignup
	if err := json.Unmarshal([]byte(body), &w); err != nil {
		t.Fatalf("json.Unmarshal(%s) failed: %v", body, err)
	}
	return w, w.Validate()
}

func TestWaitlistSignupAccepts(t *testing.T) {
	tests := []struct {
		name      string
		body      string
		wantEmail string
	}{
		{"form post", `{"email":" Ash@Example.com ","locale":"de","consent":"on"}`, "ash@example.com"},
		{"json body", `{"email":"a@b.de","locale":"en","consent":true,"website":""}`, "a@b.de"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w, issues := parseSignup(t, tt.body)
			if len(issues) != 0 {
				t.Fatalf("Validate() = %v, want no issues", issues)
			}
			if w.Email != tt.wantEmail || !w.Consent {
				t.Errorf("signup = %+v, want email %q with consent", w, tt.wantEmail)
			}
		})
	}
}

func TestWaitlistSignupRejects(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"missing consent", `{"email":"a@b.de","locale":"de"}`},
		{"consent off", `{"email":"a@b.de","locale":"de","consent":"off"}`},
		{"bad locale", `{"email":"a@b.de","locale":"fr","consent":true}`},
		{"bad email", `{"email":"a@b","locale":"de","consent":true}`},
		{"long email", `{"email":"` + strings.Repeat("a", 250) + `@b.de","locale":"de","consent":true}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, issues := parseSignup(t, tt.body); len(issues) == 0 {
				t.Errorf("Validate() = no issues, want at least one")
			}
		})
	}
}
