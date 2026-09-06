#!/bin/bash
# PokoPal: publish docs/ to GitHub Pages.
#
#   tools/publish.sh            commit everything, push, (first time) create the repo and switch Pages on
#
# One-time, and only you can do it: sign this Mac into GitHub with  gh auth login
# (GitHub.com, HTTPS, "Login with a web browser"). After that this script needs nothing from you.
# The repo is public because GitHub Pages on a free account only serves public repos. Pokémon names and
# sprites are Nintendo's; this is a private tool for two people, not a product. Keep it that way.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_NAME="${POKOPAL_REPO:-pokopal}"

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub is not signed in on this Mac. Run:   gh auth login -h github.com -p https -w -c"
  echo "(it opens the browser; paste the one-time code and click Authorize), then run tools/publish.sh again."
  exit 1
fi
# Let git borrow gh's login for the push (idempotent; covers a login that skipped the "Authenticate Git?" prompt).
gh auth setup-git -h github.com >/dev/null 2>&1 || true

# Stamp the service worker so every phone installs the new release and re-reads the shell and data.
STAMP="$(date +%Y-%m-%d-%H%M)"
sed -i '' -E "s/^const VERSION = '[^']*';/const VERSION = '${STAMP}';/" docs/sw.js
python3 tools/build_single_file.py >/dev/null

if [ ! -d .git ]; then git init -q -b main; fi
# Commits need an author. If this Mac has none set, use the GitHub account itself (its no-reply address).
if [ -z "$(git config user.name || true)" ] || [ -z "$(git config user.email || true)" ]; then
  LOGIN="$(gh api user -q .login)"
  git config user.name "$(gh api user -q '.name // .login')"
  git config user.email "$(gh api user -q .id)+${LOGIN}@users.noreply.github.com"
fi
git add -A
if ! git diff --cached --quiet; then git commit -q -m "Publish ${STAMP}"; fi

OWNER="$(gh api user -q .login)"
if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo create "${REPO_NAME}" --public --source=. --remote=origin --push \
    --description "PokoPal: which Pokémon lives where in Pokémon Pokopia"
  gh api -X POST "repos/${OWNER}/${REPO_NAME}/pages" -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null
  echo "Repo created and GitHub Pages switched on for docs/."
else
  git push -q origin main
fi
echo
echo "Published ${STAMP}. Give GitHub a minute or two, then the app is at:"
echo "    https://${OWNER}.github.io/${REPO_NAME}/"
echo "On the iPhone: open that link in Safari, tap Share, then Add to Home Screen."
