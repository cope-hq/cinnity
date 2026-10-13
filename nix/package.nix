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
  enablePush ? false,
  conf ? { },
}:

let
  backend = callPackage ./backend.nix { };
  configOverrides = writeText "cinny-config-overrides.json" (builtins.toJSON conf);
in
assert builtins.isBool enableEmbeds;
assert builtins.isBool enablePush;
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
  npmDepsHash = "sha256-Q9vHvd8Co08k/zZwn7Y5FkmqHmhIyKDU3fxDqRLR1YU=";
  npmRebuildFlags = [ "--ignore-scripts" ];
  npmBuildScript = "build";
  VITE_EMBED_BACKEND = lib.boolToString enableEmbeds;
  VITE_PUSH_GATEWAY = lib.boolToString enablePush;

  nativeBuildInputs = [ jq ] ++ lib.optionals (enableEmbeds || enablePush) [ makeWrapper ];
  passthru = { inherit enableEmbeds enablePush; };

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
  + lib.optionalString enablePush ''
    mkdir -p "$out/bin"
    makeWrapper ${nodejs-slim_24}/bin/node "$out/bin/cinny-push" \
      --add-flags "${backend}/src/push/main.js"
  ''
  + ''

    runHook postInstall
  '';

  meta = {
    description = "Cinny-based Matrix client with optional preview backend and push gateway";
    homepage = "https://github.com/cinnyapp/cinny";
    license = lib.licenses.agpl3Only;
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
