---
title: Datenschutzerklärung
description: Welche personenbezogenen Daten voidbinder.de und die Web-App von Voidbinder verarbeiten, warum, wie lange und welche Rechte Sie haben.
updated: '2026-10'
---

<!-- Stand des Entwurfs: 2026-10-10 (VB-62). Das Frontmatter-Feld `updated` erlaubt nur Jahr und Monat. -->

## Verantwortlicher

Verantwortlich für die Datenverarbeitung auf dieser Website und in der Web-App von Voidbinder im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:

Maximilian Tschauder\
Hauptstraße 25\
88630 Pfullendorf, Deutschland\
E-Mail: max@voidcom.app

Für Fragen zu Ihrem Konto in der Web-App erreichen Sie uns auch unter hello@voidbinder.de.

## Überblick

Diese Erklärung gilt für zwei Angebote:

- die Website voidbinder.de, die über die App Voidbinder (powered by Voidcom) informiert und Anmeldungen zur Warteliste entgegennimmt,
- die Web-App unter app.voidbinder.de mit ihrer Schnittstelle api.voidbinder.de, in der Sie ein Konto anlegen und Ihre Kartensammlung verwalten.

Die Website setzt keine Cookies und speichert nichts zu Ihrer Person in Ihrem Browser. Schriftarten, Skripte und Bilder liefern wir selbst aus. Inhalte von Dritten binden wir nur an einer Stelle ein: die Sicherheitsprüfung Cloudflare Turnstile im Formular der Warteliste (siehe unten). Die Reichweitenmessung mit Plausible betreiben wir selbst und ohne Cookies.

Die Web-App setzt nur Cookies, die für die Anmeldung technisch nötig sind. Deshalb gibt es weder auf der Website noch in der Web-App ein Cookie-Banner.

## Hosting und Server-Logs der Website

Die Website wird mit Cloudflare Workers ausgeliefert, einem Dienst der Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA. In der EU ist Cloudflare Germany GmbH Ansprechpartner. Ihre Anfrage wird über das weltweite Netzwerk von Cloudflare bearbeitet, in der Regel an einem Standort in Ihrer Nähe.

Bei jedem Aufruf verarbeitet Cloudflare technisch notwendige Daten: Ihre IP-Adresse, den User-Agent Ihres Browsers, den Zeitpunkt und die angeforderte Adresse. Das dient der sicheren und stabilen Auslieferung der Website und der Abwehr von Angriffen. Wir führen diese Daten nicht mit anderen Daten zusammen und nutzen sie nicht, um Sie zu identifizieren.

Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist die sichere Auslieferung der Website. Cloudflare verarbeitet die Daten als Auftragsverarbeiter nach unseren Weisungen auf Grundlage eines Vertrags zur Auftragsverarbeitung. Für Übermittlungen in die USA gelten die EU-Standardvertragsklauseln und, soweit Cloudflare danach zertifiziert ist, das EU-US Data Privacy Framework.

Speicherdauer: Wir selbst erhalten und speichern diese Logdaten nicht. Cloudflare bewahrt sie nur so lange auf, wie es für die Sicherheit und Fehlersuche des Netzwerks erforderlich ist, und löscht sie danach.

## Reichweitenmessung mit Plausible

<!-- TODO Max: Dieser Abschnitt ersetzt Cloudflare Web Analytics. Er stimmt erst, wenn die Website ohne PUBLIC_CF_ANALYTICS_TOKEN gebaut wird und Plausible auf Website und Web-App live ist (VB-74). -->

Wir messen auf der Website und in der Web-App, wie viele Menschen sie nutzen, welche Seiten sie aufrufen und woher sie kommen. Dafür nutzen wir Plausible Analytics, eine quelloffene Software, die auf einem von uns betriebenen Server läuft. Die Daten gehen an keinen anderen Anbieter, auch nicht an die Firma hinter Plausible.

<!-- TODO Max: Standort/Hoster des Plausible-Servers web-analytics.voidcom.app eintragen und prüfen, ob die Adresse über Cloudflare (Proxy oder Tunnel) erreichbar ist. Falls ja, Cloudflare hier als Empfänger nennen. -->

Bei jedem Seitenaufruf schickt Ihr Browser an web-analytics.voidcom.app:

