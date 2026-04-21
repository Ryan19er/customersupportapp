/**
 * Self-explanatory guide for technicians who are not developers.
 * Shown on the "How to use" tab of the admin panel.
 */
export function AdminHelp() {
  return (
    <div className="space-y-8 text-slate-200">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-white">What this app is for</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          This is an internal Stealth tool. Customers use the public support chat on the website or
          app. You use this panel to read those conversations, record what really went wrong on a
          job, and help the AI get smarter over time. You do not need to know how to code.
        </p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-white">Logging in</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Use the username and password your team was given. If you cannot log in, ask whoever
          manages the project to check the admin password in the server settings. Log out when you
          are done on a shared computer.
        </p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-white">Conversations and transcript</h2>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm leading-relaxed text-slate-300">
          <li>
            <strong className="text-slate-200">Left column:</strong> Every support chat session
            appears as a row with the customer name and email when we have it.
          </li>
          <li>
            <strong className="text-slate-200">Click a row</strong> to load that chat in the
            transcript on the right.
          </li>
          <li>
            <strong className="text-slate-200">Transcript:</strong> Shows everything the customer
            and the AI said, in order. Scroll to read the full story.
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-white">Correct & Publish (field learnings)</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          After you find the real problem on site, use this form so the next person (and the AI)
          benefits from what you learned. The field-verified snippet auto-applies immediately so
          the next similar customer chat uses it. Canonical review is handled in the same
          dashboard under Customer chats and notes, so correction, approval, and publishing happen
          in one workspace.
        </p>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm leading-relaxed text-slate-300">
          <li>
            <strong className="text-slate-200">Created by:</strong> Your name or initials so we know
            who added the note.
          </li>
          <li>
            <strong className="text-slate-200">Click a message</strong> in the transcript (it
            highlights green) to tie the note to that exact message. Optional but helps context.
          </li>
          <li>
            <strong className="text-slate-200">Symptoms:</strong> What the customer or chat looked
            like before you knew the real cause.
          </li>
          <li>
            <strong className="text-slate-200">Actual root cause:</strong> What was really wrong
            (example: pressure line clogged, not “machine seemed off”).
          </li>
          <li>
            <strong className="text-slate-200">How it was fixed:</strong> Step by step what you did.
          </li>
          <li>
            <strong className="text-slate-200">Parts, tags, model, serial:</strong> Fill what helps
            the next search. Tags are words separated by commas, like: assist gas, clogged, tube
            laser.
          </li>
          <li>
            Click <strong className="text-slate-200">Correct & Publish</strong> when done. The change
            applies to runtime immediately (next customer turn), and any contradiction is flagged for
            manual review.
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-white">Expert training chat and customer question queue</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          This is not the customer chat. The training assistant speaks to you as a technician or admin
          who knows Stealth machines — full answers, not customer-safe sound bites. Use it to refine
          prompts, walk through faults, and decide what the public bot should say.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          When the model identifies a hard or ambiguous customer question that needs an official
          answer, it can add lines that become rows in the{' '}
          <strong className="text-slate-200">Customer question queue</strong> (like tickets). Resolve
          them when you have updated the KB, prompts,
          or process.
        </p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-white">Prompt versioning (support-system)</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          The big text box is the main system instructions the customer-facing AI follows (one
          “prompt file” stored as versions in the database).
        </p>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm leading-relaxed text-slate-300">
          <li>
            Edit the text when leadership agrees on a change. Always type a short{' '}
            <strong className="text-slate-200">change summary</strong> so everyone knows what
            changed.
          </li>
          <li>
            <strong className="text-slate-200">Save new version</strong> creates a new numbered
            version. Old versions are kept.
          </li>
          <li>
            If something goes wrong after a change, find the older version in the list and click{' '}
            <strong className="text-slate-200">Rollback</strong> to make that version active again.
            This is similar to undoing a bad deploy.
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-white">Knowledge index &amp; RAG retrieval</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          The customer AI no longer relies on just recent snippets. Every manual, PDF, DOCX, ZIP
          and technician note is ingested as tagged, embedded chunks (see{' '}
          <a className="underline" href="/admin/knowledge">Knowledge index</a>). At chat time the
          server identifies the customer&apos;s machine, pulls the top evidence, and the AI cites
          it as [E1], [E2], ... in every answer. Run{' '}
          <code className="rounded bg-slate-800 px-1">scripts/ingest_knowledge.py</code> to (re)build
          the index from the repo.
        </p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-white">Auto-grader and corrections</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Every AI reply is scored on product match, factual accuracy, safety, helpfulness,
          evidence usage and resolved-likelihood. Flagged items now appear directly in the
          Customer chats and notes workspace, where admins can teach, approve, or reject without
          switching tabs.
        </p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-white">If you host or deploy this panel</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          This is for the person who runs the server. Copy <code className="rounded bg-slate-800 px-1">.env.example</code> to{' '}
          <code className="rounded bg-slate-800 px-1">.env.local</code> and set:
        </p>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm leading-relaxed text-slate-300">
          <li>
            <strong className="text-slate-200">SUPABASE_URL</strong> and <strong className="text-slate-200">SUPABASE_SERVICE_ROLE_KEY</strong> — the
            service role key must stay on the server only; it can read and write all data.
          </li>
          <li>
            <strong className="text-slate-200">ADMIN_USERNAME</strong> / <strong className="text-slate-200">ADMIN_PASSWORD</strong> — login for
            this admin site. Change the default password before production.
          </li>
          <li>
            <strong className="text-slate-200">ANTHROPIC_MODEL</strong> — which Claude model the training channel and related tools use.
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-amber-900/50 bg-amber-950/30 p-5">
        <h2 className="text-lg font-semibold text-amber-100">Need help?</h2>
        <p className="mt-2 text-sm leading-relaxed text-amber-100/90">
          Stealth support: 877-45LASER · sales@stealthlaser.com. For this admin tool itself, contact
          whoever deployed it for your team (they set passwords and Supabase access).
        </p>
      </section>
    </div>
  );
}
