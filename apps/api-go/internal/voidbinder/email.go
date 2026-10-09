package voidbinder

import (
	"errors"
	"regexp"
	"strings"
)

const maxEmailLength = 254

var (
	ErrInvalidEmail = errors.New("invalid email")

	emailPattern = regexp.MustCompile(`^[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)
)

func ParseEmail(s string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(s))
	switch {
	case len(email) > maxEmailLength,
		strings.HasPrefix(email, "."),
		strings.Contains(email, ".."),
		!emailPattern.MatchString(email):
		return "", ErrInvalidEmail
	}
	return email, nil
}
