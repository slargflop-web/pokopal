#!/bin/bash
# PokoPal: set up the accounts backend (Firebase Authentication + Cloud Firestore, free plan), end to end.
#
#   tools/setup_firebase.sh              create or find the Firebase project, the web app, the database; deploy the
#                                        rules; switch on email sign-in; write docs/data/auth.json; run the smoke test
#   tools/setup_firebase.sh --publish    the same, then tools/publish.sh
#   tools/setup_firebase.sh --project ID use an existing Firebase project instead of creating one
#
# One-time, and only Taylor can do it: sign this Mac into Firebase with   npx firebase-tools login
# (it opens the browser; sign in with the Google account that should own the PokoPal project). After that this
# script needs nothing from you. If Google asks the account to accept its Cloud terms first, the script says so
# and gives the link; accept once and run it again.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node tools/firebase_setup.mjs "$@"