- die aufgerufene Adresse und die verweisende Seite (Referrer); in der Web-App ohne Suchparameter und ohne den Teil nach „#“,
- den User-Agent Ihres Browsers und Ihre IP-Adresse.

<!-- TODO Max: prüfen, ob auch das Skript der Website (VB-74) Suchparameter entfernt, sonst „in der Web-App“ streichen bzw. anpassen. -->

Plausible leitet daraus Browser, Betriebssystem, Gerätetyp sowie Land, Region und Stadt ab. IP-Adresse und User-Agent werden nicht gespeichert. Plausible bildet aus ihnen zusammen mit der Domain und einem zufälligen Wert (Salt), der alle 24 Stunden gewechselt und gelöscht wird, einen Prüfwert (Hash). Damit lassen sich Besuche an einem Tag zählen, aber nicht über mehrere Tage oder Websites hinweg verbinden, und die IP-Adresse lässt sich daraus nicht zurückrechnen. Einzelheiten beschreibt Plausible unter https://plausible.io/data-policy.

Plausible setzt keine Cookies und erstellt kein Profil von Ihnen. Die Skripte auf der Website und in der Web-App schreiben nichts in den Speicher Ihres Browsers. Sie lesen dort nur einen Eintrag „plausible_ignore“, mit dem wir unsere eigenen Besuche aus der Zählung nehmen; bei Ihnen gibt es diesen Eintrag nicht. Nach unserer Einschätzung ist deshalb keine Einwilligung nach § 25 TDDDG nötig.

<!-- TODO Max: rechtlich prüfen lassen, ob das Lesen von „plausible_ignore“ unter § 25 TDDDG fällt. Alternative: das Skript ohne diese Prüfung ausliefern. -->

Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, die Reichweite von Website und Web-App zu kennen und sie zu verbessern. Sie können der Verarbeitung jederzeit widersprechen (siehe Ihre Rechte), zum Beispiel auch, indem Sie das Skript mit einem Inhaltsblocker sperren.

Speicherdauer: Gespeichert werden nur die abgeleiteten Angaben und der Tages-Hash, keine IP-Adressen. Den Salt löscht Plausible nach 24 Stunden.

<!-- TODO Max: Aufbewahrungsdauer der Statistik in Plausible festlegen (die selbst betriebene Version löscht nichts von selbst) und hier eintragen. -->

## Warteliste

Auf der Website können Sie sich für die Beta von Voidbinder eintragen.

**Welche Daten wir speichern.** Ihre E-Mail-Adresse, die gewählte Sprache, die Version des Einwilligungstextes, die Zeitpunkte der Eintragung, der Bestätigung, einer Abmeldung und des letzten Versands einer Bestätigungsmail sowie technische Angaben zur Abwicklung (eine interne Kennung, den Status der Eintragung und einen Prüfwert des Bestätigungslinks). Wir speichern keine IP-Adressen und keine Angaben zu Ihrem Browser.

**Zweck.** Wir speichern Ihre E-Mail-Adresse, um Ihnen eine Mail zu schicken, sobald die Beta von Voidbinder startet. Für andere Zwecke verwenden wir sie nicht.

**Rechtsgrundlage.** Ihre Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO. Die Angabe ist freiwillig. Ohne sie können Sie sich nicht eintragen, die Nutzung der Website bleibt davon unberührt.

**Ablauf (Double-Opt-In).** Nach der Eintragung senden wir Ihnen eine Mail mit einem Bestätigungslink, der 7 Tage gültig ist. Erst wenn Sie ihn öffnen, gilt die Eintragung. Wer die Adresse nicht bestätigt, erhält keine weiteren Mails. Tragen Sie dieselbe Adresse erneut ein, erhalten Sie höchstens einmal in 24 Stunden eine neue Bestätigungsmail oder, falls Sie schon bestätigt haben, eine kurze Hinweismail.

**Missbrauchsschutz.** Cloudflare begrenzt, wie oft von einer IP-Adresse aus Eintragungen möglich sind. Dafür wird die IP-Adresse kurzzeitig verarbeitet. Wir speichern sie nicht. Außerdem schützt die Sicherheitsprüfung Cloudflare Turnstile das Formular (siehe den Abschnitt zu Turnstile). Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO, unser berechtigtes Interesse ist der Schutz der Warteliste vor Missbrauch.

