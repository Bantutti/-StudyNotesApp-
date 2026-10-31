# Google Play closed test plan

> **DRAFT.** Decision Q11 (Nov 1, 2026): **build the app first.** The 14-day closed test runs on the **P7 beta build**. Recruiting starts near the end of the build (**around P6**) so the test can begin the day the beta exists. Recruiting earlier (during P4) is **optional** and only makes the sign-up list longer-lived.
>
> **Sources (read 2026-11-01):** [Testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465), [Set up an open, closed or internal test](https://support.google.com/googleplay/android-developer/answer/9845334), [Get started with Play Console](https://support.google.com/googleplay/android-developer/answer/6112435).

## §1 The rules (Google, quoted)

- *"Developers with personal accounts created after November 13, 2023, must run a closed test for their app with a minimum of 12 testers who have been opted in continuously for at least 14 days."*
- *"At least 12 testers must be opted in to your closed test when you apply for production access, and they must have been opted in continuously for the preceding 14 days."*
- *"Testers who opt in, test for fewer than 14 days, and then opt out do not count… If a tester opts out and opts back in later, the 14 days must be consecutive."*
- *"You can start a closed test after completing your app setup."* (So the privacy policy URL, Data safety, content rating and target audience must be finished first: `PLAY_APP_CONTENT.md`.)
- After the first publish, *"the test link can take several hours to become available to testers."*
- Closed-test apps can't be found by searching Google Play: *"You must share the app's Play Store URL with testers."*
- *"Testers cannot leave public reviews on Google Play for test versions. Include a direct feedback channel."*
- Testers need a Google Account. Production review after applying *"usually takes seven days or less, but can occasionally take longer."* Google may ask for more testing if there were *"fewer than 12 opted-in testers or insufficient tester engagement."*

**Our safety margin:** recruit **18 to 20** Android users so that dropouts don't take us below 12.

## §2 Schedule

Roadmap weeks are plan v0.2 estimates and will move; the schedule is written relative to the phases.

| When | What | Who |
|---|---|---|
| **Before P6** (any time) | Create the Play developer account and finish identity and device verification (`REY_SETUP.md` §4). Verification can take days, so don't leave it to P7 | Rey |
| **Start of P6** | Send the invite (§3). Open the sign-up list. Target: 20 names | Rey |
| **During P6** | Finish Play app setup: privacy policy URL live, Data safety, content rating, target audience, store listing draft (C1 docs). Fix the **package name** (permanent) | Rey + Lead |
| **End of P6** | Confirm every tester has an Android phone and the Gmail address they use in the Play Store. Remind them of the 14-day rule | Rey |
| **P7, day 0** | Upload the signed beta build (EAS) to the closed testing track, add the tester list, publish. Wait for the link to go live (can take hours). Send the opt-in link and instructions (§4) | Rey |
| **Day 1–2** | Check in Play Console that testers show as opted in. Chase anyone missing | Rey |
| **Day 3, 7, 11** | Send the day's test tasks (§5). Collect feedback | Rey |
| **Day 13** | Send the feedback survey (§6) | Rey |
| **Day 14 or later** | Confirm **at least 12 testers opted in continuously for 14 days**. Apply for production access (§7) | Rey |
| **Up to ~7 days later** | Google reviews the application. Keep the closed test running and testers opted in until approval | Rey |

**If the count drops below 12** at any point: recruit replacements immediately. Each replacement needs their own 14 consecutive days, so the application date moves.

## §3 Invite message (send at the start of P6)

Short version for group chats (English; adapt freely):

> Hi! I'm building **{{APP_NAME}}**, a study notes app that makes your notes look like aesthetic handwritten pages and turns them into flashcards. I need **Android testers** for a Google Play closed test.
>
> **What you'd do:** install the beta from Google Play, use it for your real notes, and keep it installed (and stay in the test) for **at least 14 days** in a row. About 5 minutes a day, plus a short survey at the end.
>
> **What you need:** an Android phone and the Gmail address you use in the Play Store.
>
> **What I collect for the test:** your name and that Gmail address, only to add you to the tester list. I delete the list after the app launches. The app itself works without an account.
>
> Interested? Reply with your **name**, **Gmail address** and **phone model**. Testing starts around [date]. Thank you!

Note: classmates who are **under 18** can test everything except AI features (the app keeps AI off for them).

## §4 Opt-in steps for testers (send on day 0)

> **How to join the {{APP_NAME}} test (Android)**
>
> 1. On your phone, make sure the Play Store is signed in with **the Gmail address you gave me**.
> 2. Open this link: **[opt-in link from Play Console]** and tap **Become a tester**. (If it says the link isn't ready, try again in a few hours.)
> 3. Tap **Download it on Google Play** (or open: **[Play Store link]**) and install {{APP_NAME}}.
> 4. Open the app and write your first note.
> 5. **Important:** stay in the test for **14 days in a row**. Don't tap "Leave the program". If you uninstall by accident, just reinstall from the same link; leaving the program is what resets your 14 days.
> 6. Send bugs and ideas to **{{CONTACT_EMAIL}}** or the feedback form: **[form link]**. (Play doesn't allow public reviews for test versions.)

## §5 Test tasks (keeps engagement high; Google asks about it)

| Day | Tasks |
|---|---|
| 0–2 | Install. Pick a look, make your first subject and note (time it: is it under a minute?). Try two style packs. |
| 3 | Use the slash menu (+) to add a definition box and a Q&A block. Search for a word. Restore an old version from History. |
| 5 | Make flashcards from a note and do a short review session. |
| 7 | (18+ with your own free Groq key only) Try one AI action and undo it. Everyone: try Beautify Lite. |
| 9 | Turn on sync with a test email, edit on two devices if you have them, then try **Delete account**. |
| 11 | Record a short lecture or voice note and get a transcript (18+ with a key), or type while recording. Export a note to PDF. |
| 13 | Fill in the survey (§6). |

Tasks follow the v1 feature list; drop any feature that didn't make the beta.

## §6 Feedback survey (Google Form, free)

1. Phone model and Android version
2. How many days did you use the app? (0–3, 4–7, 8–14)
3. Which features did you try? (checkboxes from §5)
4. What did you like most?
5. What was confusing or broken? (steps, screenshots welcome)
6. Would you use it for your real classes? (1–5)
7. Anything else?

Don't ask for school, ID numbers or anything not needed. Say on the form that answers are stored in Rey's Google Drive and deleted after launch.

## §7 Production access application: answer drafts

Google's form has three parts. Draft answers to finish with real numbers from the tracker:

**Part 1, About your closed test**
- *How easy was recruiting:* [choose].
- *Tester engagement:* "[N] testers, mostly university students in Cebu, the app's target users, used it for [X] days on average. [N] tried every main feature (notes, styles, flashcards, review, export); [N] tried sync and account deletion; [N] adults tried AI with their own keys. Usage matched expected use: short daily sessions around classes. Differences: [e.g. fewer people tried recording]."
- *Feedback summary and how collected:* "Collected through a Google Form on day 13, email and a group chat. Main themes: [list]."

**Part 2, About your app**
- *Target audience:* "Students aged 13 and up, mainly high school and university students in the Philippines, who take notes for classes and review for exams."
- *Value:* "Turns class notes into clean, readable study pages and spaced-repetition flashcards, works fully offline with no account, and exports to PDF and Word."
- *Estimated first-year installs:* [choose a modest range].

**Part 3, About your production readiness**
- *Changes from the test:* "[list fixes, e.g. crash on X fixed, onboarding shortened]."
- *Why ready:* "All phase gates passed (tests, lint, type checks, dependency audit, secret scan, security review with no open high-severity issues), no open crash reports from testers in the last [N] days, and every main feature was used by testers."

## §8 Tracker

Use `closed-test-tracker.csv` (open it in Google Sheets or Excel). **It holds personal data** (names, Gmail addresses): keep the filled copy in Rey's private Drive, never in the repo, and delete it after production approval.

Columns: tester number, name, Gmail used in Play, phone model, Android version, age 18+ (for AI tasks), invite sent date, opted-in date (from Play Console), day 14 date (= opted-in date + 14), still opted in (check on days 3, 7, 11, 14), tasks done, survey done, notes.

## §9 iPhone

Google's closed test is Android only, and iPhone users don't count toward the 12. An iPhone beta (TestFlight) needs the paid Apple Developer Program; plan it separately when Rey enrolls.
