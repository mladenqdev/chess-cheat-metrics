export function MethodologyPage() {
  return (
    <article className="methodology">
      <h1>Methodology</h1>
      <p className="muted">What this site measures, how it measures it, and what it cannot know.</p>

      <h2>Where the data comes from</h2>
      <p>
        Games and profiles come from the public APIs of lichess and chess.com: the moves, the clock
        time remaining after every move, ratings, account age, and the platforms' own public account
        flags (chess.com's <code>closed:fair_play_violations</code>, lichess's terms-of-service
        mark). Nothing is scraped, and nothing about your search is uploaded anywhere. The analysis
        runs entirely in your browser.
      </p>

      <h2>Engine analysis</h2>
      <p>
        Every position is evaluated by Stockfish (WebAssembly build) running on your machine, asking
        for the three best moves. Common opening positions reuse deeper, cached community
        evaluations from the lichess cloud-eval database.
      </p>

      <h2>Which moves count</h2>
      <p>
        Raw engine-agreement numbers are meaningless: everyone plays perfect recaptures, and
        memorized openings prove preparation, not cheating. Following the approach used by PGN-Spy
        and by Kenneth Regan's fair-play work, a move only counts as a <strong>decision</strong>{' '}
        when:
      </p>
      <ul>
        <li>it is out of book (past the known opening theory of that game),</li>
        <li>the position is not already decided (within ±3 pawns of equal),</li>
        <li>
          there was a real choice (the engine's best move is not overwhelmingly better than the
          second best),
        </li>
        <li>the position is not part of a repetition shuffle.</li>
      </ul>

      <h2>The metrics</h2>
      <p>
        <strong>Engine agreement (top-1/2/3).</strong> How often the played move matches Stockfish's
        best, top-two, or top-three moves across counted decisions. Reported with a likely range,
        because sample size matters: a 60% match over 20 moves means almost nothing, while the same
        match over 300 moves means a lot.
      </p>
      <p>
        <strong>Centipawn loss.</strong> How much each decision lost versus the engine's best move,
        in hundredths of a pawn. Average loss tracks playing strength closely (published research
        puts the correlation with rating near 0.98), which is what makes an implausibly low value
        informative. Conceding a forced mate is capped at 1000.
      </p>
      <p>
        <strong>Accuracy.</strong> A faithful port of lichess's accuracy formula (our implementation
        reproduces lichess's reported numbers exactly on games lichess has analyzed), so the values
        here mean the same thing they mean on lichess.
      </p>
      <p>
        <strong>Move timing.</strong> Derived from the per-move clocks both platforms publish:
        median think time, how flat the timing distribution is, and how often hard positions get
        instant replies. Humans think long on hard moves and move fast on obvious ones; assistance
        tends to flatten that pattern.
      </p>

      <p>
        <strong>Consistency and clock behavior.</strong> Two human signatures round out the picture:
        how much game accuracy swings from game to game (humans have bad days; assistance is
        steady), and whether thinking time tracks how hard each decision was (humans think longer on
        hard moves; assistance plays at its own pace regardless). Both signals only ever add
        suspicion. Looking human on them doesn't subtract any, because assistance can fake variety.
      </p>

      <h2>The unusualness score</h2>
      <p>
        Every metric above is compared to real players of the same rating and time control that we
        measured with the same engine. For each one we ask how far above the group's average this
        account sits, using the group's own spread as the yardstick. Those distances are then merged
        into one number, with move quality counting most and timing least (Stouffer's method, whose
        key property is that several independently elevated signals add up instead of averaging
        out). Read it like this: 0 is dead average, under 2 is ordinary, above 2 is uncommon, and
        above 3.5 essentially never happens among honest players.
      </p>

      <h2>The 120-decision rule</h2>
      <p>
        Below roughly 120 counted decisions, chance produces spectacular-looking numbers routinely.
        Following Regan's practice, this report refuses to summarize statistics below that threshold
        and tells you to analyze more games instead.
      </p>

      <h2>What this site cannot know</h2>
      <ul>
        <li>
          Platform-internal signals: mouse movement, browser focus, view-of-analysis detection,
          device fingerprints. The platforms' own systems see these; we never will.
        </li>
        <li>
          Whether anomalies have innocent causes: prepared lines, a forcing style, a strong player
          on a new account, or plain good form.
        </li>
        <li>
          Coverage limits: comparison groups are measured for blitz and rapid, roughly 400 to 3000.
          Bullet, classical, and ratings outside that range show raw numbers without a grade. The
          groups are measured on lichess; chess.com ratings run lower at the same strength, which
          makes the comparison conservative (harder to flag, not easier).
        </li>
      </ul>

      <h2>Our position</h2>
      <p>
        This report is evidence for a conversation, not a conviction. Use it to decide whether
        something is worth reporting through the platforms' official channels. They are the only
        parties with the data and the standing to act.
      </p>

      <p>
        <a href="#/">← back to the analyzer</a>
      </p>
    </article>
  );
}
