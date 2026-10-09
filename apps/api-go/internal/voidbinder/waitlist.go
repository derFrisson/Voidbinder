package voidbinder

import (
	"bytes"
	"encoding/json"
	"fmt"
)

const WaitlistConsentVersion = "2026-10-09"

type WaitlistStatus string

const (
	WaitlistPending      WaitlistStatus = "pending"
	WaitlistConfirmed    WaitlistStatus = "confirmed"
	WaitlistUnsubscribed WaitlistStatus = "unsubscribed"
)

type Issue struct {
	Path    []any  `json:"path"`
	Message string `json:"message"`
}

type Consent bool

func (c *Consent) UnmarshalJSON(b []byte) error {
	switch {
	case bytes.Equal(b, []byte("true")), bytes.Equal(b, []byte(`"on"`)):
		*c = true
	default:
		*c = false
	}
	return nil
}

type WaitlistSignup struct {
	Email   string  `json:"email"`
	Locale  Locale  `json:"locale"`
	Consent Consent `json:"consent"`
	Website *string `json:"website,omitempty"`
}

func (w *WaitlistSignup) Validate() []Issue {
	var issues []Issue
	if email, err := ParseEmail(w.Email); err != nil {
		issues = append(issues, Issue{Path: []any{"email"}, Message: "Invalid email address"})
	} else {
		w.Email = email
	}
	if !w.Locale.Valid() {
		issues = append(issues, Issue{
			Path:    []any{"locale"},
			Message: fmt.Sprintf("Invalid option: expected one of %q|%q", LocaleDE, LocaleEN),
		})
	}
	if !w.Consent {
		issues = append(issues, Issue{Path: []any{"consent"}, Message: "consent"})
	}
	return issues
}

var _ json.Unmarshaler = (*Consent)(nil)
