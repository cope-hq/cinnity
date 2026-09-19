{
  lib,
  buildNpmPackage,
  nodejs_24,
}:

# Private runtime dependency of the configurable Cinny package. The browser
# adapter is compiled into the frontend and is not needed by this derivation.
buildNpmPackage {
  pname = "cinny-embed-runtime";
  version = (builtins.fromJSON (builtins.readFile ../backend/package.json)).version;

  src = lib.cleanSourceWith {
    src = ../backend;
    name = "cinny-embed-source";
    filter =
      path: type:
      let
        relative = lib.removePrefix (toString ../backend + "/") (toString path);
      in
      relative == "src"
      || lib.hasPrefix "src/" relative
      || builtins.elem relative [
        "package.json"
        "package-lock.json"
      ];
  };

  nodejs = nodejs_24;
  npmDepsHash = "sha256-d5Bfe3XT8ab0FUjPX12WCLvOhPOo0CkSlMnWCer5IFo=";
  npmFlags = [ "--ignore-scripts" ];
  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out"
    cp -r src package.json node_modules "$out/"
    test -s "$out/src/main.js"
    test -s "$out/src/parse-worker.js"

    runHook postInstall
  '';
}
