{
  lib,
  buildNpmPackage,
  nodejs_24,
  nodejs-slim_24,
  makeWrapper,
  curl,
  callPackage,
  jq,
  writeText,
  enableEmbeds ? false,
  conf ? { },
}:

let
  backend = callPackage ./backend.nix { };
  configOverrides = writeText "cinny-config-overrides.json" (builtins.toJSON conf);
in
assert builtins.isBool enableEmbeds;
buildNpmPackage {
  pname = "cinny";
  version = (builtins.fromJSON (builtins.readFile ../package.json)).version;

  # Keep Nix builds independent of the working tree's node_modules and dist,
  # while including all inputs used by the Cinny Vite build.
  src = lib.cleanSourceWith {
    src = ../.;
    name = "cinny-source";
    filter =
      path: type:
      let
        relative = lib.removePrefix (toString ../. + "/") (toString path);
      in
      relative == "src"
      || lib.hasPrefix "src/" relative
      || relative == "public"
      || lib.hasPrefix "public/" relative
      || builtins.elem relative [
        ".npmrc"
        "package.json"
        "package-lock.json"
        "index.html"
        "build.config.ts"
        "vite.config.js"
        "tsconfig.json"
        "config.json"
        "netlify.toml"
      ];
  };

  nodejs = nodejs_24;
  npmDepsHash = "sha256-M3MqnfUfWwn5eSM6qmgKPtcbpYo8FbtxAmlFtpBTkJc=";
  npmRebuildFlags = [ "--ignore-scripts" ];
  npmBuildScript = "build";
  VITE_EMBED_BACKEND = lib.boolToString enableEmbeds;

  nativeBuildInputs = [ jq ] ++ lib.optionals enableEmbeds [ makeWrapper ];
  passthru = { inherit enableEmbeds; };

  # The output is a static document root, not an npm package. Merge optional
  # deployment configuration after Vite copies config.json into dist.
  installPhase = ''
    runHook preInstall

    test -s dist/index.html
    test -s dist/sw.js
    test -n "$(find dist/assets -name '*.js' -print -quit)"
    test -n "$(find dist/assets -name '*.css' -print -quit)"
    test -n "$(find dist -name '*.wasm' -print -quit)"

    mkdir -p "$out/share/cinny"
    cp -r dist/. "$out/share/cinny/"
    jq -s '.[0] * .[1]' \
      "$out/share/cinny/config.json" \
      "${configOverrides}" \
      > "$out/share/cinny/config.json.tmp"
    mv "$out/share/cinny/config.json.tmp" "$out/share/cinny/config.json"
  ''
  + lib.optionalString enableEmbeds ''
    mkdir -p "$out/bin"
    makeWrapper ${nodejs-slim_24}/bin/node "$out/bin/cinny-embeds" \
      --add-flags "${backend}/src/main.js" \
      --set CINNY_CURL "${curl}/bin/curl"
  ''
  + ''

    runHook postInstall
  '';

  meta = {
    description = "Cinny-based Matrix client with optional preview-only backend";
    homepage = "https://github.com/cinnyapp/cinny";
    license = lib.licenses.agpl3Only;
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
