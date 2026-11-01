<!-- internal -->
> **DRAFT for review. Not legal advice.** Built from `DATA_INVENTORY.md` (IDs D1–D19 in the review notes). `[LAWYER L-n]` marks a point for the legal review and `[VERIFY-AT-P7 V-n]` marks a claim to check against the built app; both are listed in `LEGAL_REVIEW_CHECKLIST.md` and are removed from the public web page by `web/build-site.mjs`. Text between `if` markers appears on the web page only when the matching flag in `web/site.config.json` is on. It describes the **v1 launch scope**; nothing here may be published as final until P7 has checked it against the built app.
<!-- /internal -->

# {{APP_NAME}} Privacy Policy

**Effective date:** {{EFFECTIVE_DATE}}

This privacy policy explains what happens to your information when you use {{APP_NAME}}, a study notes app for Android and iPhone, and the {{APP_NAME}} website. It is written in plain English. If anything is unclear, email us at **{{CONTACT_EMAIL}}**.

## The short version

- **You don't need an account.** You can use {{APP_NAME}} without signing up. Your notes are saved on your phone.
- **Sync is optional.** If you turn on sync, your notes are stored in our cloud database (Google Firebase) so they appear on your other devices.
- **AI is optional, for ages 18 and up, and uses your own key.** If you add your own free key from Groq or Mistral and tap an AI action, the text you chose goes **straight from your phone to that company**. We never see your key or that text.
- **No ads, no analytics, no tracking, and we don't sell your data.**
- **You can delete your account and your synced data** in the app, or by email if you no longer have the app.

## 1. Who we are

{{APP_NAME}} is made by **{{DEVELOPER_LEGAL_NAME}}**, an individual developer in the Philippines ("we", "us"). We are responsible for your personal information under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173). [LAWYER L-1]

Contact for anything about privacy, including requests to use your rights: **{{CONTACT_EMAIL}}**.

## 2. What stays on your phone

Most of {{APP_NAME}} works only on your phone. This information is stored **on your device** and does not reach us unless you turn on sync or use an AI action (sections 3 and 4):

- your notes, subjects, folders, templates and custom looks;
- your flashcards and review history;
- version history (the last 20 versions of each note), which never leaves your phone;
- recordings, images, drawings and PDF attachments you add;
- your app settings;
- your AI key, kept in your phone's secure storage (Keychain on iPhone, Keystore on Android);
- the birth year you enter for AI features, which never leaves your phone;
- a count of the AI requests you made each day, which contains no note text and no key.

The app does not add its own database encryption; it relies on your phone's built-in storage encryption. You can turn on an app lock (Face ID, fingerprint or your device PIN); the app only learns whether unlocking succeeded. [VERIFY-AT-P7 V-1]

**Backups.** On Android, the app turns off automatic Android backups of its data. On iPhone, your phone's own iCloud or computer backup may include app data, depending on your phone's settings. [VERIFY-AT-P7 V-3]

**Deleting on your phone.** When you delete a note, you have a few seconds to undo; after that its text is wiped from the app. Deleting the app removes everything stored on your phone.

## 3. If you turn on sync (optional)

Sync is off until you choose to turn it on and sign in with email, Google or Apple. When it's on:

- **Your account.** Firebase Authentication (a Google service) stores your email address, a user ID, and how you sign in. If you sign in with Google or Apple, we ask them only for your email address, not your name or profile photo, and the app doesn't keep a name or photo on your account. [VERIFY-AT-P7 V-5]
- **Security logs.** Firebase Authentication records the IP address and device type of sign-in requests to protect accounts from abuse, and keeps those logs for a few weeks.
- **Your synced study data.** Cloud Firestore (a Google service) stores copies of your notes, subjects, folders, flashcards, review history and settings. Your review history includes a random label for each device you review on, so reviews from two devices can be merged. [VERIFY-AT-P7 V-6]
<!-- if FILE_SYNC -->
- **Your files.** Cloud Storage for Firebase stores copies of your recordings, images, drawings and PDF attachments.
<!-- endif -->
<!-- if not FILE_SYNC -->
- **Files stay on your phone.** Recordings, images, drawings and PDF attachments are not synced in this version of the app. [VERIFY-AT-P7 V-8]
<!-- endif -->

