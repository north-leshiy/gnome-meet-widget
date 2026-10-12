#!/usr/bin/env bash
# Build the gnome-meet-widget extension.
#   ./build.sh         schema + translations (enough for a symlinked install)
#   ./build.sh pot     refresh po/gnome-meet-widget.pot from the sources
#   ./build.sh pack    zip for gnome-extensions install
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EXT="$ROOT/extension"
DOMAIN=gnome-meet-widget

# Translations: GNU gettext when installed, otherwise Python Babel (pybabel).
have() { command -v "$1" >/dev/null; }

compile() {
  glib-compile-schemas --strict "$EXT/schemas"
  local po lang mo
  for po in "$EXT"/po/*.po; do
    [[ -e $po ]] || continue
    lang=$(basename "$po" .po)
    mo="$EXT/locale/$lang/LC_MESSAGES/$DOMAIN.mo"
    mkdir -p "$(dirname "$mo")"
    # A running Shell keeps the .mo mmapped: writing over it in place hands
    # the Shell garbage ("String from C value is invalid UTF-8"). Compile next
    # to it and rename, so the old inode stays intact; skip when unchanged.
    if have msgfmt; then
      msgfmt --check -o "$mo.new" "$po"
    else
      pybabel -q compile --statistics -i "$po" -o "$mo.new" -l "$lang"
    fi
    if cmp -s "$mo.new" "$mo"; then
      rm -f "$mo.new"
    else
      mv -f "$mo.new" "$mo"
    fi
  done
}

pot() {
  local pot="$EXT/po/$DOMAIN.pot" po
  if have xgettext; then
    (cd "$EXT" && find . -name '*.js' -not -path './locale/*' -print0 | sort -z |
      xargs -0 xgettext --from-code=UTF-8 --language=JavaScript \
        --keyword=_ --keyword=N_ --keyword=gettext --keyword=ngettext:1,2 --keyword=pgettext:1c,2 \
        --package-name="$DOMAIN" --output="po/$DOMAIN.pot")
  else
    local cfg
    cfg=$(mktemp)
    printf '[javascript: **.js]\n' >"$cfg"
    (cd "$EXT" && pybabel -q extract -F "$cfg" --no-default-keywords \
      -k _ -k N_ -k gettext -k ngettext:1,2 -k pgettext:1c,2 \
      --project="$DOMAIN" --sort-by-file -o "po/$DOMAIN.pot" core lib ui ./*.js)
    rm -f "$cfg"
  fi
  for po in "$EXT"/po/*.po; do
    [[ -e $po ]] || continue
    if have msgmerge; then
      msgmerge --quiet --update --backup=none "$po" "$pot"
    else
      pybabel -q update -i "$pot" -o "$po" -l "$(basename "$po" .po)" --no-fuzzy-matching
    fi
  done
  return 0
}

# VERSION_NAME=1.2.0 ./build.sh pack puts the version into metadata.json as version-name.
pack() {
  compile
  # locale/ is already compiled by compile(). Pack a copy without po/ and without
  # the compiled schema: when it sees po/, gnome-extensions pack runs msgfmt itself,
  # and Shell 45+ does not need gschemas.compiled.
  local stage uuid zip
  stage=$(mktemp -d)
  cp -r "$EXT"/. "$stage"
  rm -rf "$stage/po" "$stage/schemas/gschemas.compiled"
  if [[ -n ${VERSION_NAME:-} ]]; then
    jq --arg v "$VERSION_NAME" '. + {"version-name": $v}' "$EXT/metadata.json" >"$stage/metadata.json"
  fi
  uuid=$(jq -r .uuid "$EXT/metadata.json")
  zip="$ROOT/$uuid.shell-extension.zip"
  rm -f "$zip"
  if have gnome-extensions; then
    (cd "$stage" && gnome-extensions pack --force --out-dir="$ROOT" \
      --extra-source=core --extra-source=lib --extra-source=ui --extra-source=icons --extra-source=locale \
      --extra-source=LICENSE .)
  else
    # Without GNOME Shell (e.g. in CI): the same set of files with plain zip.
    (cd "$stage" && zip -qr "$zip" metadata.json extension.js prefs.js stylesheet.css \
      core lib ui icons locale schemas LICENSE)
  fi
  rm -rf "$stage"
  echo "$zip"
}

case "${1:-}" in
  "") compile ;;
  pot) pot ;;
  pack) pack ;;
  *) echo "usage: $0 [pot|pack]" >&2; exit 2 ;;
esac
