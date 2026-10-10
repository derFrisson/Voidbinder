---
title: Privacy policy
description: Which personal data voidbinder.de and the Voidbinder web app process, why, for how long, and which rights you have.
updated: '2026-10'
---

<!-- Draft as of 2026-10-10 (VB-62). The frontmatter field `updated` only allows year and month. -->

This is a courtesy translation. The [German version](/de/datenschutz/) is the binding one.

## Controller

The controller for the data processing on this website and in the Voidbinder web app under the General Data Protection Regulation (GDPR) is:

Maximilian Tschauder\
Hauptstraße 25\
88630 Pfullendorf, Germany\
Email: max@voidcom.app

For questions about your account in the web app you can also reach us at hello@voidbinder.de.

## Overview

This policy covers two services:

- the website voidbinder.de, which informs about the app Voidbinder (powered by Voidcom) and takes sign-ups for the waitlist,
- the web app at app.voidbinder.de with its interface api.voidbinder.de, where you create an account and manage your card collection.

The website sets no cookies and stores nothing about you in your browser. We serve fonts, scripts and images ourselves. We embed content from a third party in one place only: the security check Cloudflare Turnstile in the waitlist form (see below). We run the audience measurement with Plausible ourselves and without cookies.

The web app only sets cookies that are technically necessary for signing in. This is why there is no cookie banner on the website or in the web app.

## Hosting and server logs of the website

The website is served with Cloudflare Workers, a service of Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA. In the EU, Cloudflare Germany GmbH is the contact. Your request is handled on Cloudflare's global network, usually at a location near you.

With every visit, Cloudflare processes technically necessary data: your IP address, the user agent of your browser, the time and the requested address. This serves the secure and stable delivery of the website and the defence against attacks. We do not combine this data with other data and do not use it to identify you.

The legal basis is Art. 6 (1) (f) GDPR. Our legitimate interest is the secure delivery of the website. Cloudflare processes the data as a processor on our instructions under a data processing agreement. For transfers to the USA, the EU standard contractual clauses apply and, where Cloudflare is certified under it, the EU-US Data Privacy Framework.

Retention: we do not receive or store these logs ourselves. Cloudflare keeps them only as long as the security and troubleshooting of its network require and deletes them afterwards.

## Audience measurement with Plausible

<!-- TODO Max: this section replaces Cloudflare Web Analytics. It is only true once the website is built without PUBLIC_CF_ANALYTICS_TOKEN and Plausible is live on the website and the web app (VB-74). -->

On the website and in the web app we measure how many people use them, which pages they open and where they come from. We use Plausible Analytics for this, open source software that runs on a server we operate. The data goes to no other provider, not even to the company behind Plausible.

<!-- TODO Max: Standort/Hoster des Plausible-Servers web-analytics.voidcom.app (state the location and hoster), and check whether the address is reached through Cloudflare (proxy or tunnel). If so, name Cloudflare as a recipient here. -->

With every page view your browser sends to web-analytics.voidcom.app:

- the requested address and the referring page (referrer); in the web app without query parameters and without the part after "#",
- the user agent of your browser and your IP address.

<!-- TODO Max: check whether the website's script (VB-74) also strips query parameters; otherwise remove or adjust "in the web app". -->

From this, Plausible derives browser, operating system, device type and country, region and city. The IP address and the user agent are not stored. Plausible combines them with the domain and a random value (salt), which is replaced and deleted every 24 hours, into a check value (hash). This lets visits be counted within one day, but not linked across days or websites, and the IP address cannot be worked out from it. Plausible describes the details at https://plausible.io/data-policy.

Plausible sets no cookies and builds no profile of you. The script in the web app writes nothing to your browser's storage. It only reads an entry "plausible_ignore" there, which we use to exclude our own visits from the count; on your device this entry does not exist. For this reason, we do not consider consent under § 25 TDDDG necessary.

<!-- TODO Max: have it checked whether reading "plausible_ignore" falls under § 25 TDDDG. Alternative: ship the script without this check. -->

The legal basis is Art. 6 (1) (f) GDPR. Our legitimate interest is to know the reach of the website and the web app and to improve them. You can object to the processing at any time (see Your rights), for example also by blocking the script with a content blocker.

Storage period: only the derived details and the daily hash are stored, no IP addresses. Plausible deletes the salt after 24 hours.

<!-- TODO Max: set the retention of the statistics in Plausible (the self-hosted version deletes nothing by itself) and state it here. -->

## Waitlist

On the website you can sign up for the Voidbinder beta.

**Data we store.** Your email address, the language you chose, the version of the consent text, the times of sign-up, confirmation, unsubscribing and of the last confirmation mail, and technical details for handling the sign-up (an internal ID, the status of the sign-up and a check value of the confirmation link). We do not store IP addresses or details about your browser.

