# Fixture Placeholders

These fixtures are illustrative support artifacts for the reconstructed MVP. They are not production truth and should not be treated as validated catalog outputs.

Purpose:

- show the expected shape of recommendation-related artifacts
- give contributors a concrete sample for docs, demos, and tests
- keep sample/support material outside service directories

Contents:

- `sample-session/request.json`: example request payload
- `sample-session/session-state.json`: example persisted recommendation state
- `sample-session/recommendation-artifact.json`: example recommendation artifact placeholder
- `sample-session/comparison-artifact.json`: example comparison artifact placeholder
- `sample-session/workflow-notes.md`: narrative walkthrough of the sample

If you create real replay fixtures later, keep the distinction explicit:

- curated deterministic inputs belong in `testset/`
- generated outputs belong in `test-results/` or a clearly named artifact folder
- doc-only placeholders belong in `fixtures/`