**Widerruf.** Sie können Ihre Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen, mit dem Abmeldelink in jeder Mail oder per E-Mail an max@voidcom.app. Die Rechtmäßigkeit der Verarbeitung bis zum Widerruf bleibt unberührt.

**Speicherdauer.** Wir speichern die Daten einer bestätigten Eintragung, bis wir Ihnen die Mail zum Beta-Start geschickt haben, längstens bis Sie sich abmelden. Danach löschen wir sie. Nicht bestätigte Eintragungen löschen wir nach 30 Tagen nach Ablauf des Bestätigungslinks, der sieben Tage gültig ist.

**Nach einer Abmeldung.** Der Eintrag bleibt dann mit Ihrer E-Mail-Adresse, dem Status „abgemeldet“ und den Zeitpunkten der Eintragung, der Bestätigung und der Abmeldung gespeichert. Der Zweck ist, Ihre Einwilligung und deren Widerruf nachweisen zu können (Art. 7 Abs. 1 DSGVO) und sicherzustellen, dass keine weitere Mail an die Adresse geht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO, unser berechtigtes Interesse ist dieser Nachweis und der Schutz vor ungewollten Mails. Wir bewahren den Eintrag zwölf Monate auf. Auf Ihren Wunsch löschen wir ihn schon vorher vollständig, schreiben Sie dazu an max@voidcom.app. Tragen Sie sich danach mit derselben Adresse erneut ein, beginnt ein neues Double-Opt-In.

**Empfänger.** Die Daten liegen in einer PostgreSQL-Datenbank bei OVH SAS, 2 rue Kellermann, 59100 Roubaix, Frankreich, auf einem von uns betriebenen Server im Rechenzentrum Gravelines (Frankreich). Die Mails versenden wir mit Cloudflare Email Service. Cloudflare verarbeitet dafür Ihre E-Mail-Adresse und den Inhalt der Mail. Die Anbieter handeln als Auftragsverarbeiter nach unseren Weisungen. Für Übermittlungen in Länder außerhalb der EU und des EWR gelten Standardvertragsklauseln oder ein Angemessenheitsbeschluss der EU-Kommission.

## Konto in der Web-App

In der Web-App unter app.voidbinder.de können Sie ein Konto anlegen und Ihre Sammlung, Mappen, Wunschliste und Decks verwalten. Den Kartenkatalog und die Preise können Sie auch ohne Konto ansehen.

### Registrierung und Anmeldung

**Welche Daten wir speichern.** Ihre E-Mail-Adresse, den Namen, den Sie bei der Registrierung angeben, ob Ihre E-Mail-Adresse bestätigt ist, und Ihr Passwort. Das Passwort speichern wir nie im Klartext, sondern nur als Hash mit dem Verfahren scrypt. Dazu kommen die Zeitpunkte der Registrierung und der letzten Änderung.

Im Profil können Sie außerdem einen Anzeigenamen, die Sprache Ihrer Mails und die Währung für Preise festlegen. Die Sprache übernehmen wir bei der Registrierung aus der Spracheinstellung Ihres Browsers, sonst ist sie Deutsch.

**Trainingsdaten.** Bei der Registrierung und im Profil können Sie erlauben, dass Ihre Scans als Trainingsdaten für die Kartenerkennung genutzt werden. Die Einstellung ist aus, bis Sie sie einschalten. Derzeit speichern wir nur Ihre Wahl. Scans gibt es in der Web-App noch nicht, es werden also keine verarbeitet. Rechtsgrundlage für eine spätere Nutzung ist Ihre Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO, die Sie im Profil jederzeit widerrufen können.

<!-- TODO Max: Sobald Scans hochgeladen werden (Handy-App), braucht diese Erklärung einen eigenen Abschnitt: welche Bilder, wo gespeichert, wie lange, wer trainiert. -->

**Zweck und Rechtsgrundlage.** Wir brauchen diese Daten, um Ihnen das Konto bereitzustellen (Art. 6 Abs. 1 lit. b DSGVO). Ohne E-Mail-Adresse und Passwort können Sie kein Konto anlegen.

