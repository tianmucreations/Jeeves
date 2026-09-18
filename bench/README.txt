MODEL COMPARISON BENCH (built 17 Sept 2026)

What it is: 12 practice jobs with automatic pass/fail checks, used to choose Auto's
models. Every check was proven to FAIL on the untouched job and PASS on a correct
solution (reference/ holds those correct solutions).

Jobs: chat, research, bugfix, csv, euros, countdown, split, sydney, bank (everyday to
moderately hard) and calc, fifo, todo (very hard). Added 18 Sept for plan step 1b: newbuild (a new timer
page must be researched - a page opened and a note recorded - before it is written) and
skipresearch (the same job with "Skip the research": no search, built directly).

Run (from the project folder), for example the cheap model on two jobs, twice:
  PLAN="deepseek/deepseek-v4-flash-0731|calc|1,deepseek/deepseek-v4-flash-0731|calc|2" BUDGET=1 npx tsx bench/bench.mts
PLAN entries are model|job|run-name. It uses the real OpenRouter key from the Keychain
and spends real money; BUDGET stops it (in dollars). Results are appended to
bench/results.jsonl and bench/bench.log; each run's folder is bench/runs/ (not saved
to GitHub). hashes.txt holds fingerprints of the test files the model must not edit.

Everyday jobs added 18 Sept: letter, invoice, tidy, website, dedupe, dates, minutes,
budget, phone, report. python3 bench/analyse.py prints pass rates and what the failed
runs have in common. bench/package.json keeps the checks in the older script format.

Results are appended to bench/results.jsonl on the machine that runs the bench (not saved to GitHub).