Only you can read or change your synced data: our database rules allow access only to the signed-in owner. Your data travels over encrypted connections (HTTPS). Google processes this data for us as our service provider, under its Firebase data processing terms. Firebase Authentication runs in the United States, and other Firebase services may process data in other countries where Google has facilities, so your data may be stored outside the Philippines. [LAWYER L-2]

We do not read your notes. Because synced data is not end-to-end encrypted, we could technically access it as the operator of the database; we will only do so to answer a request from you, to fix a problem you asked us to fix, or when the law requires it. [LAWYER L-3]

When you delete a note with sync on, the app also removes its contents from the cloud. [VERIFY-AT-P7 V-7]

**Why we use this information:** to provide the sync service you asked for when you turned it on, and to keep accounts secure. You can stop at any time by turning off sync or deleting your account. [LAWYER L-22]

## 4. AI features (optional, ages 18 and up)

AI actions such as summarize, make flashcards or tidy up are **optional**, and the app is fully usable without them. They are only for people aged **18 or older**, because the AI companies we support only allow adults to use their services. The first time you open an AI feature, the app asks for your birth year. If you are under 18, AI features stay off and you can keep using the on-device "Beautify Lite" and rule-based flashcards, which never leave your phone. [LAWYER L-4]

**How it works:**

1. You create your own free account and key at **Groq** or **Mistral** and paste the key into the app. The key is kept only in your phone's secure storage. **It is never sent to us.**
2. When you tap an AI action, the app shows you which company will receive your text. The first time you use each company, it asks for your permission.
3. The text you chose (for example, the selected note) is sent **directly from your phone to that company** over an encrypted connection. It does not pass through our servers, and we do not keep a copy.
4. The answer comes back to your phone and is shown to you before anything in your note changes.

If you ask for a **transcript of a recording**, the recording, its language and your subject's glossary words are sent directly from your phone to **Groq** in the same way. [VERIFY-AT-P7 V-9]
<!-- if VISION_AI -->

**Reference photos (Match a look).** Match a look first finds a matching style **on your phone**, without sending anything. If you're 18 or older, you can then tap **"Improve with AI (sends your photo to Groq)"** to get a closer match. The app asks for your permission before it sends photos to Groq for the first time. Up to 3 photos you choose are then sent directly from your phone to **Groq**. Before sending, the app makes each photo smaller (1,024 pixels on the longest side) and removes its hidden details, such as the camera's location data. The app doesn't keep the photos it sends and never uploads them to our servers; it saves only the resulting style, which syncs like your other looks if sync is on. Only send photos you're allowed to share, and avoid photos that show people or private information. [VERIFY-AT-P7 V-22] [LAWYER L-23]
<!-- endif -->

Because you use your own account, **that company's own terms and privacy policy apply** to what you send:

- **Groq** says it does not keep your requests by default, but may log inputs and outputs for up to 30 days to troubleshoot problems or investigate abuse, unless you turn on Zero Data Retention in your Groq account's Data Controls. Groq stores data in the United States. Groq's terms require users to be 18 or older.
- **Mistral** says that in its free mode it may use your inputs and outputs to train its AI models unless you opt out. To opt out, open Mistral's **Admin panel → Privacy** and turn off **"Anonymous improvement data"**. Mistral's terms do not allow minors without a parent's or guardian's consent. [LAWYER L-20]

**Why:** we send your text to an AI company only because you asked for that action and agreed on the permission screen. You can withdraw that permission at any time by removing your key or turning AI off. [LAWYER L-22]

