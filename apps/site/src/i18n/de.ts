// German copy (`\u2011` is a non-breaking hyphen, so Yu-Gi-Oh! never splits in a heading).
// This object defines the shape every locale must match (`Dict`); first-pass
// copy, the content pass is VB-16.
export const de = {
  meta: {
    lang: 'de',
    ogLocale: 'de_DE',
    title: 'Voidbinder · Eine App für deine ganze Kartensammlung',
    description:
      'Voidbinder sammelt Pokémon, Yu-Gi-Oh!, Magic: The Gathering und One Piece in einer Open-Source-App, mit deutschen Karten, Cardmarket-Preisen und Offline-Scanner.',
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
    title: 'Deine ganze Sammlung in einer Mappe.',
    lede: 'Voidbinder verwaltet Pokémon, Yu\u2011Gi\u2011Oh!, Magic: The Gathering und One Piece in einer App: mit deutschen Karten, Cardmarket-Preisen und einem Scanner, der auch ohne Netz funktioniert. Open Source, für iOS, Android und das Web.',
    primary: 'Auf die Warteliste',
    secondary: 'Quellcode ansehen',
    status: 'Pre-Alpha · Beta-Anmeldung offen',
    art: 'Fünf Karten, aufgefächert wie eine Hand',
  },
  problem: {
    label: 'Das Problem',
    title: 'Vier Spiele, vier Apps, vier Abos.',
    lede: 'Wer mehr als ein Spiel sammelt, verteilt seine Sammlung heute auf mehrere Apps. Jede kann ein bisschen, keine kann alles.',
    rows: [
      {
        term: 'Ein Spiel pro App',
        text: 'Die meisten Apps decken genau ein Kartenspiel ab. Wer zwei sammelt, pflegt zwei Listen und zwei Wunschzettel.',
      },
      {
        term: '5 bis 10 € im Monat',
        text: 'Scanner, Preisverlauf und Export stecken oft hinter einem Abo, und zwar pro App.',
      },
      {
        term: 'Nur Englisch und Japanisch',
        text: 'Deutsche Drucke fehlen oder werden der englischen Karte zugeschlagen, samt falschem Preis.',
      },
      {
        term: 'Nur im Browser',
        text: 'Ohne Netz kein Scanner und kein Katalog, ausgerechnet auf der Messe oder im Laden.',
      },
    ],
  },
  games: {
    label: 'Vier Spiele',
    title: 'Eine Mappe für Pokémon, Yu\u2011Gi\u2011Oh!, Magic und One Piece.',
    lede: 'Jede Karte bekommt ihr Fach, egal aus welchem Spiel. Sets, Sprachen und Varianten bleiben getrennt, die Sammlung bleibt eine.',
    list: [
      { name: 'Pokémon', note: 'Sets, Sprachen, Varianten' },
      { name: 'Yu-Gi-Oh!', note: 'Sets, Sprachen, Raritäten' },
      { name: 'Magic: The Gathering', note: 'Sets, Sprachen, Foils' },
      { name: 'One Piece', note: 'Sets, Sprachen, Parallels' },
    ],
    art: 'Eine Seite einer Sammelmappe mit neun Kartenfächern, die sich Reihe für Reihe füllen',
  },
  scanner: {
    label: 'Scanner',
    title: 'Scannt auch ohne Netz.',
    lede: 'Die Erkennung läuft auf deinem Gerät: Die Kamera findet die Karte, liest Nummer und Setkürzel und sucht im lokalen Katalog. Kein Upload, kein Warten auf einen Server.',
    facts: [
      { term: 'Erkennung', value: 'Texterkennung auf dem Gerät' },
      { term: 'Katalog', value: 'Lokal gespeichert, aktualisiert sich im WLAN' },
      { term: 'Netz', value: 'Nicht nötig' },
    ],
    screen: {
      status: 'Karte erkannt',
      code: 'SET · 025/198',
      action: 'Zur Sammlung',
    },
    art: 'Ein Handy-Bildschirm mit Kamerasucher, der eine Karte erkennt und ihre Nummer liest',
  },
  prices: {
    label: 'Preise',
    title: 'Preise von Cardmarket, in Euro.',
    lede: 'Für deutsche Karten zählt der europäische Markt. Voidbinder zeigt den Cardmarket-Preis jeder Variante und, wo es passt, TCGplayer in US-Dollar. Immer mit Quelle und Datum.',
    variantsLabel: 'Varianten',
    variants: [
      { name: 'Normal', price: '0,40 €' },
      { name: 'Reverse Holo', price: '1,20 €' },
      { name: 'Holo', price: '3,80 €' },
      { name: 'Erstauflage', price: '12,50 €' },
    ],
    chartSource: 'Cardmarket · Trendpreis · 09.10.2026',
    chartNote: 'Beispielwerte',
    chartLabel: 'Preisverlauf der Holo-Variante über 90 Tage, von 2,90 € auf 3,80 €',
    sourcesLabel: 'Quellen',
    sources: [
      { name: 'Cardmarket', note: 'Euro · Trendpreis' },
      { name: 'TCGplayer', note: 'US-Dollar · Marktpreis' },
    ],
  },
  deck: {
    label: 'Deckbuilder',
    title: 'Decks bauen mit dem, was du hast.',
    lede: 'Der Deckbuilder kennt deine Sammlung. Er zeigt, welche Karten schon in der Mappe liegen, was noch fehlt und was der Rest kostet.',
    facts: [
      { term: 'Formate', value: 'Je Spiel, mit Prüfung der Regeln' },
      { term: 'Abgleich', value: 'Gegen deine Sammlung, Fach für Fach' },
      { term: 'Fehlliste', value: 'Mit Cardmarket-Preisen' },
    ],
    screen: {
      title: 'Deck 1',
      owned: 'Vorhanden',
      missing: 'Fehlt',
      summary: 'Fehlt: 3 Karten · 7,60 €',
    },
    art: 'Eine Deckliste mit Anzahl je Karte, vorhandene und fehlende Karten markiert',
  },
  streamer: {
    label: 'Streamer Kit',
    title: 'Pack Openings live im Stream.',
    lede: 'Das Streamer Kit legt deine Pack Openings als Overlay über den Stream: Jede gezogene Karte erscheint mit Wert, dazu ein Zähler pro Pack. Entstanden aus der Monday Pack Attack auf Twitch.',
    link: 'Monday Pack Attack auf twitch.tv/derFrisson',
    overlay: {
      live: 'Live',
      pack: 'Pack 3 von 10',
      last: 'Letzte Karte',
      lastValue: '4,20 €',
      total: 'Wert bisher',
      totalValue: '18,40 €',
    },
    art: 'Ein Stream-Bild mit Overlay: Pack-Zähler, zuletzt gezogene Karte und Gesamtwert',
  },
  openSource: {
    label: 'Open Source',
    title: 'Offener Code, fairer Preis.',
    lede: 'Voidbinder steht unter der AGPL-3.0. Du kannst es selbst betreiben, ohne Abo. Wer das nicht will, nutzt die gehostete Version zu einem kleinen Preis, der den Betrieb deckt.',
    plans: [
      {
        name: 'Selbst betreiben',
        price: '0 €',
        text: 'Quellcode auf GitHub, AGPL-3.0. Deine Daten auf deinem Server.',
      },
      {
        name: 'Gehostet',
        price: 'Preis folgt',
        text: 'Wir betreiben Server, Backups und Preisdaten. Günstiger als die üblichen 5 bis 10 € im Monat.',
      },
    ],
    link: 'Quellcode auf GitHub',
  },
  voidcom: {
    label: 'Powered by Voidcom',
    title: 'Gebaut vom Team hinter Voidcom.',
    lede: 'Voidcom ist eine App für Sprache, Video und Chat aus Europa. Voidbinder teilt ihre Designsprache und ihren Anspruch: offene Technik, wenig Daten, keine Tricks.',
    link: 'voidcom.app besuchen',
  },
  waitlist: {
    title: 'Sei bei der Beta dabei.',
    lede: 'Trag dich ein, und wir schreiben dir, sobald die Beta startet.',
    emailLabel: 'E-Mail-Adresse',
    emailPlaceholder: 'du@beispiel.de',
    consentBefore:
      'Ich bin einverstanden, dass Voidbinder meine E-Mail-Adresse speichert, um mich über den Beta-Start zu informieren. Mehr in der ',
    consentLink: 'Datenschutzerklärung',
    consentAfter: '.',
    submit: 'Eintragen',
    honeypot: 'Website, bitte leer lassen',
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