**Schutz vor Missbrauch.** Wir begrenzen, wie oft von einer IP-Adresse aus Konten angelegt, Anmeldungen versucht und Codes der Zwei-Faktor-Anmeldung eingegeben werden können (zum Beispiel drei Registrierungen und fünf Anmeldeversuche pro Minute). Dafür speichern wir in unserer Datenbank einen Zähler mit Ihrer IP-Adresse, dem aufgerufenen Pfad und dem Zeitpunkt der letzten Anfrage. Zähler, deren Zeitfenster abgelaufen ist, löscht das System beim nächsten Durchlauf, in der Regel nach wenigen Minuten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO, unser berechtigtes Interesse ist der Schutz der Konten vor dem Erraten von Passwörtern und vor massenhaft angelegten Konten.

### Sitzungen und Cookies

Wenn Sie sich anmelden, legen wir eine Sitzung an. Zu jeder Sitzung speichern wir eine zufällige Kennung, den Zeitpunkt der Anmeldung und des Ablaufs, Ihre IP-Adresse und den User-Agent Ihres Browsers. IP-Adresse und User-Agent helfen uns, einen Missbrauch Ihres Kontos zu erkennen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO für die Sitzung selbst und Art. 6 Abs. 1 lit. f DSGVO für IP-Adresse und User-Agent, unser berechtigtes Interesse ist die Sicherheit Ihres Kontos.

Eine Sitzung gilt 7 Tage und verlängert sich, solange Sie die Web-App nutzen. Melden Sie sich ab oder setzen Sie Ihr Passwort zurück, endet die Sitzung sofort, beim Zurücksetzen auf allen Geräten.

<!-- TODO Max: Abgelaufene Sitzungen löscht Better Auth nur, wenn sie noch einmal benutzt werden; ein Aufräumjob fehlt. Entweder einen Job einplanen oder hier eine Frist nennen, die tatsächlich eingehalten wird. -->

Die Web-App speichert die Sitzung in Cookies, die nur über HTTPS übertragen werden und für Skripte nicht lesbar sind:

- ein Cookie mit der Kennung Ihrer Sitzung (bis zu 7 Tage),
- ein Cookie mit einer signierten Kopie der Sitzung, damit nicht jede Anfrage die Datenbank fragen muss (5 Minuten),
- während der Zwei-Faktor-Anmeldung ein Cookie, das den ersten Schritt der Anmeldung festhält,
- wenn Sie „Dieses Gerät 30 Tage merken“ wählen, ein Cookie, das die Abfrage des zweiten Faktors auf diesem Gerät für 30 Tage überspringt.

Außerdem speichert die Web-App im lokalen Speicher Ihres Browsers (localStorage) die zuletzt angesehenen Sets und Karten, damit Sie sie wiederfinden, und, wenn Sie bei der Registrierung den Trainingsdaten zugestimmt haben, Ihre E-Mail-Adresse bis zur ersten Anmeldung, damit die Zustimmung dann übernommen wird. Beides verlässt Ihr Gerät nicht. Sie können es jederzeit in Ihrem Browser löschen.

Diese Cookies und Einträge sind unbedingt erforderlich, damit wir den Dienst bereitstellen können, den Sie ausdrücklich nutzen wollen (§ 25 Abs. 2 Nr. 2 TDDDG). Eine Einwilligung ist dafür nicht nötig. Cookies zu Werbung oder Tracking setzen wir nicht.

### Zwei-Faktor-Anmeldung

Wenn Sie die Zwei-Faktor-Anmeldung einschalten, speichern wir das Geheimnis für Ihre Authenticator-App und zehn Backup-Codes. Beides speichern wir verschlüsselt (AES-256-GCM) mit einem Schlüssel, der nicht in der Datenbank liegt. Dazu speichern wir, wie oft ein Code falsch eingegeben wurde. Schalten Sie die Zwei-Faktor-Anmeldung aus, löschen wir das Geheimnis und die Backup-Codes und vergessen alle gemerkten Geräte. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.

### Sicherheitsprüfung mit Cloudflare Turnstile

Bei der Registrierung, beim Anfordern eines neuen Passworts, beim erneuten Senden der Bestätigungsmail und bei der Eintragung in die Warteliste prüft Cloudflare Turnstile, ob ein Mensch das Formular abschickt. Dafür lädt Ihr Browser ein Skript von challenges.cloudflare.com. Es führt im Browser kleine Prüfungen aus und sendet dabei Angaben zu Ihrem Browser und Ihrer IP-Adresse an Cloudflare. Ein Rätsel müssen Sie meist nicht lösen.

