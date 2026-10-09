// German copy (`\u2011` is a non-breaking hyphen, so Yu-Gi-Oh! never splits in a heading).
// This object defines the shape every locale must match (`Dict`).
export const de = {
  meta: {
    lang: 'de',
    ogLocale: 'de_DE',
    title: 'Voidbinder · Sammel-App für vier Kartenspiele',
    description:
      'Voidbinder ist eine Open-Source-App für Pokémon, Yu-Gi-Oh!, Magic: The Gathering und One Piece. Sie hat einen Offline-Scanner und Preise mit Quelle und Datum. Pre-Alpha, Warteliste offen.',
  },
  a11y: {
    skip: 'Zum Inhalt springen',
    nav: 'Hauptnavigation',
    home: 'Voidbinder, zur Startseite',
    language: 'Sprache wählen',
    footer: 'Fußzeile',
  },
  nav: {
    games: 'Spiele',
    scanner: 'Scanner',
    prices: 'Preise',
    openSource: 'Open Source',
    cta: 'Warteliste',
  },
  hero: {
    title: 'Die Sammel-App für vier Kartenspiele, offline und mit Preisen.',
    lede: 'Voidbinder verwaltet Pokémon, Yu‑Gi‑Oh!, Magic: The Gathering und später One\u00a0Piece. Der Scanner arbeitet auf deinem Gerät, jeder Preis nennt Quelle und Datum.',
    primary: 'Auf die Warteliste',
    secondary: 'Quellcode ansehen',
    status: 'Pre-Alpha · Noch kein Download',
    poweredBy: 'powered by Voidcom',
    art: 'Fünf Karten, aufgefächert wie eine Hand',
  },
  problem: {
    label: 'Das Problem',
    title: 'Deine Sammlung liegt verstreut.',
    lede: 'Wer mehrere Kartenspiele sammelt, braucht heute oft mehrere Apps. Keine davon kann alles.',
    rows: [
      {
        term: 'Ein Spiel pro App',
        text: 'Die meisten Apps decken ein Kartenspiel ab. Wer zwei sammelt, pflegt zwei Listen.',
      },
      {
        term: '5 bis 10 € im Monat',
        text: 'Scanner und Preisverlauf stecken oft hinter einem Abo, und das gilt pro App.',
      },
      {
        term: 'Nur Englisch und Japanisch',
        text: 'Deutsche Karten fehlen oft oder tragen den Preis der englischen.',
      },
      {
        term: 'Nur im Browser',
        text: 'Ohne Netz geht nichts: kein Scanner, kein Katalog, ausgerechnet auf der Messe oder im Laden.',
      },
    ],
  },
  games: {
    label: 'Vier Spiele',
    title: 'Vier Spiele in einer Sammlung.',
    lede: 'Eine Mappe statt vier Apps. One Piece kommt später, die anderen drei zuerst.',
    list: [
      { name: 'Pokémon', note: 'Geplant für den Start' },
      { name: 'Yu-Gi-Oh!', note: 'Geplant für den Start' },
      { name: 'Magic: The Gathering', note: 'Geplant für den Start' },
      { name: 'One Piece', note: 'Kommt später' },
    ],
    art: 'Eine Seite einer Sammelmappe mit neun Kartenfächern, die sich Reihe für Reihe füllen',
  },
  scanner: {
    label: 'Scanner',
    title: 'Ein Scanner, der kein Netz braucht.',
    lede: 'Die Kamera erkennt die Karte, liest Nummer und Setkürzel und sucht im Katalog auf deinem Gerät.',
    facts: [
      { term: 'Erkennung', value: 'Karte, Nummer und Setkürzel werden auf dem Gerät gelesen' },
      { term: 'Katalog', value: 'Liegt lokal auf dem Gerät, ohne Netz nutzbar' },
      { term: 'Varianten', value: 'Die Auswahl zeigt alle Varianten mit Preis' },
      {
        term: 'Preisabstand',
        value: 'Große Unterschiede zwischen Varianten lösen eine Warnung aus',
      },
      { term: 'Fotos', value: 'Bleiben auf deinem Gerät' },
    ],
    screen: {
      status: 'Karte erkannt',
      code: 'SET · 025/198',
      action: 'Variante wählen',
    },
    art: 'Ein Handy-Bildschirm mit Kamerasucher, der eine Karte erkennt und ihre Nummer liest',
  },
  prices: {
    label: 'Preise',
    title: 'Jeder Preis nennt Quelle und Datum.',
    lede: 'Die Preise kommen von TCGplayer, als tägliche Daten. Cardmarket ist geplant, abhängig von den Nutzungsbedingungen.',
    variantsLabel: 'Varianten',
    variants: [
      { name: 'Normal', price: '0,40 $' },
      { name: 'Reverse Holo', price: '1,20 $' },
      { name: 'Holo', price: '3,80 $' },
      { name: 'Erstauflage', price: '12,50 $' },
    ],
    chartSource: 'TCGplayer · Marktpreis · 09.10.2026',
    chartNote: 'Beispielwerte',
    chartLabel: 'Preisverlauf der Holo-Variante über 90 Tage, von 2,90 $ auf 3,80 $',
    sourcesLabel: 'Quellen',
    sources: [
      { name: 'TCGplayer', note: 'US-Dollar · tägliche Daten' },
      { name: 'Cardmarket', note: 'Euro · geplant, abhängig von den Bedingungen' },
    ],
    estimate: 'Preise für einzelne Zustände sind Schätzungen.',
  },
  deck: {
    label: 'Deckbuilder',
    title: 'Decks bauen mit dem, was du hast.',
    lede: 'Der Deckbuilder kennt die Regeln je Spiel und deine Sammlung. Er zeigt, was dir fehlt und was der Rest kostet.',
    facts: [
      { term: 'Regeln', value: 'Je Spiel eigene Deckregeln' },
      { term: 'Formate', value: 'Legalität je Format, soweit die Daten es hergeben' },
      { term: 'Abgleich', value: 'Gegen deine Sammlung' },
      { term: 'Fehlliste', value: 'Was fehlt und was der Rest kostet' },
    ],
    screen: {
      title: 'Deck 1',
      owned: 'Vorhanden',
      missing: 'Fehlt',
      summary: 'Fehlt: 3 Karten · 7,60 $',
    },
    art: 'Eine Deckliste mit Anzahl je Karte, vorhandene und fehlende Karten markiert',
  },
  streamer: {
    label: 'Streamer Kit',
    title: 'Pack Openings live im Stream.',
    lede: 'Dein Handy filmt die Karten, OBS bringt sie in den Stream. Das Streamer Kit entsteht für die Monday Pack Attack auf Twitch.',
    facts: [
      { term: 'Kamera', value: 'Das Handy dient als Kamera für OBS' },
      { term: 'Erkennung', value: 'Gezogene Karten werden live erkannt' },
      { term: 'Overlay', value: 'Karte und Wert erscheinen als Overlay im Stream' },
      { term: 'Summe', value: 'Laufender Wert gegen den Boxpreis' },
      { term: 'Chat', value: 'Befehle im Twitch-Chat' },
    ],
    link: 'Monday Pack Attack auf twitch.tv/derFrisson',
    overlay: {
      live: 'Live',
      pack: 'Pack 3 von 10',
      last: 'Letzte Karte',
      lastValue: '4,20 $',
      total: 'Wert bisher',
      totalValue: '18,40 $',
      box: 'Boxpreis',
      boxValue: '120,00 $',
    },
    caption: 'Beispielwerte, kein echter Stream.',
    art: 'Ein Stream-Bild mit Overlay: Pack-Zähler, zuletzt gezogene Karte, Wert bisher und Boxpreis',
  },
  openSource: {
    label: 'Open Source',
    title: 'Offener Code, kleiner Preis.',
    lede: 'Voidbinder steht unter der AGPL-3.0 auf GitHub. Du kannst es selbst betreiben.',
    plans: [
      {
        name: 'Selbst betreiben',
        price: '0 €',
        text: 'Quellcode auf GitHub unter AGPL-3.0. Server und Daten gehören dir.',
      },
      {
        name: 'Gehostet',
        price: 'Preis folgt',
        text: 'Wir betreiben es für dich. Es soll günstig werden, ein Preis steht noch nicht fest.',
      },
    ],
    scryfall: 'Daten von Scryfall liegen nie hinter einer Bezahlschranke.',
    link: 'Quellcode auf GitHub',
  },
  waitlist: {
    title: 'Trag dich für die Beta ein.',
    lede: 'Du bekommst eine Mail zur Bestätigung und eine, sobald es etwas zu testen gibt.',
    emailLabel: 'E-Mail-Adresse',
    emailPlaceholder: 'du@beispiel.de',
    consentBefore:
      'Ich bin einverstanden, dass Voidbinder meine E-Mail-Adresse speichert, um mich über den Beta-Start zu informieren. Mehr in der ',
    consentLink: 'Datenschutzerklärung',
    consentAfter: '.',
    submit: 'Eintragen',
    sending: 'Wird gesendet',
    honeypot: 'Website, bitte leer lassen',
    errors: {
      email: 'Diese E-Mail-Adresse sieht nicht richtig aus. Bitte prüfe sie.',
      consent: 'Bitte setze den Haken, sonst dürfen wir deine Adresse nicht speichern.',
      rate: 'Zu viele Versuche. Bitte warte eine Minute.',
      server: 'Das hat nicht geklappt. Bitte versuche es später noch einmal.',
    },
  },
  status: {
    home: 'Zur Startseite',
    pending: {
      title: 'Schau in dein Postfach.',
      text: 'Wir haben dir eine Mail geschickt. Klicke auf den Link darin, um die Anmeldung zu bestätigen. Der Link gilt 7 Tage. Nichts angekommen? Prüfe den Spam-Ordner.',
    },
    confirmed: {
      title: 'Du bist auf der Warteliste.',
      text: 'Danke. Wir schreiben dir, sobald es etwas zu testen gibt. Abmelden kannst du dich über den Link in jeder Mail.',
    },
    unsubscribed: {
      title: 'Du bist abgemeldet.',
      text: 'Wir schreiben dir nicht mehr. Du kannst dich jederzeit wieder eintragen.',
    },
    expired: {
      title: 'Dieser Link gilt nicht mehr.',
      text: 'Er ist abgelaufen oder wurde durch einen neueren ersetzt. Trag dich bitte noch einmal ein.',
      action: 'Noch einmal eintragen',
    },
    error: {
      email: {
        title: 'Die E-Mail-Adresse stimmt nicht.',
        text: 'Bitte prüfe sie und versuche es noch einmal.',
      },
      consent: {
        title: 'Wir brauchen deine Einwilligung.',
        text: 'Ohne den Haken dürfen wir deine Adresse nicht speichern.',
      },
      server: {
        title: 'Das hat nicht geklappt.',
        text: 'Bei uns ist etwas schiefgelaufen. Bitte versuche es später noch einmal.',
      },
      action: 'Zurück zum Formular',
    },
    unsubscribe: {
      title: 'Von der Warteliste abmelden?',
      text: 'Mit einem Klick bist du abgemeldet und bekommst keine Mails mehr von uns.',
      button: 'Abmelden',
      invalid: 'Dieser Abmelde-Link ist unvollständig. Nutze bitte den Link aus der Mail.',
    },
  },
  footer: {
    tagline: 'Open-Source-App für Sammelkarten.',
    poweredBy: 'powered by Voidcom',
    linksLabel: 'Links',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    github: 'GitHub',
    twitch: 'Twitch',
    license: 'Quellcode unter AGPL-3.0',
    trademarks:
      'Pokémon, Yu-Gi-Oh!, Magic: The Gathering und One Piece sind Marken ihrer jeweiligen Inhaber. Voidbinder steht mit ihnen in keiner Verbindung.',
  },
};

export type Dict = typeof de;
