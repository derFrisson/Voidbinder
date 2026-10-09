// German copy, final from the approved mockup (docs/site/design-reference/b-der-scan.html).
// `\u2011` is a non-breaking hyphen, so Yu-Gi-Oh! never splits in a heading.
// This object defines the shape every locale must match (`Dict`). Card names, set names and
// card numbers of the invented example cards are proper names and live in the components.
export const de = {
  meta: {
    lang: 'de',
    ogLocale: 'de_DE',
    title: 'Voidbinder · Deine ganze Sammlung in einer App',
    description:
      'Pokémon, Yu-Gi-Oh!, Magic und One Piece in einer Mappe: scannen, bewerten, Decks bauen. Offline, auf Deutsch, mit Cardmarket-Preisen. Open Source, Warteliste offen.',
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
    streamer: 'Streamer',
    cta: 'Auf die Warteliste',
    ctaShort: 'Warteliste',
  },
  hero: {
    title: 'Deine ganze Sammlung. Eine App.',
    accent: 'Mit echten Preisen.',
    lede: 'Pokémon, Yu\u2011Gi\u2011Oh!, Magic und One\u00a0Piece in einer Mappe: scannen, bewerten, Decks bauen. Offline, auf Deutsch, mit Cardmarket-Preisen.',
    primary: 'Auf die Warteliste',
    secondary: 'Quellcode ansehen',
    trustLabel: 'Kurz gesagt',
    trust: ['Open Source', 'Aus Deutschland', 'Offline', '4 Spiele'],
    art: 'Handy scannt die Beispielkarte Glimmerfuchs und zeigt sie mit Preis an, dahinter eine Deckliste',
    callout: 'Ohne Netz erkannt',
    calloutNote: 'Bilderkennung läuft auf dem Handy',
    deck: {
      label: 'Deck',
      meta: '60/60 Karten · 41,70 €',
      tabs: ['Liste', 'Kurve', 'Preise'],
      support: 'Hilfe',
    },
    scan: {
      game: 'Pokémon',
      offline: 'Offline',
      detected: 'Erkannt',
      condition: 'Near Mint',
      language: 'DE',
      add: 'Zur Sammlung',
    },
    tabbar: ['Mappe', 'Decks', 'Scan', 'Profil'],
  },
  cards: {
    fox: {
      type: 'Funkenwesen · Stufe 1',
      attack: 'Funkensprung',
      flavor: 'Sein Schweif leuchtet, wenn er Fremde wittert.',
    },
    warden: {
      type: 'Schatten / Effekt',
      flavor: 'Wird er aufgedeckt, schweigt das Feld.',
      rule: 'Wird diese Karte aufgedeckt, kann für eine Runde keine Falle aktiviert werden.',
    },
    coral: {
      type: 'Wesen · Riffhüter',
      flavor: 'Sie wächst nur, wenn der Himmel bricht.',
      rule: 'Wenn ein Gewitter beginnt, erhält jede Koralle +1/+1.',
    },
    sail: {
      type: 'Crew · Hafenstadt',
      flavor: 'Wer gegen den Wind segelt, kommt als Erster an.',
    },
  },
  games: {
    label: 'Spiele',
    title: 'Vier Spiele, eine Mappe.',
    lede: 'Jedes Spiel hat seine eigenen Sets, Nummern und Varianten. Voidbinder kennt sie alle und sortiert deine Karten so, wie du sie im Ordner hast.',
    soon: 'Kommt später',
    list: [
      {
        name: 'Pokémon',
        text: 'Sets, Nummern und Varianten bis zum Reverse Holo, in deutscher und englischer Ausgabe.',
      },
      {
        name: 'Yu-Gi-Oh!',
        text: 'Seltenheiten und Erstauflagen erkennt der Scanner mit, damit dein Ordner richtig bewertet ist.',
      },
      {
        name: 'Magic: The Gathering',
        text: 'Foil oder nicht: alle Drucke einer Karte nebeneinander, mit Preis pro Edition.',
      },
      {
        name: 'One Piece',
        text: 'Steht auf der Liste. Sag uns bei der Anmeldung, wenn du darauf wartest.',
      },
    ],
  },
  scanner: {
    label: 'Scanner',
    title: 'Karte vor die Kamera, fertig.',
    lede: 'Kein Abtippen, keine Suche nach dem richtigen Set. Die App liest die Karte, findet den Druck und schlägt dir die passende Variante vor.',
    facts: [
      'Nummer und Set werden auf dem Handy erkannt',
      'Funktioniert ohne Netz',
      'Varianten mit Preis zur Auswahl',
    ],
    art: 'Kamerasucher erkennt die Beispielkarte Glimmerfuchs, Nummer 042/198, 3,20 Euro',
    live: 'Live-Erkennung',
    hudSet: 'Set: Funkenflug',
    variants: 'Varianten',
    prints: '3 Drucke',
    normal: 'Normal',
    holo: 'Holo',
    reverse: 'Reverse Holo',
  },
  prices: {
    label: 'Preise',
    title: 'Was ist deine Sammlung wert?',
    lede: 'Jede Karte bekommt ihren Tagespreis, die Mappe zählt mit. Du siehst auf einen Blick, was im Ordner steckt und welche Karte sich bewegt.',
    worth: 'Sammlungswert',
    count: '612 Karten in 3 Spielen',
    period: 'in 90 Tagen',
    fine: 'Preise von Cardmarket und TCGplayer, Stand des Tages. Zustandspreise sind Schätzungen. Karten und Werte auf dieser Seite sind Beispiele.',
    chartTitle: 'Preisverlauf, 90 Tage',
    chartSource: 'Cardmarket, Trend',
    chartLabel: 'Preis stieg in 90 Tagen von etwa 2,80 auf 3,20 Euro',
    chartStart: 'vor 90 Tagen',
    chartEnd: 'heute',
  },
  reseller: {
    label: 'Für Händler',
    title: 'Bestand in Minuten erfasst.',
    lede: 'Ankauf auf dem Tisch, Kiste aus dem Keller, Ware für den nächsten Markt: Karte für Karte unter die Kamera, die Liste schreibt sich selbst.',
    facts: [
      {
        title: 'Massenscan',
        text: 'Karten nacheinander unter die Kamera schieben. Die App zählt mit, erkennt Dubletten und legt Stapel an.',
      },
      {
        title: 'Preisverlauf pro Karte',
        text: 'Jede Karte im Bestand hat ihren Verlauf. Du siehst, was steigt, und entscheidest, wann du verkaufst.',
      },
      {
        title: 'Export als Cardmarket-CSV',
        text: 'Bestand als CSV im Cardmarket-Format, mit Zustand, Sprache und Anzahl. Hochladen statt abtippen.',
      },
    ],
    art: 'Massenscan in der App: 214 Karten erfasst, Liste mit Preisen, Export als Cardmarket-CSV',
    screen: {
      label: 'Massenscan',
      title: 'Stapel Oktober',
      status: 'Läuft, nächste Karte unter die Kamera',
      progress: '214 von ~300 Karten',
      firstEdition: '1. Aufl.',
      export: 'Als Cardmarket-CSV exportieren',
    },
  },
  streamer: {
    label: 'Streamer Kit',
    title: 'Pack Opening im Stream, jeder Pull mit Preis im Overlay.',
    lede: 'Ein Browser-Overlay für OBS: Du scannst die gezogene Karte, der Chat sieht Name, Preis und wie weit der Pack schon gegen den Boxpreis steht.',
    link: 'Monday Pack Attack auf Twitch',
    art: 'Beispiel eines Stream-Overlays: letzter Pull Nebelwächter für 18,40 Euro, gezogen 46,90 Euro von 89,00 Euro Boxpreis',
    overlay: {
      live: 'Live',
      viewers: '1.204 Zuschauer',
      last: 'Letzter Pull',
      total: 'Gezogen gegen Boxpreis',
      of: 'von',
      pack: 'Pack 7 von 18',
    },
  },
  openSource: {
    label: 'Open Source',
    title: 'Offen. Und trotzdem bequem.',
    lede: 'Der komplette Code liegt offen. Du kannst Voidbinder selbst betreiben oder uns den Server überlassen.',
    self: {
      label: 'Selbst hosten',
      text: 'Auf deinem Rechner, deinem NAS oder deinem Server. Deine Daten bleiben, wo du sie hinstellst, und du kannst jede Zeile nachlesen.',
      link: 'Quellcode ansehen',
    },
    hosted: {
      label: 'Gehostet',
      price: 'Weniger als ein Booster',
      period: 'im Monat.',
      text: 'Wir betreiben Server, Backups und den täglichen Preisabgleich in Deutschland. Du scannst einfach.',
      checks: ['Sync auf allen Geräten', 'Tägliche Preise', 'Backups', 'Server in Deutschland'],
    },
  },
  waitlist: {
    title: 'Sei bei der Beta dabei.',
    lede: 'Wir schreiben dir, sobald die Beta startet. Eine Mail, kein Newsletter.',
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
    label: 'Warteliste',
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
    poweredBy: 'Powered by',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    github: 'GitHub',
    twitch: 'Twitch',
    trademarks:
      'Pokémon, Yu-Gi-Oh!, Magic: The Gathering und One Piece sind Marken ihrer jeweiligen Inhaber. Voidbinder ist ein unabhängiges Projekt.',
    rights: '© 2026 Voidbinder · Betrieben in Deutschland',
  },
};

export type Dict = typeof de;