Das Ergebnis ist ein Token, den Ihr Browser mit dem Formular an uns schickt. Unser Server lässt den Token zusammen mit Ihrer IP-Adresse von Cloudflare prüfen. Wir speichern weder den Token noch das Ergebnis. Schlägt die Prüfung fehl, protokollieren wir nur den Fehlercode von Cloudflare.

Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist der Schutz vor automatisch angelegten Konten, Missbrauch des Mailversands und Spam. Die Prüfung ist für den Dienst, den Sie gerade nutzen wollen, unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Anbieter ist Cloudflare, Inc. (Anschrift oben), es gelten dieselben Garantien für Übermittlungen in die USA. Einzelheiten beschreibt Cloudflare im Turnstile Privacy Addendum unter https://www.cloudflare.com/turnstile-privacy-policy/.

<!-- TODO Max: Nach dem Turnstile Privacy Addendum klären, ob Cloudflare die Daten nur als Auftragsverarbeiter verarbeitet oder teilweise als eigener Verantwortlicher, und ob das Widget Cookies oder lokalen Speicher nutzt. Den Text danach anpassen. -->

### E-Mails

Wir schicken Ihnen Mails, die zum Konto gehören: den Link zur Bestätigung Ihrer E-Mail-Adresse und den Link zum Zurücksetzen des Passworts. Beide Links gelten eine Stunde. Absender ist hello@voidbinder.de. Wir versenden die Mails mit Cloudflare Email Service. Cloudflare verarbeitet dafür Ihre E-Mail-Adresse und den Inhalt der Mail. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Werbung schicken wir Ihnen nicht.

### Ihre Sammlung

Was Sie in der Web-App anlegen, speichern wir zu Ihrem Konto: Ihre Mappen (Name, Spiel, Reihenfolge, Farbe), die Einträge Ihrer Sammlung (Karte und Druck, Anzahl, Sprache, Zustand, Ausführung, Kaufpreis und Währung, Notiz), Ihre Wunschliste (Karte, Anzahl, gewünschte Sprache, Ausführung und Mindestzustand, Höchstpreis, Notiz) und Ihre Decks (Name, Spiel, Format, Beschreibung, Karten). Dazu kommen jeweils die Zeitpunkte des Anlegens und der letzten Änderung. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Diese Daten sieht nur Ihr Konto, wir geben sie an niemanden weiter.

Löschen Sie einen Eintrag, eine Mappe oder ein Deck, markieren wir ihn als gelöscht, statt ihn sofort zu entfernen. So können Ihre anderen Geräte die Löschung übernehmen. Gelöschte Einträge zeigen wir nicht mehr an. Endgültig entfernt werden sie mit Ihrem Konto.

<!-- TODO Max: Soll es eine kürzere Frist für als gelöscht markierte Einträge geben? Der Code entfernt sie derzeit nur mit dem Konto. -->

### Abgleich zwischen Geräten

Nutzen Sie Voidbinder auf mehreren Geräten, gleicht die App Ihre Sammlung, Mappen, Wunschliste und Decks über unseren Server ab. Dabei übertragen wir dieselben Daten wie oben und den Zeitpunkt jeder Änderung nach der Uhr Ihres Geräts. Eine Kennung Ihres Geräts speichern wir dafür nicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.

<!-- TODO Max: Der Abgleich kommt mit VB-32 und der Handy-App (Sprint 3). Vor dem Start der Handy-App prüfen, ob sie zusätzliche Daten auf dem Gerät oder auf dem Server speichert. -->

### Konto löschen

Im Profil können Sie Ihr Konto löschen. Sie werden dann sofort auf allen Geräten abgemeldet. Nach Ablauf einer Frist von 30 Tagen löschen wir Ihr Konto mit allen Daten: Profil, Sitzungen, Zwei-Faktor-Daten, Sammlung, Wunschliste und Decks. Melden Sie sich vor Ablauf der Frist wieder an, nehmen Sie die Löschung damit zurück und alles bleibt erhalten. Aus der Datensicherung verschwinden die Daten spätestens, wenn die letzte Sicherung mit ihnen abläuft (siehe Speicherdauer).

<!-- TODO Max: Frist festlegen (hier 30 Tage angenommen). Der Code speichert bisher nur den Löschantrag und beendet die Sitzungen; der Löschlauf nach Ablauf der Frist kommt mit VB-45. Bis dahin müssen beantragte Löschungen von Hand ausgeführt werden. -->