**Purpose.** We store your email address to send you one mail when the Voidbinder beta starts. We do not use it for any other purpose.

**Legal basis.** Your consent under Art. 6 (1) (a) GDPR. Providing the data is voluntary. Without it you cannot sign up; using the website is not affected.

**Process (double opt-in).** After you sign up, we send you a mail with a confirmation link that is valid for 7 days. The sign-up counts once you open it. An address that is not confirmed receives no further mails. If you sign up with the same address again, you receive a new confirmation mail at most once in 24 hours or, if you have already confirmed, a short notice mail.

**Protection against abuse.** Cloudflare limits how often sign-ups can be made from one IP address. The IP address is processed briefly for this. We do not store it. The security check Cloudflare Turnstile also protects the form (see the section on Turnstile). The legal basis is Art. 6 (1) (f) GDPR, our legitimate interest is protecting the waitlist from abuse.

**Withdrawal.** You can withdraw your consent at any time with effect for the future, with the unsubscribe link in every mail or by email to max@voidcom.app. The lawfulness of the processing until the withdrawal is not affected.

**Storage period.** We store the data of a confirmed sign-up until we have sent you the mail announcing the start of the beta, at most until you unsubscribe. After that we delete it. We delete sign-ups that are not confirmed after 30 days after the confirmation link, which is valid for seven days, has expired.

**After you unsubscribe.** The entry then stays stored with your email address, the status "unsubscribed" and the times of sign-up, confirmation and unsubscribing. The purpose is to be able to prove your consent and its withdrawal (Art. 7 (1) GDPR) and to make sure no further mail goes to the address. The legal basis is Art. 6 (1) (f) GDPR, our legitimate interest is this proof and protecting you from unwanted mail. We keep the entry for twelve months. On your request we delete it completely earlier; write to max@voidcom.app for this. If you sign up again with the same address afterwards, a new double opt-in starts.

**Recipients.** The data is stored in a PostgreSQL database with OVH SAS, 2 rue Kellermann, 59100 Roubaix, France, on a server we operate in the Gravelines data centre (France). We send the mails with Cloudflare Email Service. Cloudflare processes your email address and the content of the mail for this. The providers act as processors on our instructions. For transfers to countries outside the EU and the EEA, standard contractual clauses or an adequacy decision of the EU Commission apply.

## Account in the web app

In the web app at app.voidbinder.de you can create an account and manage your collection, binders, wishlist and decks. You can browse the card catalogue and prices without an account.

### Registration and sign-in

**Data we store.** Your email address, the name you enter when you register, whether your email address is confirmed, and your password. We never store the password in plain text, only as a hash with the scrypt method. In addition, the times of registration and of the last change.

In your profile you can also set a display name, the language of your mails and the currency for prices. When you register, we take the language from your browser's language setting, German otherwise.

**Training data.** When you register and in your profile you can allow your scans to be used as training data for card recognition. The setting is off until you turn it on. For now we only store your choice. The web app has no scans yet, so none are processed. The legal basis for a later use is your consent under Art. 6 (1) (a) GDPR, which you can withdraw in your profile at any time.

<!-- TODO Max: once scans are uploaded (phone app), this policy needs a section of its own: which images, where stored, for how long, who trains. -->

**Purpose and legal basis.** We need this data to provide your account (Art. 6 (1) (b) GDPR). Without an email address and a password you cannot create an account.

**Protection against abuse.** We limit how often accounts can be created, sign-ins attempted and two-factor codes entered from one IP address (for example three registrations and five sign-in attempts per minute). For this we store a counter in our database with your IP address, the requested path and the time of the last request. Counters whose time window has passed are deleted by the system on its next run, usually after a few minutes. The legal basis is Art. 6 (1) (f) GDPR, our legitimate interest is protecting accounts against password guessing and against accounts created in bulk.

### Sessions and cookies

When you sign in, we create a session. For each session we store a random ID, the time of sign-in and of expiry, your IP address and the user agent of your browser. The IP address and user agent help us detect misuse of your account. The legal basis is Art. 6 (1) (b) GDPR for the session itself and Art. 6 (1) (f) GDPR for the IP address and user agent; our legitimate interest is the security of your account.

A session lasts 7 days and is extended while you use the web app. When you sign out or reset your password, the session ends at once; a reset ends it on every device.

<!-- TODO Max: Better Auth only deletes expired sessions when they are used again; a cleanup job is missing. Either plan a job or state a period here that is actually kept. -->

The web app keeps the session in cookies that are only sent over HTTPS and cannot be read by scripts:

- a cookie with the ID of your session (up to 7 days),
- a cookie with a signed copy of the session, so that not every request has to ask the database (5 minutes),
- during the two-factor sign-in, a cookie that holds the first step of the sign-in,
- if you choose "Remember this device for 30 days", a cookie that skips the second-factor prompt on this device for 30 days.

