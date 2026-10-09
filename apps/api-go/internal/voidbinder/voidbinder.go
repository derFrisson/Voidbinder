package voidbinder

import (
	"errors"
	"strings"
)

type Game string

const (
	GamePokemon  Game = "pokemon"
	GameYugioh   Game = "yugioh"
	GameMTG      Game = "mtg"
	GameOnePiece Game = "onepiece"
)

func (g Game) Valid() bool {
	switch g {
	case GamePokemon, GameYugioh, GameMTG, GameOnePiece:
		return true
	}
	return false
}

type Locale string

const (
	LocaleDE Locale = "de"
	LocaleEN Locale = "en"
)

func (l Locale) Valid() bool {
	return l == LocaleDE || l == LocaleEN
}

var ErrEmptyCardKeyPart = errors.New("setCode and number are required")

func CardKey(game Game, setCode, number string) (string, error) {
	set := strings.ToLower(strings.TrimSpace(setCode))
	num := strings.ToLower(strings.TrimSpace(number))
	if set == "" || num == "" {
		return "", ErrEmptyCardKeyPart
	}
	return string(game) + ":" + set + "-" + num, nil
}