### Support per E-Mail

Wenn Sie uns an hello@voidbinder.de schreiben, verarbeiten wir Ihre E-Mail-Adresse, Ihren Namen, soweit Sie ihn angeben, und den Inhalt Ihrer Nachricht, um Ihre Anfrage zu beantworten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn es um Ihr Konto geht, sonst Art. 6 Abs. 1 lit. f DSGVO (unser berechtigtes Interesse, Anfragen zu beantworten). Wir löschen die Nachrichten, wenn die Anfrage erledigt ist und keine gesetzliche Aufbewahrungspflicht entgegensteht.

<!-- TODO Max: Bei welchem Anbieter liegt das Postfach von hello@voidbinder.de (zum Beispiel Cloudflare Email Routing mit Weiterleitung an ein anderes Postfach)? Diesen Anbieter hier nennen und eine konkrete Löschfrist eintragen. -->

### Server-Logs der Web-App

Die Web-App und ihre Schnittstelle laufen auf Cloudflare Workers. Für den Betrieb und die Fehlersuche schreiben wir zu jeder Anfrage eine Logzeile mit einer Anfrage-Kennung, Methode, Pfad ohne Suchparameter, Status, Dauer und dem Cloudflare-Rechenzentrum, das die Anfrage bearbeitet hat. IP-Adressen, E-Mail-Adressen oder Passwörter schreiben wir nicht in diese Zeilen. Cloudflare speichert diese Logs zusammen mit eigenen Angaben zum Aufruf in Workers Logs und löscht sie nach 7 Tagen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO, unser berechtigtes Interesse ist ein sicherer und fehlerfreier Betrieb.

<!-- TODO Max: Im Cloudflare-Dashboard prüfen, welche Felder Workers Logs selbst zu jedem Aufruf speichert (zum Beispiel Request-Header mit IP-Adresse) und ob das Konto auf dem Workers-Paid-Plan bleibt (7 Tage; auf dem Free-Plan 3 Tage). -->

### Hosting der Web-App

- **Cloudflare** (Anschrift oben) liefert die Web-App aus, betreibt die Schnittstelle (Cloudflare Workers) und verbindet sie über Hyperdrive und einen verschlüsselten Tunnel mit unserer Datenbank. Hyperdrive hält nur Antworten zum Kartenkatalog und zu Preisen kurz im Zwischenspeicher, keine Kontodaten. Kartenbilder liegen in Cloudflare R2 mit Speicherort in der EU. Dort liegen nur öffentliche Kartenbilder, keine Daten von Ihnen.
- **OVH SAS** (Anschrift oben) stellt den Server im Rechenzentrum Gravelines (Frankreich), auf dem wir die PostgreSQL-Datenbank mit Ihren Kontodaten und Ihrer Sammlung betreiben.
- **Backblaze, Inc.**, 201 Baldwin Avenue, San Mateo, CA 94401, USA, speichert unsere verschlüsselten Datensicherungen der Datenbank in der Region EU Central (Niederlande).

<!-- TODO Max: bestätigen, dass die Sicherung zu Backblaze B2 (EU Central) eingerichtet ist, der Vertrag zur Auftragsverarbeitung mit Backblaze abgeschlossen ist und welche Garantie für den US-Anbieter gilt (Data Privacy Framework oder Standardvertragsklauseln). Anschrift prüfen. -->

Alle drei Anbieter handeln als Auftragsverarbeiter nach unseren Weisungen auf Grundlage eines Vertrags zur Auftragsverarbeitung. Für Übermittlungen in die USA gelten die EU-Standardvertragsklauseln und, soweit der Anbieter danach zertifiziert ist, das EU-US Data Privacy Framework.

### Speicherdauer