Please don't send highly sensitive information to an AI service. You can choose which notes you send, and you can turn AI off for a whole subject. [VERIFY-AT-P7 V-10] AI answers can be wrong; see our [Terms of Use](TERMS_OF_USE.md).

## 5. Our website and emails

- **Website.** Our website (privacy policy, terms, account deletion and support pages) is hosted on GitHub Pages. GitHub logs visitors' IP addresses for security. Our pages use no cookies, no analytics and no scripts.
- **Emails.** If you email us, we use your email address and message only to answer you. We delete support emails when they are no longer needed. For account deletion requests we keep a short record (the date and that the deletion was done, with no notes) for 12 months, to show that we handled the request. [LAWYER L-7]

## 6. What we don't do

- We don't show ads and don't use advertising IDs.
- We don't use analytics or crash-reporting tools.
- We don't sell, rent or trade your personal information, and we don't share it with data brokers.
- We don't track you across other apps or websites.
- We don't collect your location, contacts or phone number.

## 7. Who receives your information

We only share your information in these cases:

- **Google (Firebase)**, as our service provider for sync (section 3).
- **Groq or Mistral**, only when you send something to them yourself with your own key (section 4).
- **GitHub**, which hosts our website (section 5).
- **When the law requires it**, for example a valid court order, or to protect someone's safety.

## 8. How long we keep information

| Information | How long |
|---|---|
| Data on your phone | Until you delete it or delete the app |
| Your account and synced data | Until you delete it or delete your account |
| After you delete your account | Removed from our live database right away. Google removes deleted accounts from its backup systems within 180 days. We have not turned on extra database backups |
| Sign-in security logs (IP address) | A few weeks (kept by Firebase Authentication) |
| Text, audio or photos you sent to an AI company | Set by that company (section 4); we can't delete it for you |
| Support emails | Until your question is answered and no longer needed |
| Record of a deletion request | 12 months |

[LAWYER L-8]

## 9. Deleting your account

You can delete your account **in the app** (in the Me tab, under Account), or, if you no longer have the app, by following the steps on our [account deletion page](ACCOUNT_DELETION_PAGE.md). We complete email requests within 7 days. [VERIFY-AT-P7 V-11]

Deleting your account removes your account, your synced notes, flashcards, review history and settings, and any synced files. It does not delete data that is only on your phone (delete the app or use "Delete local data" for that), or anything you sent to an AI company, such as text, recordings or photos (contact that company).

## 10. Your rights

Under the Data Privacy Act you have the right to be informed about how your personal information is used, to access it, to object to its processing, to have wrong information corrected, to have it erased or blocked, to get a copy in a commonly used format (data portability), to be compensated for damages, and to file a complaint with the National Privacy Commission (privacy.gov.ph). [LAWYER L-9]

Most of these you can do yourself in the app: view, edit and delete your notes, export your data, and delete your account. [VERIFY-AT-P7 V-12] For anything else, email **{{CONTACT_EMAIL}}**. We may ask you to confirm the request from the email address on your account so that nobody else can make requests about your data. We will answer within a reasonable time.

## 11. Children and teens

{{APP_NAME}} is meant for people aged **13 and older** and is not designed for children under 13. We do not knowingly collect personal information from children under 13. If you believe a child under 13 has created an account, email us and we will delete it. AI features are only for people aged 18 and older (section 4). [LAWYER L-10]

## 12. Security

We protect your information with encrypted connections (HTTPS), database rules that let only the owner reach their data, secure storage for AI keys on your phone, and an optional app lock. No method is perfectly secure; if we learn of a data breach that affects you, we will tell you and the National Privacy Commission when the law requires it. [LAWYER L-11]

## 13. Changes to this policy

If we change this policy, we will update the effective date at the top of this page. If the changes are important, we will also tell you in the app or on this page before they take effect. [VERIFY-AT-P7 V-13]

## 14. Contact us

**{{DEVELOPER_LEGAL_NAME}}**
Email: **{{CONTACT_EMAIL}}**
