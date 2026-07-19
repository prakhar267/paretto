import Link from "next/link";

export const metadata = {
  title: "Privacy & data — Pas à Pas",
  description: "How Pas à Pas stores, protects, and deletes learning progress.",
};

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <article className="privacy-document">
        <p className="eyebrow">Privacy &amp; data</p>
        <h1>A small app with a small data footprint.</h1>
        <p className="privacy-updated">Effective July 20, 2026</p>

        <section>
          <h2>What Pas à Pas stores</h2>
          <p>
            We store the display name you choose, vocabulary progress, review
            schedules, session history, rewards, streaks, and app preferences.
            Your browser also keeps an origin-isolated offline copy so
            an interrupted connection cannot erase a lesson.
          </p>
        </section>

        <section>
          <h2>Account identity</h2>
          <p>
            The hosting platform provides your signed-in email for each request.
            Pas à Pas converts it to a keyed, one-way account identifier before
            database access; the raw email is not written to the learning-progress
            table.
          </p>
        </section>

        <section>
          <h2>How the data is used</h2>
          <p>
            The data exists only to run your lessons, sync devices, calculate
            reviews, and show your own progress. It is not sold, used for ads, or
            shared in the sample leaderboard. Pronunciation uses your browser’s
            speech service; Pas à Pas does not record or upload your microphone.
          </p>
        </section>

        <section>
          <h2>Retention and deletion</h2>
          <p>
            Progress is retained while you use the app. Choose “Delete my learning
            data” in Profile to remove the primary server record and this browser’s
            offline copy. Infrastructure recovery backups may persist temporarily
            under the hosting provider’s limited backup cycle before expiring.
          </p>
        </section>

        <section>
          <h2>Your control</h2>
          <p>
            You can export a readable JSON copy at any time, turn off audio or IPA,
            and permanently delete progress from the same Profile screen. Questions
            about workspace access should be directed to your workspace owner.
          </p>
        </section>

        <Link className="primary-button privacy-back" href="/">
          Back to Pas à Pas
        </Link>
      </article>
    </main>
  );
}