| Daten                                                                                                                | Wie lange                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Konto und Profil (E-Mail-Adresse, Name, Anzeigename, Sprache, Währung, Einstellung zu Trainingsdaten, Passwort-Hash) | bis zur Löschung Ihres Kontos                                                              |
| Sammlung, Mappen, Wunschliste, Decks, auch als gelöscht markierte Einträge                                           | bis zur Löschung Ihres Kontos                                                              |
| Sitzung mit IP-Adresse und User-Agent                                                                                | bis zur Abmeldung, sonst 7 Tage nach der letzten Nutzung                                   |
| Gemerktes Gerät für die Zwei-Faktor-Anmeldung                                                                        | 30 Tage, oder bis Sie die Zwei-Faktor-Anmeldung ändern oder Ihr Passwort zurücksetzen      |
| Geheimnis und Backup-Codes der Zwei-Faktor-Anmeldung                                                                 | bis Sie die Zwei-Faktor-Anmeldung ausschalten oder Ihr Konto löschen                       |
| Links zur Bestätigung der E-Mail-Adresse und zum Zurücksetzen des Passworts                                          | 1 Stunde gültig                                                                            |
| Zähler gegen Missbrauch mit IP-Adresse                                                                               | wenige Minuten                                                                             |
| Turnstile-Token                                                                                                      | wird nicht gespeichert                                                                     |
| Server-Logs in Workers Logs                                                                                          | 7 Tage                                                                                     |
| Reichweitenmessung mit Plausible                                                                                     | keine IP-Adressen; der Salt für den Tages-Hash 24 Stunden                                  |
| Support-Mails                                                                                                        | bis die Anfrage erledigt ist                                                               |
| Datensicherungen der Datenbank                                                                                       | bis zu etwa elf Wochen (bis zu fünf Wochen Sicherungen, danach bis zu 45 Tage Löschsperre) |
| Zuletzt angesehene Karten im Browser                                                                                 | bis Sie sie in Ihrem Browser löschen                                                       |

<!-- TODO Max: Zeile Datensicherungen gegen die eingerichtete pgBackRest-Aufbewahrung und die Object-Lock-Frist (docs/guides/database-vps.md, Abschnitt 7) prüfen. -->

## Externe Links

Die Website verlinkt auf Twitch, GitHub und voidcom.app. Beim Anklicken verlassen Sie unsere Website, Ihr Browser übermittelt dann Daten (zum Beispiel Ihre IP-Adresse) an den jeweiligen Anbieter. Dort gelten dessen eigene Datenschutzerklärungen. Wir binden keine Inhalte dieser Anbieter in unsere Seiten ein.

## Cookies und lokaler Speicher auf der Website

Die Website setzt keine Cookies und schreibt nichts in localStorage oder sessionStorage Ihres Browsers; das Plausible-Skript liest dort nur den Eintrag „plausible_ignore“ (siehe oben). Ihre Sprachwahl steckt in der Adresse der Seite (/de/ oder /en/) und wird nicht gespeichert. Rufen Sie die Startseite ohne Sprachangabe auf, wählen wir die Sprache nach der Spracheinstellung Ihres Browsers und speichern diese Angabe nicht. Was die Web-App speichert, steht im Abschnitt „Sitzungen und Cookies“.

## Kinder

Voidbinder richtet sich nicht an Kinder unter 16 Jahren. Bitte legen Sie erst ab 16 Jahren ein Konto an.

<!-- TODO Max: Altersgrenze bestätigen. Die Web-App fragt das Alter derzeit nicht ab. -->

## Ihre Rechte

Sie haben nach der DSGVO das Recht auf

- Auskunft über Ihre gespeicherten Daten (Art. 15),
- Berichtigung unrichtiger Daten (Art. 16),
- Löschung (Art. 17),
- Einschränkung der Verarbeitung (Art. 18),
- Übertragbarkeit Ihrer Daten (Art. 20),
- Widerspruch gegen eine Verarbeitung, die auf Art. 6 Abs. 1 lit. f beruht, aus Gründen, die sich aus Ihrer besonderen Situation ergeben (Art. 21),
- Widerruf einer erteilten Einwilligung (Art. 7 Abs. 3).

Schreiben Sie dazu an max@voidcom.app oder, für Ihr Konto in der Web-App, an hello@voidbinder.de. Außerdem können Sie sich bei einer Datenschutzaufsichtsbehörde beschweren. Zuständig ist der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Baden-Württemberg, Lautenschlagerstraße 20, 70173 Stuttgart.

Eine automatisierte Entscheidungsfindung einschließlich Profiling findet nicht statt.

## Änderungen

Wir passen diese Erklärung an, wenn sich die Website, die Web-App, die Warteliste oder die Rechtslage ändern. Es gilt der Stand, der oben auf dieser Seite steht.