In addition, the web app keeps in your browser's local storage (localStorage) the sets and cards you viewed last, so you can find them again, and, if you agreed to the training data when you registered, your email address until your first sign-in, so the agreement is applied then. Neither leaves your device. You can delete both in your browser at any time.

These cookies and entries are strictly necessary for us to provide the service you explicitly want to use (§ 25 (2) no. 2 TDDDG). No consent is needed for them. We set no cookies for advertising or tracking.

### Two-factor sign-in

If you turn on two-factor sign-in, we store the secret for your authenticator app and ten backup codes. We store both encrypted (AES-256-GCM) with a key that is not kept in the database. We also store how often a code was entered wrongly. When you turn two-factor sign-in off, we delete the secret and the backup codes and forget every remembered device. The legal basis is Art. 6 (1) (b) GDPR.

### Security check with Cloudflare Turnstile

When you register, request a new password, ask for the confirmation mail again and sign up for the waitlist, Cloudflare Turnstile checks whether a human is sending the form. For this your browser loads a script from challenges.cloudflare.com. It runs small checks in the browser and sends details about your browser and your IP address to Cloudflare. Usually you do not have to solve a puzzle.

The result is a token that your browser sends to us with the form. Our server has Cloudflare check the token together with your IP address. We store neither the token nor the result. If the check fails, we only log Cloudflare's error code.

The legal basis is Art. 6 (1) (f) GDPR. Our legitimate interest is protection against accounts created automatically, abuse of the mail sending and spam. The check is strictly necessary for the service you want to use at that moment (§ 25 (2) no. 2 TDDDG). The provider is Cloudflare, Inc. (address above), and the same safeguards for transfers to the USA apply. Cloudflare describes the details in the Turnstile Privacy Addendum at https://www.cloudflare.com/turnstile-privacy-policy/.

<!-- TODO Max: clarify from the Turnstile Privacy Addendum whether Cloudflare processes the data only as a processor or partly as a controller of its own, and whether the widget uses cookies or local storage. Adjust the text afterwards. -->

### Emails

We send you mails that belong to the account: the link to confirm your email address and the link to reset your password. Both links are valid for one hour. The sender is hello@voidbinder.de. We send the mails with Cloudflare Email Service. Cloudflare processes your email address and the content of the mail for this. The legal basis is Art. 6 (1) (b) GDPR. We do not send you advertising.

### Your collection

What you create in the web app is stored with your account: your binders (name, game, order, colour), the entries of your collection (card and printing, quantity, language, condition, finish, purchase price and currency, note), your wishlist (card, quantity, wanted language, finish and minimum condition, maximum price, note) and your decks (name, game, format, description, cards). In addition, the times each item was created and last changed. The legal basis is Art. 6 (1) (b) GDPR. Only your account sees this data; we pass it on to no one.

When you delete an entry, a binder or a deck, we mark it as deleted instead of removing it at once. This lets your other devices take over the deletion. We no longer show deleted entries. They are removed for good together with your account.

<!-- TODO Max: should items marked as deleted have a shorter period? The code currently removes them only with the account. -->

### Sync between devices

If you use Voidbinder on several devices, the app syncs your collection, binders, wishlist and decks through our server. For this we transfer the same data as above and the time of each change according to your device's clock. We store no ID of your device for this. The legal basis is Art. 6 (1) (b) GDPR.

<!-- TODO Max: sync comes with VB-32 and the phone app (Sprint 3). Before the phone app launches, check whether it stores additional data on the device or on the server. -->

### Deleting your account

You can delete your account in your profile. You are then signed out on every device at once. After a period of 30 days we delete your account with all its data: profile, sessions, two-factor data, collection, wishlist and decks. If you sign in again before the period ends, this withdraws the deletion and everything is kept. The data disappears from the backups at the latest when the last backup containing it expires (see Storage periods).

<!-- TODO Max: set the period (30 days assumed here). So far the code only records the deletion request and ends the sessions; the deletion run after the period comes with VB-45. Until then, requested deletions have to be carried out by hand. -->

### Support by email

When you write to us at hello@voidbinder.de, we process your email address, your name if you give it, and the content of your message to answer your request. The legal basis is Art. 6 (1) (b) GDPR when it concerns your account, otherwise Art. 6 (1) (f) GDPR (our legitimate interest in answering requests). We delete the messages once the request is settled and no statutory retention duty applies.

<!-- TODO Max: which provider hosts the mailbox of hello@voidbinder.de (for example Cloudflare Email Routing forwarding to another mailbox)? Name that provider here and state a concrete deletion period. -->

### Server logs of the web app

