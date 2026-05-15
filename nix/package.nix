{ lib, stdenv, fetchurl
, dpkg, autoPatchelfHook, makeWrapper
, gtk3, gdk-pixbuf, cairo, glib, webkitgtk_4_1, libsoup_3, libgcc, gst_all_1
}:

let
  sources = builtins.fromJSON (builtins.readFile ./sources.json);
  version = sources.version;

  srcMap = {
    x86_64-linux = fetchurl {
      url = "https://github.com/crynta/terax-ai/releases/download/v${version}/Terax_${version}_amd64.deb";
      hash = sources.hashes.x86_64-linux;
    };
    x86_64-darwin = fetchurl {
      url = "https://github.com/crynta/terax-ai/releases/download/v${version}/Terax_x64.app.tar.gz";
      hash = sources.hashes.x86_64-darwin;
    };
    aarch64-darwin = fetchurl {
      url = "https://github.com/crynta/terax-ai/releases/download/v${version}/Terax_aarch64.app.tar.gz";
      hash = sources.hashes.aarch64-darwin;
    };
  };

  sys = stdenv.hostPlatform.system;
in

assert lib.assertMsg (builtins.hasAttr sys srcMap)
  "terax: unsupported platform ${sys}";

stdenv.mkDerivation {
  pname = "terax";
  inherit version;

  src = srcMap.${sys};

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    dpkg autoPatchelfHook makeWrapper
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    gtk3 gdk-pixbuf cairo glib webkitgtk_4_1 libsoup_3 libgcc
    gst_all_1.gstreamer gst_all_1.gst-plugins-base
    gst_all_1.gst-plugins-good gst_all_1.gst-plugins-bad
  ];

  GST_PLUGIN_SYSTEM_PATH = lib.optionalString stdenv.hostPlatform.isLinux
    "${gst_all_1.gst-plugins-base}/lib/gstreamer-1.0:${gst_all_1.gst-plugins-good}/lib/gstreamer-1.0:${gst_all_1.gst-plugins-bad}/lib/gstreamer-1.0";

  unpackPhase = if stdenv.hostPlatform.isLinux then "dpkg -x $src ." else "tar xzf $src";

  installPhase = if stdenv.hostPlatform.isLinux then ''
    mkdir -p $out/bin $out/share
    cp -r usr/share/* $out/share/
    install -Dm755 usr/bin/terax $out/bin/terax

    wrapProgram $out/bin/terax \
      --prefix GST_PLUGIN_SYSTEM_PATH : "$GST_PLUGIN_SYSTEM_PATH"
  '' else ''
    mkdir -p $out/Applications
    cp -r *.app $out/Applications/
  '';

  meta = with lib; {
    description = "Open-source lightweight cross-platform AI-native terminal (ADE)";
    homepage = "https://terax.app";
    license = licenses.asl20;
    platforms = [ "x86_64-linux" "x86_64-darwin" "aarch64-darwin" ];
  };
}