The web app and its interface run on Cloudflare Workers. For operation and troubleshooting we write one log line per request with a request ID, method, path without query parameters, status, duration and the Cloudflare data centre that handled the request. We write no IP addresses, email addresses or passwords into these lines. Cloudflare stores these logs together with its own details about the call in Workers Logs and deletes them after 7 days. The legal basis is Art. 6 (1) (f) GDPR, our legitimate interest is secure and fault-free operation.

<!-- TODO Max: check in the Cloudflare dashboard which fields Workers Logs itself stores for each call (for example request headers with the IP address) and whether the account stays on the Workers Paid plan (7 days; 3 days on the Free plan). -->

### Hosting of the web app

- **Cloudflare** (address above) serves the web app, runs the interface (Cloudflare Workers) and connects it to our database through Hyperdrive and an encrypted tunnel. Hyperdrive only caches answers about the card catalogue and prices for a short time, no account data. Card images are stored in Cloudflare R2 with the storage location in the EU. Only public card images are kept there, no data of yours.
- **OVH SAS** (address above) provides the server in the Gravelines data centre (France) on which we run the PostgreSQL database with your account data and your collection.
- **Backblaze, Inc.**, 201 Baldwin Avenue, San Mateo, CA 94401, USA, stores our encrypted backups of the database in the EU Central region (Netherlands).

<!-- TODO Max: confirm that the backup to Backblaze B2 (EU Central) is set up, that the data processing agreement with Backblaze is in place and which safeguard applies to the US provider (Data Privacy Framework or standard contractual clauses). Check the address. -->

All three providers act as processors on our instructions under a data processing agreement. For transfers to the USA, the EU standard contractual clauses apply and, where the provider is certified under it, the EU-US Data Privacy Framework.

### Storage periods

| Data                                                                                                              | How long                                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Account and profile (email address, name, display name, language, currency, training data setting, password hash) | until your account is deleted                                                               |
| Collection, binders, wishlist, decks, including items marked as deleted                                           | until your account is deleted                                                               |
| Session with IP address and user agent                                                                            | until you sign out, otherwise 7 days after the last use                                     |
| Remembered device for two-factor sign-in                                                                          | 30 days, or until you change two-factor sign-in or reset your password                      |
| Secret and backup codes of two-factor sign-in                                                                     | until you turn two-factor sign-in off or delete your account                                |
| Links to confirm the email address and to reset the password                                                      | valid for 1 hour                                                                            |
| Abuse counter with IP address                                                                                     | a few minutes                                                                               |
| Turnstile token                                                                                                   | not stored                                                                                  |
| Server logs in Workers Logs                                                                                       | 7 days                                                                                      |
| Audience measurement with Plausible                                                                               | no IP addresses; the salt for the daily hash 24 hours                                       |
| Support emails                                                                                                    | until the request is settled                                                                |
| Database backups                                                                                                  | up to about eleven weeks (up to five weeks of backups, then up to 45 days of deletion lock) |
| Last viewed cards in the browser                                                                                  | until you delete them in your browser                                                       |

<!-- TODO Max: check the backups row against the pgBackRest retention and the Object Lock period actually set up (docs/guides/database-vps.md, section 7). -->

## External links

The website links to Twitch, GitHub and voidcom.app. When you click, you leave our website and your browser transmits data (for example your IP address) to that provider. Their own privacy policies apply there. We do not embed content from these providers in our pages.

## Cookies and local storage on the website

This website sets no cookies and uses neither localStorage nor sessionStorage of your browser. This also applies to the audience measurement. Your language choice is part of the page address (/de/ or /en/) and is not stored. If you open the home page without a language, we pick the language from your browser's language setting and do not store that. What the web app stores is described in the section "Sessions and cookies".

## Children

Voidbinder is not meant for children under 16. Please create an account only from the age of 16.

<!-- TODO Max: confirm the age limit. The web app does not ask for the age at the moment. -->

## Your rights

Under the GDPR you have the right to

- access to your stored data (Art. 15),
- rectification of inaccurate data (Art. 16),
- erasure (Art. 17),
- restriction of processing (Art. 18),
- data portability (Art. 20),
- object to processing based on Art. 6 (1) (f), on grounds relating to your particular situation (Art. 21),
- withdraw a consent you have given (Art. 7 (3)).

Write to max@voidcom.app for this or, for your account in the web app, to hello@voidbinder.de. You can also lodge a complaint with a data protection supervisory authority. The competent one is the State Commissioner for Data Protection and Freedom of Information of Baden-Württemberg (Landesbeauftragter für den Datenschutz und die Informationsfreiheit Baden-Württemberg), Lautenschlagerstraße 20, 70173 Stuttgart, Germany.

There is no automated decision-making, including profiling.

## Changes

We update this policy when the website, the web app, the waitlist or the law change. The date shown at the top of this page applies.
